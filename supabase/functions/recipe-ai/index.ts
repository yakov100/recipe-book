import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent";

const CATEGORIES = ["לחמים", "מרקים", "מנה עיקרית", "תוספות", "סלטים", "שונות", "עוגות", "קינוחים"];

const SYSTEM = `אתה מנהל **שיחה מתמשכת** עם המשתמש על מתכונים. ענה תמיד בעברית, בצורה ידידותית ושיחהית. זכור את ההקשר מההודעות הקודמות, התייחס למה שנאמר, ושאל שאלות המשך כשמתאים.

יש לך שתי אפשרויות:

1) **הצעת מתכונים**: כשהמשתמש מבקש מתכון, המלצה, רעיון (למשל: עוגת גבינה, מתכון קל בשרי, משהו עם ביצים) – הצע רק מתכונים מהרשימה שנשלחה לך (recipes). החזר ב-JSON: reply (טקסט תשובה ידידותי) ו-recipeIds (מערך של id מהרשימה שמתאימים). אם אין התאמות – reply הסבר ו-recipeIds מערך ריק.

2) **הוספת מתכון**: כשהמשתמש מתאר מתכון להוספה (הוסף מתכון, רושם מתכון, כתוב מתכון, וכיו"ב) – חלץ מהטקסט: name, ingredients (טקסט עם שורות), instructions (טקסט עם שורות), category (חובה – בחר אחת מ: ${CATEGORIES.join(", ")}), source (אם ציין מקור). החזר reply (למשל: "הכנתי את המתכון, תוכל לערוך ולשמור") ו-suggestedRecipe עם השדות. אם חסר מידע – הערך null באותו שדה; category חייב להיות מאחת הרשימה.

תמיד החזר JSON בלבד בעל המבנה: { "reply": string, "recipeIds"?: string[], "suggestedRecipe"?: { "name": string, "ingredients": string, "instructions": string, "category": string, "source"?: string } }`;

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
        category: { type: "string" },
        source: { type: "string" }
      }
    }
  },
  required: [ "reply" ]
};

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
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabaseAdmin = supabaseUrl && serviceKey ? createClient(supabaseUrl, serviceKey) : null;

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
    return new Response(
      JSON.stringify({ reply: "לא ניתן לתקשר עם ה-AI. נא לבדוק הגדרות.", recipeIds: [], suggestedRecipe: null, insertedRecipeId: null }),
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

  let parsed: { reply?: string; recipeIds?: string[]; suggestedRecipe?: { name: string; ingredients: string; instructions: string; category: string; source?: string } };
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { reply: text || "לא התקבלה תשובה מובנית.", recipeIds: [], suggestedRecipe: undefined };
  }

  const reply = parsed?.reply ?? "לא התקבלה תשובה.";
  const recipeIds = Array.isArray(parsed?.recipeIds) ? parsed.recipeIds : [];
  const suggestedRecipe = parsed?.suggestedRecipe && typeof parsed.suggestedRecipe === "object" ? parsed.suggestedRecipe : undefined;

  let insertedRecipeId: string | null = null;
  if (suggestedRecipe && supabaseAdmin) {
    const row = {
      name: suggestedRecipe.name || "",
      source: suggestedRecipe.source || null,
      ingredients: suggestedRecipe.ingredients || "",
      instructions: suggestedRecipe.instructions || "",
      category: suggestedRecipe.category || "שונות",
      notes: null,
      recipe_link: null,
      video_url: null,
      image: null,
      rating: 0
    };
    const { data: inserted, error } = await supabaseAdmin.from("recipes").insert(row).select("id").single();
    if (!error && inserted?.id) insertedRecipeId = inserted.id;
  }

  return new Response(
    JSON.stringify({ reply, recipeIds, suggestedRecipe: suggestedRecipe || null, insertedRecipeId }),
    { status: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
  );
});
