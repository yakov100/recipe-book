import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";
const OPENAI_IMAGE_URL = "https://api.openai.com/v1/images/generations";

const CATEGORIES = ["לחמים", "מרקים", "מנה עיקרית", "תוספות", "סלטים", "שונות", "עוגות", "קינוחים"];

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

/** Generate a recipe image using DALL-E 3 */
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
        model: "dall-e-3",
        prompt,
        n: 1,
        size: "1024x1024",
        response_format: "b64_json"
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("DALL-E API error:", response.status, errorText);
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
- כשמבקשים ממך להמציא/לתת מתכון - **תמיד תן מתכון מלא עם מצרכים מפורטים והוראות!**
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" } });
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

  let body: { messages?: Message[]; recipes?: { id: string; name: string; category: string; ingredients: string; instructions: string; rating: number }[]; formatIngredientsOnly?: boolean; parseFullRecipe?: boolean };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  const formatIngredientsOnly = body?.formatIngredientsOnly === true;
  const parseFullRecipe = body?.parseFullRecipe === true;

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  // Try built-in SUPABASE_SERVICE_ROLE_KEY first, then custom SERVICE_ROLE_KEY as fallback
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY") || "";
  const supabaseAdmin = supabaseUrl && serviceKey ? createClient(supabaseUrl, serviceKey) : null;

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
    const { data: recipesFromDb } = await supabaseAdmin.from("recipes").select("id, name, category, ingredients, instructions, rating").order("created_at", { ascending: true });
    recipes = (recipesFromDb || []).map((r: { id: string; name?: string; category?: string; ingredients?: string; instructions?: string; rating?: number }) => ({
      id: r.id,
      name: r.name || "",
      category: r.category || "שונות",
      ingredients: (r.ingredients || "").slice(0, 250),
      instructions: (r.instructions || "").slice(0, 250),
      rating: r.rating ?? 0
    }));
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

  let parsed: { reply?: string; recipeIds?: string[]; suggestedRecipe?: { name: string; ingredients: string; instructions: string; category: string; source?: string }; confirmAddRecipe?: boolean; regenerateImageForRecipeId?: string };
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

  // Only insert to DB if user explicitly confirmed (confirmAddRecipe: true)
  if (suggestedRecipe && confirmAddRecipe) {
    // Generate image for the recipe
    console.log("Generating image for confirmed recipe:", suggestedRecipe.name);
    generatedImage = await generateRecipeImage(suggestedRecipe.name, suggestedRecipe.category || "שונות");

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
        image: generatedImage,
        rating: 0
      };
      const { data: inserted, error } = await supabaseAdmin.from("recipes").insert(row).select("id").single();
      if (error) {
        console.error("Failed to insert recipe:", error);
        insertionError = `שגיאה בהוספת המתכון: ${error.message}. המתכון יוצג בטופס לשמירה ידנית.`;
      } else if (inserted?.id) {
        insertedRecipeId = inserted.id;
        console.log("Recipe inserted successfully:", insertedRecipeId);
      }
    }
  } else if (suggestedRecipe) {
    // Just suggesting a recipe, don't insert to DB
    console.log("Recipe suggested (not confirmed):", suggestedRecipe.name);
  }

  // Handle image regeneration request
  let regeneratedImage: string | null = null;
  if (regenerateImageForRecipeId && supabaseAdmin) {
    // Find the recipe to get its name and category
    const targetRecipe = recipes.find(r => r.id === regenerateImageForRecipeId);
    if (targetRecipe) {
      console.log("Regenerating image for recipe:", targetRecipe.name);
      regeneratedImage = await generateRecipeImage(targetRecipe.name, targetRecipe.category || "שונות");
      if (regeneratedImage) {
        // Update the recipe in DB
        const { error } = await supabaseAdmin
          .from("recipes")
          .update({ image: regeneratedImage })
          .eq("id", regenerateImageForRecipeId);
        if (error) {
          console.error("Failed to update recipe image:", error);
        } else {
          console.log("Recipe image updated successfully");
        }
      }
    }
  }

  // Add generated image to suggestedRecipe for client-side use
  const suggestedRecipeWithImage = suggestedRecipe ? { ...suggestedRecipe, image: generatedImage } : null;

  // If insertion failed, append error info to reply
  const finalReply = insertionError ? `${reply}\n\n⚠️ ${insertionError}` : reply;

  return new Response(
    JSON.stringify({
      reply: finalReply,
      recipeIds,
      suggestedRecipe: suggestedRecipeWithImage,
      insertedRecipeId,
      regenerateImageForRecipeId: regeneratedImage ? regenerateImageForRecipeId : null,
      regeneratedImage
    }),
    { status: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
  );
});
