import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";
const OPENAI_IMAGE_URL = "https://api.openai.com/v1/images/generations";

const CATEGORIES = ["לחמים", "מרקים", "מנה עיקרית", "תוספות", "סלטים", "שונות", "עוגות", "קינוחים"];

// Module-level cache for recipes - per user, persists across requests within the same cold-start instance
const RECIPES_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
let recipesCache: {
  userId: string;
  data: { id: string; name: string; category: string; ingredients: string; instructions: string; rating: number }[];
  fetchedAt: number;
} | null = null;

function createUserClient(req: Request) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? req.headers.get("apikey") ?? "";
  const authHeader = req.headers.get("Authorization");
  if (!supabaseUrl || !anonKey || !authHeader) return null;
  return createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
}

async function getAuthUserId(req: Request): Promise<string | null> {
  const client = createUserClient(req);
  if (!client) return null;
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) return null;
  return user.id;
}

function unauthorizedJson() {
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

// Map Hebrew categories to English for better image generation prompts
const CATEGORY_EN: Record<string, string> = {
  "לחמים": "bread and baked goods",
  "מרקים": "soup",
  "מנה עיקרית": "main dish",
  "תוספות": "side dish",
  "סלטים": "salad",
  "שונות": "food",
  "עוגות": "cake",
  "קינוחים": "dessert"
};

/** Upload base64 data URL to Storage and return object key (e.g. uuid.png), or null on failure. */
async function uploadImageToStorage(
  supabase: ReturnType<typeof createClient>,
  dataUrl: string
): Promise<string | null> {
  try {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    const fileName = `${crypto.randomUUID()}.png`;
    const { error } = await supabase.storage
      .from("recipe-images")
      .upload(fileName, blob, { contentType: "image/png", cacheControl: "31536000", upsert: false });
    return error ? null : fileName;
  } catch {
    return null;
  }
}

function normalizeStorageKey(imagePath: string | null | undefined): string | null {
  if (!imagePath || typeof imagePath !== "string") return null;
  if (imagePath.startsWith("http") || imagePath.startsWith("data:")) return null;
  return imagePath;
}

async function deleteStorageImage(
  supabase: ReturnType<typeof createClient>,
  imagePath: string | null | undefined
): Promise<void> {
  const key = normalizeStorageKey(imagePath);
  if (!key) return;
  const { error } = await supabase.storage.from("recipe-images").remove([key]);
  if (error) console.warn("Failed to delete old image from storage:", key, error.message);
}

/** Generate a recipe image using OpenAI GPT Image (DALL-E 3 retired May 2026) */
async function generateRecipeImage(recipeName: string, category: string): Promise<string | null> {
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openaiKey) {
    console.log("OPENAI_API_KEY not set, skipping image generation");
    return null;
  }

  const categoryEn = CATEGORY_EN[category] || "food";
  const bgColors = ["warm beige", "soft gray", "muted sage", "cream white", "light taupe", "dusty blue"];
  const randomBg = bgColors[Math.floor(Math.random() * bgColors.length)];
  const prompt = `Minimalist studio food photography of ${recipeName}, ${categoryEn}, premium modern style. Single dish centered in frame, clean composition, lots of negative space. Solid smooth ${randomBg} background. Soft studio lighting, no harsh shadows, natural highlights. Simple neutral plate, no props, no hands, no phones, no screens, no electronic devices. Ultra realistic, high detail texture, balanced natural colors. Clean editorial food photo style. No text or watermarks.`;

  console.log("Generating image with prompt:", prompt);

  try {
    const response = await fetch(OPENAI_IMAGE_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openaiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-image-1-mini",
        prompt,
        n: 1,
        size: "1024x1024",
        quality: "medium"
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("OpenAI Images API error:", response.status, errorText);
      return null;
    }

    const data = await response.json();
    const base64 = data.data?.[0]?.b64_json;
    if (base64) {
      console.log("Image generated successfully");
      return `data:image/png;base64,${base64}`;
    }
    return null;
  } catch (error) {
    console.error("Error generating image:", error);
    return null;
  }
}

const SYSTEM = `אתה עוזר מתכונים מקצועי ויצירתי בעברית. ענה תמיד בצורה ידידותית ושיחתית.

יש לך ארבע אפשרויות עיקריות:

1) **חיפוש מתכונים קיימים**: כשהמשתמש מחפש מתכון מהספר שלו – החזר recipeIds עם המתאימים מהרשימה.

2) **המצאת/הצעת מתכון**: כשהמשתמש מבקש ממך להמציא מתכון, לתת רעיון, לתת מתכון, או שואל "מה אפשר להכין מ..." – **הצע מתכון מקורי מהידע שלך!**
   - תן שם יצירתי למתכון
   - כתוב רשימת מצרכים מפורטת עם כמויות מדויקות
   - כתוב הוראות הכנה ברורות ומפורטות
   - בחר קטגוריה מתאימה
   - החזר את המתכון ב-suggestedRecipe
   - **קריטי: החזר confirmAddRecipe: false תמיד כשמציע מתכון!**

3) **הוספת מתכון לספר**: רק כשהמשתמש אומר במפורש אחת מהמילים הבאות: "תוסיף", "הוסף", "שמור", "אשר", "כן", "בבקשה תוסיף", "תכניס לספר" – רק אז החזר confirmAddRecipe: true.

4) **החלפת תמונה**: כשהמשתמש אומר "תחליף תמונה", "תמונה חדשה", "החלף את התמונה של" – מצא את המתכון ברשימה והחזר regenerateImageForRecipeId.

**⚠️ כלל קריטי לגבי confirmAddRecipe:**
- ברירת המחדל היא **תמיד** false!
- החזר true **רק** אם המשתמש אומר במפורש שהוא רוצה להוסיף/לשמור
- בקשות כמו "תמציא מתכון", "תן לי מתכון", "מה אפשר להכין" = confirmAddRecipe: false
- אישורים כמו "כן", "תוסיף", "שמור", "הוסף לספר" = confirmAddRecipe: true
- אם יש ספק - החזר false!

**כללים נוספים:**
- כשמבקשים ממך להמציא/לתת/להציע מתכון - **תמיד החזר את המתכון המלא בתוך suggestedRecipe** עם מצרכים מפורטים והוראות! לעולם אל תכתוב את המתכון בתוך reply בלבד - תמיד השתמש באובייקט suggestedRecipe.
- גם אם המשתמש אומר "תציע לי קודם", "תראה לי את המתכון", "תן לי את הפרטים" - החזר suggestedRecipe מלא!
- ב-reply כתוב רק משפט קצר כמו "הנה המתכון!" – הפרטים המלאים יהיו ב-suggestedRecipe.
- בסוף כל הצעת מתכון, שאל את המשתמש "רוצה שאוסיף את המתכון לספר?"
- אם המשתמש שולח תמונה של מתכון כתוב - נסה לזהות את הטקסט ולחלץ את המתכון
- אם המשתמש שולח תמונה של אוכל - הצע מתכון שנראה דומה למה שבתמונה
- אם המשתמש שואל שאלה כללית על בישול - ענה לו מהידע שלך
- אתה יכול ורוצה להמציא מתכונים! יש לך ידע רחב במתכונים מכל העולם

**פורמט suggestedRecipe:**
- name: שם המתכון (חובה)
- ingredients: רשימת המצרכים עם כמויות מדויקות, כל מצרך בשורה חדשה (חובה - לעולם לא להחזיר null!)
- instructions: הוראות ההכנה מפורטות, כל שלב בשורה חדשה (חובה - לעולם לא להחזיר null!)
- category: קטגוריה אחת מ: ${CATEGORIES.join(", ")} (חובה)
- source: מקור המתכון אם המשתמש ציין, או "נוצר על ידי AI" אם המצאת

**דוגמה 1 - הצעת מתכון (לא להוסיף!):**
משתמש: "תמציא לי מתכון לעוגת שוקולד"
תשובה:
{
  "reply": "הנה מתכון לעוגת שוקולד עשירה! רוצה שאוסיף אותו לספר המתכונים שלך?",
  "suggestedRecipe": {
    "name": "עוגת שוקולד עשירה",
    "ingredients": "200 גרם שוקולד מריר\\n150 גרם חמאה\\n4 ביצים\\n1 כוס סוכר\\n1/2 כוס קמח\\nקורט מלח\\n1 כפית תמצית וניל",
    "instructions": "1. מחממים תנור ל-180 מעלות\\n2. ממיסים שוקולד וחמאה יחד במיקרוגל או באמבט מים\\n3. טורפים ביצים עם סוכר עד לקצף בהיר\\n4. מוסיפים את תערובת השוקולד ומערבבים\\n5. מקפלים את הקמח בעדינות\\n6. שופכים לתבנית משומנת ומקומחת\\n7. אופים 25-30 דקות עד שקיסם יוצא לח מעט",
    "category": "עוגות",
    "source": "נוצר על ידי AI"
  },
  "confirmAddRecipe": false
}

**דוגמה 2 - המשתמש מבקש רעיון (לא להוסיף!):**
משתמש: "מה אפשר להכין עם עוף וירקות?"
תשובה:
{
  "reply": "יש לי רעיון מעולה! הנה מתכון לעוף בתנור עם ירקות. רוצה שאוסיף לספר?",
  "suggestedRecipe": { ... },
  "confirmAddRecipe": false
}

**דוגמה 3 - אישור הוספה לספר (רק כאן true!):**
משתמש: "כן, תוסיף את המתכון"
תשובה:
{
  "reply": "מעולה! הוספתי את המתכון לספר שלך.",
  "suggestedRecipe": {
    "name": "עוגת שוקולד עשירה",
    "ingredients": "...",
    "instructions": "...",
    "category": "עוגות",
    "source": "נוצר על ידי AI"
  },
  "confirmAddRecipe": true
}

תמיד החזר JSON בלבד.`;

/** מצב "עיצוב מצרכים בלבד" – מחזיר רק רשימה מעוצבת ב-reply */
const SYSTEM_FORMAT_INGREDIENTS_ONLY = `אתה עוזר שמעצב רשימת מצרכים בלבד.
המשתמש שולח טקסט גולמי של מצרכים (למשל הועתק מאתר).
המשימה שלך: להחזיר רק את הרשימה המעוצבת – כל מצרך בשורה נפרדת, עם כמות ויחידת מידה ברורה (כוסות, כפיות, גרם וכו').
אל תכתוב שום דבר אחר – רק את הרשימה המעוצבת בשדה reply.
החזר JSON עם שדה reply בלבד.`;

/** מצב "פיצול מתכון מלא" – מפצל טקסט גולמי למצרכים, הוראות הכנה והערות */
const SYSTEM_PARSE_FULL_RECIPE = `אתה עוזר שמפצל מתכון גולמי (טקסט שהועתק מאתר או ממקור אחר) לשלושה חלקים:
1. ingredients – רשימת מצרכים מעוצבת: כל מצרך בשורה נפרדת, עם כמות ויחידת מידה (כוסות, כפיות, גרם וכו').
2. instructions – הוראות ההכנה: שלבים ברורים, כל שלב בשורה או ממוספר.
3. notes – הערות/טיפים (אם אין – מחזיר מחרוזת ריקה "").

המשתמש שולח טקסט אחד שמכיל מתכון מלא או חלקי. פצל את התוכן לשלושת השדות.
אל תכתוב שום דבר נוסף – רק JSON עם שלושת השדות: ingredients, instructions, notes (כולם מחרוזות).
אם אין הוראות או הערות בטקסט – השאר מחרוזת ריקה "" בשדה המתאים.`;

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string" },
    recipeIds: { type: "array", items: { type: "string" } },
    suggestedRecipe: {
      type: "object",
      properties: {
        name: { type: "string" },
        ingredients: { type: "string" },
        instructions: { type: "string" },
        category: { type: "string", enum: CATEGORIES },
        source: { type: "string" }
      },
      required: ["name", "ingredients", "instructions", "category"]
    },
    confirmAddRecipe: { type: "boolean" },
    regenerateImageForRecipeId: { type: "string" }
  },
  required: [ "reply" ]
};

/** ממיר שגיאת Gemini להודעה ברורה למשתמש. */
function geminiErrorToReply(status: number, bodyText: string): string {
  let statusStr = "";
  let code: number | undefined;
  try {
    const j = JSON.parse(bodyText || "{}");
    const err = j?.error;
    if (err && typeof err === "object") {
      code = typeof err.code === "number" ? err.code : undefined;
      statusStr = (typeof err.status === "string" ? err.status : "") || "";
    }
  } catch {
    /* נשאר עם ברירת המחדל */
  }
  const c = code ?? status;
  const s = (statusStr || "").toUpperCase();

  if (c === 401 || s === "UNAUTHENTICATED") {
    return "מפתח ה-API של Gemini לא תקף או חסר. נא להגדיר GEMINI_API_KEY ב-Supabase Secrets (הגדרות → Edge Functions → Secrets).";
  }
  if (c === 403 || s === "PERMISSION_DENIED") {
    return "אין הרשאה לשימוש ב-Gemini – ייתכן שהמפתח חסום או מוגבל בהגדרות Google. נא לבדוק ב-Google AI Studio.";
  }
  if (c === 429 || s === "RESOURCE_EXHAUSTED") {
    return "חרגת ממכסת הבקשות ל-Gemini. נסה שוב אחרי כמה דקות.";
  }
  if (c === 404 || s === "NOT_FOUND") {
    return "מודל Gemini לא זמין. ייתכן ששם המודל השתנה – נא לבדוק את הקוד.";
  }
  if (c === 400 || s === "INVALID_ARGUMENT") {
    return "שגיאה בבקשה ל-Gemini. נא לבדוק את לוגי ה-Edge Function ב-Supabase.";
  }

  return "לא ניתן לתקשר עם ה-AI. נא לבדוק הגדרות (GEMINI_API_KEY ב-Supabase Secrets). אם ההגדרות נראות תקינות, בדוק את לוגי ה-Edge Function.";
}

/** Transcribe audio via Gemini (fallback when Web Speech API network is blocked). */
async function transcribeAudioWithGemini(
  apiKey: string,
  base64: string,
  mimeType: string
): Promise<{ transcript: string } | { error: string }> {
  const res = await fetch(`${GEMINI_URL}?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{
        role: "user",
        parts: [
          { inline_data: { mime_type: mimeType, data: base64 } },
          {
            text: "העתק מילה במילה את הדיבור בעברית מהקלטה זו. אל תוסיף, אל תפרש, אל תתקן ואל תמציא מילים שלא נאמרו. אם לא שומעים בבירור, החזר את מה ששמעת. החזר רק את הטקסט שנאמר, ללא מרכאות והסבר.",
          },
        ],
      }],
      generationConfig: { temperature: 0 },
    }),
  });

  if (!res.ok) {
    const t = await res.text();
    console.error("Gemini transcribe error", res.status, t);
    return { error: geminiErrorToReply(res.status, t) };
  }

  const data = await res.json();
  const text = (data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "").trim();
  if (!text) return { error: "לא זוהה דיבור בהקלטה." };
  return { transcript: text };
}

interface MessagePart {
  text?: string;
  inline_data?: {
    mime_type: string;
    data: string;
  };
}

interface Attachment {
  type: 'image' | 'pdf';
  data: string;
  name: string;
}

interface Message {
  role: string;
  content: string;
  attachments?: Attachment[];
}

function buildContents(
  messages: Message[],
  recipes: { id: string; name: string; category: string; ingredients: string; instructions: string; rating: number }[],
  formatIngredientsOnly = false
): { role: string; parts: MessagePart[] }[] {
  const contents: { role: string; parts: MessagePart[] }[] = [];
  let firstUserSeen = false;

  for (const m of messages) {
    const geminiRole = m.role === "user" ? "user" : "model";
    const parts: MessagePart[] = [];

    // Add text content
    let text = m.content || "";
    if (m.role === "user" && !formatIngredientsOnly) {
      if (!firstUserSeen) {
        text = "הקשר – רשימת המתכונים בספר:\n" + JSON.stringify(recipes) + "\n\n---\n\n" + text;
        firstUserSeen = true;
      }
    }
    parts.push({ text });

    // Add image attachments (Gemini supports inline images)
    if (m.attachments && Array.isArray(m.attachments)) {
      for (const att of m.attachments) {
        if (att.type === 'image' && att.data) {
          // Extract base64 data from data URL (format: data:image/png;base64,xxxxx)
          const match = att.data.match(/^data:([^;]+);base64,(.+)$/);
          if (match) {
            parts.push({
              inline_data: {
                mime_type: match[1],
                data: match[2]
              }
            });
          }
        }
      }
    }

    contents.push({ role: geminiRole, parts });
  }
  return contents;
}

type ImportedRecipePayload = {
  name: string;
  ingredients: string;
  instructions: string;
  notes: string;
  category: string;
  source: string;
  recipeLink: string;
  preparationTime: number | null;
  videoUrl: string | null;
  imageUrl: string | null;
};

const IMPORT_RECIPE_SCHEMA = {
  type: "object" as const,
  properties: {
    name: { type: "string" },
    ingredients: { type: "string" },
    instructions: { type: "string" },
    notes: { type: "string" },
    category: { type: "string", enum: CATEGORIES },
    source: { type: "string" },
    preparationTime: { type: "string" },
    videoUrl: { type: "string" },
  },
  required: ["name", "ingredients", "instructions", "category"],
};

const SYSTEM_IMPORT_FROM_URL = `אתה מחלץ מתכון מדף אינטרנט לעברית.
קיבלת תוכן מדף (JSON-LD מובנה ו/או טקסט מהדף) וכתובת המקור.
החזר JSON בלבד עם:
- name: שם המתכון
- ingredients: כל מצרך בשורה נפרדת, עם כמויות
- instructions: שלבי הכנה, כל שלב בשורה
- notes: טיפים/הערות ("" אם אין)
- category: אחת מ: ${CATEGORIES.join(", ")}
- source: שם האתר או המקור (לא URL מלא)
- preparationTime: מספר דקות כמחרוזת ("" אם לא ידוע)
- videoUrl: קישור לסרטון אם קיים ("" אם אין)

אל תמציא מצרכים שלא מופיעים בדף. אם חסר מידע – השאר ריק או נחש בזהירות רק לקטגוריה.`;

function parseAllowedImportUrl(raw: string): URL | null {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    const host = u.hostname.toLowerCase();
    if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return null;
    if (host === "127.0.0.1" || host === "0.0.0.0" || host === "::1" || host === "[::1]") return null;
    if (/^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) return null;
    if (host.startsWith("169.254.")) return null;
    return u;
  } catch {
    return null;
  }
}

function isRecipeSchemaType(type: unknown): boolean {
  if (typeof type === "string") return type === "Recipe" || type.endsWith("/Recipe");
  if (Array.isArray(type)) return type.some(isRecipeSchemaType);
  return false;
}

function collectRecipeJsonLd(node: unknown, out: Record<string, unknown>[]): void {
  if (!node || typeof node !== "object") return;
  const obj = node as Record<string, unknown>;
  if (isRecipeSchemaType(obj["@type"])) out.push(obj);
  if (Array.isArray(node)) {
    node.forEach((item) => collectRecipeJsonLd(item, out));
    return;
  }
  if (Array.isArray(obj["@graph"])) obj["@graph"].forEach((item) => collectRecipeJsonLd(item, out));
}

function extractJsonLdRecipes(html: string): Record<string, unknown>[] {
  const recipes: Record<string, unknown>[] = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    try {
      collectRecipeJsonLd(JSON.parse(match[1]), recipes);
    } catch {
      /* skip invalid JSON-LD */
    }
  }
  return recipes;
}

function stringifyInstructionSteps(instructions: unknown): string {
  if (typeof instructions === "string") return instructions.trim();
  if (!Array.isArray(instructions)) return "";
  return instructions
    .map((step) => {
      if (typeof step === "string") return step.trim();
      if (step && typeof step === "object") {
        const s = step as Record<string, unknown>;
        return String(s.text || s.name || s.description || "").trim();
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function stringifyIngredients(ingredients: unknown): string {
  if (typeof ingredients === "string") return ingredients.trim();
  if (!Array.isArray(ingredients)) return "";
  return ingredients.map((item) => String(item).trim()).filter(Boolean).join("\n");
}

function pickFirstUrl(value: unknown): string | null {
  if (typeof value === "string" && value.startsWith("http")) return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const url = pickFirstUrl(item);
      if (url) return url;
    }
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (typeof obj.url === "string" && obj.url.startsWith("http")) return obj.url;
  }
  return null;
}

function parseIsoDurationMinutes(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const m = value.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/i);
  if (!m) return null;
  const hours = parseInt(m[1] || "0", 10);
  const mins = parseInt(m[2] || "0", 10);
  const secs = parseInt(m[3] || "0", 10);
  const total = hours * 60 + mins + Math.round(secs / 60);
  return total > 0 ? total : null;
}

function hostnameToSource(url: URL): string {
  return url.hostname.replace(/^www\./, "");
}

function buildImportContext(html: string, pageUrl: string): string {
  const jsonLdRecipes = extractJsonLdRecipes(html);
  const parts: string[] = [`URL: ${pageUrl}`, `Host: ${hostnameToSource(new URL(pageUrl))}`];

  if (jsonLdRecipes.length > 0) {
    const best = jsonLdRecipes[0];
    parts.push("JSON-LD Recipe:");
    parts.push(JSON.stringify({
      name: best.name,
      description: best.description,
      recipeIngredient: best.recipeIngredient,
      recipeInstructions: best.recipeInstructions,
      prepTime: best.prepTime,
      cookTime: best.cookTime,
      totalTime: best.totalTime,
      video: best.video,
      image: best.image,
    }).slice(0, 12000));
  }

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) parts.push(`Title: ${titleMatch[1].replace(/\s+/g, " ").trim()}`);

  const ogTitle = html.match(/property=["']og:title["'][^>]*content=["']([^"']+)["']/i);
  if (ogTitle) parts.push(`OG Title: ${ogTitle[1]}`);

  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim()
    .slice(0, 28000);

  parts.push("Page text excerpt:");
  parts.push(text);
  return parts.join("\n\n");
}

async function fetchPageHtml(url: URL): Promise<{ html: string } | { error: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 18000);
  try {
    const res = await fetch(url.toString(), {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "he,en-US;q=0.9,en;q=0.8",
        "Cache-Control": "no-cache",
      },
    });
    if (!res.ok) return { error: `לא ניתן לטעון את הדף (שגיאה ${res.status}).` };
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
      return { error: "הקישור לא מוביל לדף מתכון (HTML)." };
    }
    const html = await res.text();
    if (html.length > 2_500_000) return { error: "הדף גדול מדי לייבוא." };
    return { html };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { error: "פג הזמן בטעינת האתר. נסו שוב." };
    }
    return { error: "לא ניתן לטעון את האתר. ייתכן שהוא חוסם גישה אוטומטית." };
  } finally {
    clearTimeout(timeout);
  }
}

function mapJsonLdRecipeDirect(recipe: Record<string, unknown>, pageUrl: string): ImportedRecipePayload | null {
  const name = String(recipe.name || "").trim();
  const ingredients = stringifyIngredients(recipe.recipeIngredient);
  const instructions = stringifyInstructionSteps(recipe.recipeInstructions);
  if (!name || (!ingredients && !instructions)) return null;

  const prep = parseIsoDurationMinutes(recipe.prepTime);
  const cook = parseIsoDurationMinutes(recipe.cookTime);
  const total = parseIsoDurationMinutes(recipe.totalTime);
  const preparationTime = total ?? (prep != null && cook != null ? prep + cook : prep ?? cook);

  return {
    name,
    ingredients,
    instructions,
    notes: typeof recipe.description === "string" ? recipe.description.trim().slice(0, 800) : "",
    category: "שונות",
    source: hostnameToSource(new URL(pageUrl)),
    recipeLink: pageUrl,
    preparationTime,
    videoUrl: pickFirstUrl(recipe.video),
    imageUrl: pickFirstUrl(recipe.image),
  };
}

async function parseRecipeWithGemini(
  apiKey: string,
  context: string,
  pageUrl: string,
  jsonLdHint: ImportedRecipePayload | null
): Promise<{ recipe: ImportedRecipePayload } | { error: string }> {
  const hint = jsonLdHint
    ? `\n\nנתונים מובנים שחולצו מהדף (עדיף לסמוך עליהם):\n${JSON.stringify(jsonLdHint).slice(0, 8000)}`
    : "";

  const res = await fetch(`${GEMINI_URL}?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_IMPORT_FROM_URL }] },
      contents: [{
        role: "user",
        parts: [{ text: `${context}${hint}\n\nחלץ את המתכון המלא.` }],
      }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: IMPORT_RECIPE_SCHEMA,
        temperature: 0.1,
      },
    }),
  });

  if (!res.ok) {
    const t = await res.text();
    console.error("Gemini import error", res.status, t);
    return { error: geminiErrorToReply(res.status, t) };
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) return { error: "לא התקבלה תשובה מ-AI." };

  let parsed: {
    name?: string;
    ingredients?: string;
    instructions?: string;
    notes?: string;
    category?: string;
    source?: string;
    preparationTime?: string;
    videoUrl?: string;
  };
  try {
    parsed = JSON.parse(text);
  } catch {
    return { error: "לא הצלחנו לפענח את המתכון מהדף." };
  }

  const name = (parsed.name || jsonLdHint?.name || "").trim();
  const ingredients = (parsed.ingredients || jsonLdHint?.ingredients || "").trim();
  const instructions = (parsed.instructions || jsonLdHint?.instructions || "").trim();
  if (!name || (!ingredients && !instructions)) {
    return { error: "לא נמצא מתכון מספיק בדף. נסו להעתיק את הטקסט ידנית או לבחור קישור אחר." };
  }

  let category = parsed.category || "שונות";
  if (!CATEGORIES.includes(category)) category = "שונות";

  let preparationTime: number | null = null;
  const pt = (parsed.preparationTime || "").trim();
  if (pt) {
    const n = parseInt(pt.replace(/\D/g, ""), 10);
    if (!Number.isNaN(n) && n > 0) preparationTime = n;
  }
  if (preparationTime == null && jsonLdHint?.preparationTime) preparationTime = jsonLdHint.preparationTime;

  const videoUrl = (parsed.videoUrl || "").trim() || jsonLdHint?.videoUrl || null;

  return {
    recipe: {
      name,
      ingredients,
      instructions,
      notes: (parsed.notes || jsonLdHint?.notes || "").trim(),
      category,
      source: (parsed.source || jsonLdHint?.source || hostnameToSource(new URL(pageUrl))).trim(),
      recipeLink: pageUrl,
      preparationTime,
      videoUrl: videoUrl && videoUrl.startsWith("http") ? videoUrl : null,
      imageUrl: jsonLdHint?.imageUrl || null,
    },
  };
}

async function importRecipeFromUrl(apiKey: string, pageUrl: URL): Promise<{ success: true; recipe: ImportedRecipePayload } | { success: false; error: string }> {
  const fetched = await fetchPageHtml(pageUrl);
  if ("error" in fetched) return { success: false, error: fetched.error };

  const jsonLdRecipes = extractJsonLdRecipes(fetched.html);
  const jsonLdHint = jsonLdRecipes.length > 0 ? mapJsonLdRecipeDirect(jsonLdRecipes[0], pageUrl.toString()) : null;

  if (jsonLdHint && jsonLdHint.ingredients && jsonLdHint.instructions) {
    const categorized = await parseRecipeWithGemini(apiKey, buildImportContext(fetched.html, pageUrl.toString()), pageUrl.toString(), jsonLdHint);
    if ("recipe" in categorized) {
      return { success: true, recipe: { ...categorized.recipe, imageUrl: categorized.recipe.imageUrl || jsonLdHint.imageUrl } };
    }
  }

  const context = buildImportContext(fetched.html, pageUrl.toString());
  const parsed = await parseRecipeWithGemini(apiKey, context, pageUrl.toString(), jsonLdHint);
  if ("error" in parsed) return { success: false, error: parsed.error };
  return { success: true, recipe: parsed.recipe };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" } });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: { "Content-Type": "application/json" } });
  }

  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) {
    return new Response(
      JSON.stringify({ reply: "לא ניתן לתקשר עם ה-AI. נא להגדיר GEMINI_API_KEY ב-Supabase Secrets.", recipeIds: [], suggestedRecipe: null, insertedRecipeId: null }),
      { status: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
    );
  }

  let body: {
    messages?: Message[];
    recipes?: { id: string; name: string; category: string; ingredients: string; instructions: string; rating: number }[];
    formatIngredientsOnly?: boolean;
    parseFullRecipe?: boolean;
    insertSuggestedRecipe?: boolean;
    suggestedRecipe?: { name?: string; ingredients?: string; instructions?: string; category?: string; source?: string };
    transcribeAudio?: boolean;
    audioBase64?: string;
    audioMimeType?: string;
    importRecipeFromUrl?: boolean;
    url?: string;
  };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  const jsonHeaders = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };

  const authUserId = await getAuthUserId(req);

  // Mode: transcribe voice recording (MediaRecorder + Gemini fallback)
  if (body?.transcribeAudio === true && typeof body.audioBase64 === "string" && body.audioBase64.length > 0) {
    if (!authUserId) return unauthorizedJson();
    const mime = typeof body.audioMimeType === "string" && body.audioMimeType.length > 0
      ? body.audioMimeType
      : "audio/webm";
    if (body.audioBase64.length > 6_000_000) {
      return new Response(
        JSON.stringify({ transcript: null, error: "ההקלטה ארוכה מדי. נסה הקלטה קצרה יותר." }),
        { status: 200, headers: jsonHeaders }
      );
    }
    const result = await transcribeAudioWithGemini(key, body.audioBase64, mime);
    if ("error" in result) {
      return new Response(JSON.stringify({ transcript: null, error: result.error }), { status: 200, headers: jsonHeaders });
    }
    return new Response(JSON.stringify({ transcript: result.transcript }), { status: 200, headers: jsonHeaders });
  }

  // Mode: import recipe from external URL (fetch page + extract with AI)
  if (body?.importRecipeFromUrl === true) {
    if (!authUserId) return unauthorizedJson();
    const urlRaw = typeof body.url === "string" ? body.url.trim() : "";
    const pageUrl = parseAllowedImportUrl(urlRaw);
    if (!pageUrl) {
      return new Response(
        JSON.stringify({ success: false, error: "כתובת לא תקינה. הזינו קישור שמתחיל ב-https://" }),
        { status: 200, headers: jsonHeaders }
      );
    }
    const result = await importRecipeFromUrl(key, pageUrl);
    return new Response(JSON.stringify(result), { status: 200, headers: jsonHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY") || "";
  const supabaseAdmin = supabaseUrl && serviceKey ? createClient(supabaseUrl, serviceKey) : null;

  // Mode: insert suggested recipe from "הוסף לספר" button – generate image, insert to DB, no Gemini
  if (body?.insertSuggestedRecipe === true && body.suggestedRecipe && typeof body.suggestedRecipe === "object") {
    if (!authUserId) return unauthorizedJson();
    const sr = body.suggestedRecipe;
    const name = (sr.name || "").trim() || "מתכון חדש";
    const category = sr.category || "שונות";
    const jsonHeaders = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
    if (!supabaseAdmin) {
      return new Response(
        JSON.stringify({
          reply: "לא ניתן להוסיף מתכון אוטומטית - חסרה הגדרת SUPABASE_SERVICE_ROLE_KEY.",
          insertedRecipeId: null,
          suggestedRecipe: null
        }),
        { status: 200, headers: jsonHeaders }
      );
    }
    console.log("Insert suggested recipe (button):", name);
    const generatedImageDataUrl = await generateRecipeImage(name, category);
    let imagePath: string | null = null;
    if (generatedImageDataUrl && supabaseAdmin) {
      imagePath = await uploadImageToStorage(supabaseAdmin, generatedImageDataUrl);
    }
    const row = {
      name,
      source: sr.source || null,
      ingredients: sr.ingredients || "",
      instructions: sr.instructions || "",
      category,
      notes: null,
      recipe_link: null,
      video_url: null,
      image_path: imagePath,
      rating: 0,
      user_id: authUserId,
    };
    const { data: inserted, error } = await supabaseAdmin.from("recipes").insert(row).select("id").single();
    if (error) {
      console.error("Insert suggested recipe failed:", error);
      return new Response(
        JSON.stringify({
          reply: "שגיאה בהוספת המתכון: " + error.message,
          insertedRecipeId: null,
          suggestedRecipe: { ...sr, image_path: imagePath }
        }),
        { status: 200, headers: jsonHeaders }
      );
    }
    recipesCache = null; // invalidate cache after insert
    const insertedRecipeId = inserted?.id ?? null;
    console.log("Recipe inserted (button):", insertedRecipeId);
    return new Response(
      JSON.stringify({
        reply: "ok",
        insertedRecipeId,
        suggestedRecipe: { ...sr, image_path: imagePath }
      }),
      { status: 200, headers: jsonHeaders }
    );
  }

  const formatIngredientsOnly = body?.formatIngredientsOnly === true;
  const parseFullRecipe = body?.parseFullRecipe === true;

  if (!authUserId) {
    return unauthorizedJson();
  }

  console.log("Environment check:", {
    hasSupabaseUrl: !!supabaseUrl,
    hasServiceKey: !!serviceKey,
    hasSupabaseAdmin: !!supabaseAdmin
  });

  if (!serviceKey) {
    console.warn("No service key found. Tried SUPABASE_SERVICE_ROLE_KEY and SERVICE_ROLE_KEY. Recipe insertion will be disabled.");
  }

  let recipes: { id: string; name: string; category: string; ingredients: string; instructions: string; rating: number }[];
  if (supabaseAdmin) {
    const now = Date.now();
    if (recipesCache && recipesCache.userId === authUserId && (now - recipesCache.fetchedAt) < RECIPES_CACHE_TTL_MS) {
      recipes = recipesCache.data;
      console.log("[recipe-ai] Using cached recipes:", recipes.length);
    } else {
      const { data: recipesFromDb } = await supabaseAdmin
        .from("recipes")
        .select("id, name, category, ingredients, instructions, rating")
        .eq("user_id", authUserId)
        .order("created_at", { ascending: true })
        .limit(500);
      recipes = (recipesFromDb || []).map((r: { id: string; name?: string; category?: string; ingredients?: string; instructions?: string; rating?: number }) => ({
        id: r.id,
        name: r.name || "",
        category: r.category || "שונות",
        ingredients: (r.ingredients || "").slice(0, 250),
        instructions: (r.instructions || "").slice(0, 250),
        rating: r.rating ?? 0
      }));
      recipesCache = { userId: authUserId, data: recipes, fetchedAt: now };
      console.log("[recipe-ai] Fetched recipes from DB:", recipes.length);
    }
  } else {
    recipes = Array.isArray(body?.recipes) ? body.recipes : [];
  }

  const messages = (Array.isArray(body?.messages) ? body.messages : []).slice(0, 50);
  const contents = buildContents(messages, recipes, formatIngredientsOnly || parseFullRecipe);
  if (contents.length === 0) {
    return new Response(
      JSON.stringify({ reply: "לא התקבלו הודעות.", recipeIds: [], suggestedRecipe: null, insertedRecipeId: null }),
      { status: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
    );
  }

  const useFormatOnly = formatIngredientsOnly && !parseFullRecipe;
  const systemPrompt = parseFullRecipe ? SYSTEM_PARSE_FULL_RECIPE : (useFormatOnly ? SYSTEM_FORMAT_INGREDIENTS_ONLY : SYSTEM);
  const schemaForParse = parseFullRecipe
    ? { type: "object" as const, properties: { ingredients: { type: "string" }, instructions: { type: "string" }, notes: { type: "string" } }, required: ["ingredients", "instructions", "notes"] }
    : (useFormatOnly ? { type: "object" as const, properties: { reply: { type: "string" } }, required: ["reply"] } : RESPONSE_SCHEMA);
  const res = await fetch(`${GEMINI_URL}?key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [ { text: systemPrompt } ] },
      contents,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: schemaForParse,
        temperature: 0.2
      }
    })
  });

  if (!res.ok) {
    const t = await res.text();
    console.error("Gemini error", res.status, t);
    const reply = geminiErrorToReply(res.status, t);
    return new Response(
      JSON.stringify({ reply, recipeIds: [], suggestedRecipe: null, insertedRecipeId: null }),
      { status: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
    );
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    return new Response(
      JSON.stringify({ reply: "לא התקבלה תשובה מ-AI.", recipeIds: [], suggestedRecipe: null, insertedRecipeId: null }),
      { status: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
    );
  }

  let parsed: {
    reply?: string;
    recipeIds?: string[];
    suggestedRecipe?: { name: string; ingredients: string; instructions: string; category: string; source?: string };
    confirmAddRecipe?: boolean;
    regenerateImageForRecipeId?: string;
    ingredients?: string;
    instructions?: string;
    notes?: string;
  };
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { reply: text || "לא התקבלה תשובה מובנית.", recipeIds: [], suggestedRecipe: undefined };
  }

  const reply = parsed?.reply ?? "לא התקבלה תשובה.";

  if (parseFullRecipe) {
    const ingredients = typeof parsed?.ingredients === "string" ? parsed.ingredients : "";
    const instructions = typeof parsed?.instructions === "string" ? parsed.instructions : "";
    const notes = typeof parsed?.notes === "string" ? parsed.notes : "";
    return new Response(
      JSON.stringify({
        reply: "ok",
        recipeIds: [],
        suggestedRecipe: null,
        insertedRecipeId: null,
        parsedRecipe: { ingredients, instructions, notes }
      }),
      { status: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
    );
  }

  if (formatIngredientsOnly) {
    return new Response(
      JSON.stringify({ reply, recipeIds: [], suggestedRecipe: null, insertedRecipeId: null }),
      { status: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
    );
  }
  const recipeIds = Array.isArray(parsed?.recipeIds) ? parsed.recipeIds : [];
  const suggestedRecipe = parsed?.suggestedRecipe && typeof parsed.suggestedRecipe === "object" ? parsed.suggestedRecipe : undefined;
  const confirmAddRecipe = parsed?.confirmAddRecipe === true;
  const regenerateImageForRecipeId = parsed?.regenerateImageForRecipeId || null;

  let insertedRecipeId: string | null = null;
  let insertionError: string | null = null;
  let generatedImage: string | null = null;
  let generatedImagePath: string | null = null;

  // Only insert to DB if user explicitly confirmed (confirmAddRecipe: true). Generate image only when adding to book.
  if (suggestedRecipe && confirmAddRecipe) {
    console.log("Adding recipe to book, generating image:", suggestedRecipe.name);
    const generatedImageDataUrl = await generateRecipeImage(suggestedRecipe.name, suggestedRecipe.category || "שונות");
    if (generatedImageDataUrl && supabaseAdmin) {
      generatedImagePath = await uploadImageToStorage(supabaseAdmin, generatedImageDataUrl);
    }
    generatedImage = generatedImagePath || generatedImageDataUrl;
    if (!supabaseAdmin) {
      console.error("Cannot insert recipe: supabaseAdmin is null (SUPABASE_SERVICE_ROLE_KEY not set)");
      insertionError = "לא ניתן להוסיף מתכון אוטומטית - חסרה הגדרת SUPABASE_SERVICE_ROLE_KEY. המתכון יוצג בטופס לשמירה ידנית.";
    } else {
      const row = {
        name: suggestedRecipe.name || "",
        source: suggestedRecipe.source || null,
        ingredients: suggestedRecipe.ingredients || "",
        instructions: suggestedRecipe.instructions || "",
        category: suggestedRecipe.category || "שונות",
        notes: null,
        recipe_link: null,
        video_url: null,
        image_path: generatedImagePath,
        rating: 0,
        user_id: authUserId,
      };
      const { data: inserted, error } = await supabaseAdmin.from("recipes").insert(row).select("id").single();
      if (error) {
        console.error("Failed to insert recipe:", error);
        insertionError = `שגיאה בהוספת המתכון: ${error.message}. המתכון יוצג בטופס לשמירה ידנית.`;
      } else if (inserted?.id) {
        recipesCache = null; // invalidate cache after insert
        insertedRecipeId = inserted.id;
        console.log("Recipe inserted successfully:", insertedRecipeId);
      }
    }
  } else if (suggestedRecipe) {
    // Just suggesting a recipe, don't insert to DB, don't generate image
    console.log("Recipe suggested (not confirmed):", suggestedRecipe.name);
  }

  // Handle image regeneration request: upload to Storage, update image_path
  let regeneratedImagePath: string | null = null;
  if (regenerateImageForRecipeId && supabaseAdmin) {
    const targetRecipe = recipes.find(r => r.id === regenerateImageForRecipeId);
    if (targetRecipe) {
      console.log("Regenerating image for recipe:", targetRecipe.name);
      const { data: existingRow } = await supabaseAdmin
        .from("recipes")
        .select("image_path")
        .eq("id", regenerateImageForRecipeId)
        .eq("user_id", authUserId)
        .single();
      const dataUrl = await generateRecipeImage(targetRecipe.name, targetRecipe.category || "שונות");
      if (dataUrl) {
        regeneratedImagePath = await uploadImageToStorage(supabaseAdmin, dataUrl);
        if (regeneratedImagePath) {
          await deleteStorageImage(supabaseAdmin, existingRow?.image_path);
          const { error } = await supabaseAdmin
            .from("recipes")
            .update({ image_path: regeneratedImagePath })
            .eq("id", regenerateImageForRecipeId)
            .eq("user_id", authUserId);
          if (error) {
            console.error("Failed to update recipe image_path:", error);
          } else {
            console.log("Recipe image_path updated successfully");
          }
        }
      }
    }
  }

  const suggestedRecipeWithImage = suggestedRecipe
    ? (confirmAddRecipe ? { ...suggestedRecipe, image_path: generatedImagePath || undefined } : { ...suggestedRecipe })
    : null;

  // If insertion failed, append error info to reply
  const finalReply = insertionError ? `${reply}\n\n⚠️ ${insertionError}` : reply;

  return new Response(
    JSON.stringify({
      reply: finalReply,
      recipeIds,
      suggestedRecipe: suggestedRecipeWithImage,
      insertedRecipeId,
      regenerateImageForRecipeId: regeneratedImagePath ? regenerateImageForRecipeId : null,
      regeneratedImagePath
    }),
    { status: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
  );
});
