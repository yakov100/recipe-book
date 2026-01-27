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
  const prompt = `Minimalist studio food photography of ${recipeName}, ${categoryEn}, premium modern style. Single dish centered in frame, clean composition, lots of negative space. Solid smooth ${randomBg} background. Soft studio lighting, no harsh shadows, natural highlights. Simple neutral plate, no props, no hands. Ultra realistic, high detail texture, balanced natural colors. App-style presentation, food menu card aesthetic. No text or watermarks.`;

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

const SYSTEM = `אתה עוזר מתכונים בעברית. ענה תמיד בצורה ידידותית ושיחתית.

יש לך שלוש אפשרויות:

1) **חיפוש מתכונים**: כשהמשתמש מחפש מתכון קיים – החזר recipeIds עם המתאימים מהרשימה.

2) **הוספת מתכון חדש**: כשהמשתמש אומר "הוסף מתכון", "רשום מתכון", "תכניס מתכון" או מתאר מתכון חדש – חלץ את הפרטים והחזר suggestedRecipe.

3) **החלפת תמונה**: כשהמשתמש אומר "תחליף תמונה", "תמונה חדשה", "החלף את התמונה של", "צור תמונה חדשה ל" – מצא את המתכון ברשימה והחזר regenerateImageForRecipeId עם ה-id של המתכון.

**חשוב מאוד להוספת מתכון:**
- name: שם המתכון (חובה)
- ingredients: רשימת המצרכים שהמשתמש נתן, כל מצרך בשורה חדשה (חובה - לעולם לא להחזיר null!)
- instructions: הוראות ההכנה שהמשתמש נתן, כל שלב בשורה חדשה (חובה - לעולם לא להחזיר null!)
- category: קטגוריה אחת מ: ${CATEGORIES.join(", ")} (חובה)
- source: מקור המתכון אם צוין

**דוגמה להוספת מתכון:**
משתמש: "מתכון לפיצה: בצק מלח 4 כוסות סוכר, ההוראות זה לערבב הכל ולשים על הראש"
תשובה:
{
  "reply": "הוספתי את המתכון לפיצה!",
  "suggestedRecipe": {
    "name": "פיצה",
    "ingredients": "בצק\\nמלח\\n4 כוסות סוכר",
    "instructions": "לערבב הכל\\nלשים על הראש",
    "category": "מנה עיקרית"
  }
}

**דוגמה להחלפת תמונה:**
משתמש: "תחליף את התמונה של שקשוקה"
תשובה:
{
  "reply": "מייצר תמונה חדשה לשקשוקה...",
  "regenerateImageForRecipeId": "abc123"
}

תמיד החזר JSON בלבד.`;

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

function buildContents(
  messages: { role: string; content: string }[],
  recipes: { id: string; name: string; category: string; ingredients: string; instructions: string; rating: number }[]
): { role: string; parts: { text: string }[] }[] {
  const contents: { role: string; parts: { text: string }[] }[] = [];
  let firstUserSeen = false;
  for (const m of messages) {
    const geminiRole = m.role === "user" ? "user" : "model";
    let text = m.content || "";
    if (m.role === "user") {
      if (!firstUserSeen) {
        text = "הקשר – רשימת המתכונים בספר:\n" + JSON.stringify(recipes) + "\n\n---\n\n" + text;
        firstUserSeen = true;
      }
    }
    contents.push({ role: geminiRole, parts: [ { text } ] });
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

  let body: { messages?: { role: string; content: string }[]; recipes?: { id: string; name: string; category: string; ingredients: string; instructions: string; rating: number }[] };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

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
  const contents = buildContents(messages, recipes);
  if (contents.length === 0) {
    return new Response(
      JSON.stringify({ reply: "לא התקבלו הודעות.", recipeIds: [], suggestedRecipe: null, insertedRecipeId: null }),
      { status: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
    );
  }

  const res = await fetch(`${GEMINI_URL}?key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [ { text: SYSTEM } ] },
      contents,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
        temperature: 0.3
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

  let parsed: { reply?: string; recipeIds?: string[]; suggestedRecipe?: { name: string; ingredients: string; instructions: string; category: string; source?: string }; regenerateImageForRecipeId?: string };
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { reply: text || "לא התקבלה תשובה מובנית.", recipeIds: [], suggestedRecipe: undefined };
  }

  const reply = parsed?.reply ?? "לא התקבלה תשובה.";
  const recipeIds = Array.isArray(parsed?.recipeIds) ? parsed.recipeIds : [];
  const suggestedRecipe = parsed?.suggestedRecipe && typeof parsed.suggestedRecipe === "object" ? parsed.suggestedRecipe : undefined;
  const regenerateImageForRecipeId = parsed?.regenerateImageForRecipeId || null;

  let insertedRecipeId: string | null = null;
  let insertionError: string | null = null;
  let generatedImage: string | null = null;

  if (suggestedRecipe) {
    // Generate image for the recipe
    console.log("Generating image for recipe:", suggestedRecipe.name);
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
