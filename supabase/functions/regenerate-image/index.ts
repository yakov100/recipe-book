import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const OPENAI_IMAGE_URL = "https://api.openai.com/v1/images/generations";

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

Deno.serve(async (req: Request) => {
  // CORS headers
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json", ...corsHeaders }
    });
  }

  // Parse request body
  let body: { recipeId?: string; recipeName?: string; category?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...corsHeaders }
    });
  }

  const { recipeId, recipeName, category } = body;

  if (!recipeName) {
    return new Response(JSON.stringify({ error: "recipeName is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...corsHeaders }
    });
  }

  // Check for OpenAI API key
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openaiKey) {
    return new Response(JSON.stringify({ error: "OPENAI_API_KEY not configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders }
    });
  }

  // Setup Supabase admin client only when updating an existing recipe
  let supabaseAdmin: ReturnType<typeof createClient> | null = null;
  if (recipeId) {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY") || "";
    if (!supabaseUrl || !serviceKey) {
      return new Response(JSON.stringify({ error: "Supabase not configured" }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }
    supabaseAdmin = createClient(supabaseUrl, serviceKey);
  }

  // Generate new image (base64 data URL)
  console.log("Regenerating image for recipe:", recipeName, "category:", category);
  const newImageDataUrl = await generateRecipeImage(recipeName, category || "שונות");

  if (!newImageDataUrl) {
    return new Response(JSON.stringify({ error: "Failed to generate image" }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders }
    });
  }

  let imagePath: string | null = null;

  // Upload to Storage and update recipe with image_path (requires Supabase client)
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY") || "";
  if (supabaseUrl && serviceKey) {
    const supabase = createClient(supabaseUrl, serviceKey);
    const fileName = `${crypto.randomUUID()}.png`;
    try {
      const res = await fetch(newImageDataUrl);
      const blob = await res.blob();
      const { error: uploadError } = await supabase.storage
        .from("recipe-images")
        .upload(fileName, blob, { contentType: "image/png", cacheControl: "31536000", upsert: false });
      if (uploadError) {
        console.error("Storage upload error:", uploadError);
      } else {
        imagePath = fileName;
        if (recipeId) {
          const { error } = await supabase
            .from("recipes")
            .update({ image_path: fileName })
            .eq("id", recipeId);
          if (error) {
            console.error("Failed to update recipe image_path:", error);
          } else {
            console.log("Recipe image_path updated successfully for:", recipeId);
          }
        }
      }
    } catch (e) {
      console.error("Upload/update failed:", e);
    }
  }

  const ok = imagePath != null;
  return new Response(JSON.stringify({
    success: ok,
    image_path: imagePath,
    error: ok ? undefined : "העלאת התמונה ל-Storage נכשלה",
    message: ok ? (recipeId ? "התמונה עודכנה בהצלחה!" : "התמונה נוצרה. שמור את המתכון כדי לשמור את התמונה.") : undefined
  }), {
    status: 200,
    headers: { "Content-Type": "application/json", ...corsHeaders }
  });
});
