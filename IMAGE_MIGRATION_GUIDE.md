# Image Storage Guide — Supabase Storage

## סקירה

תמונות מתכונים **לא** נשמרות יותר כ-base64 בדאטהבייס. המקור האמת הוא:

| שכבה | מה נשמר |
|------|---------|
| **Postgres** | `recipes.image_path` — מפתח ב-Storage, URL מלא, או `NULL` |
| **Supabase Storage** | bucket ציבורי `recipe-images` |
| **אתר (סטטי)** | `assets/default-images/**/*.svg` — fallback לפי קטגוריה |

---

## מקורות תמונה

1. **העלאה ידנית** — מהטופס, resize ל-1200px, העלאה ל-Storage
2. **AI (OpenAI `gpt-image-1-mini`)** — ב-`recipe-ai` / `regenerate-image` בעת הוספה לספר או החלפת תמונה
3. **ברירת מחדל** — SVG לפי קטגoria (`getDefaultImageUrl`) כש-`image_path` ריק
4. **Legacy** — base64 ישן מועבר אוטומטית ב-`migrateLegacyBase64ToStorage()` בטעינה

---

## פורמats של `image_path`

- `uuid.jpg` / `uuid.png` — העלאה חדשה או AI
- `{recipeId}/{timestamp}-{recipeId}.jpg` — מיגרציה ישנה
- `https://...` או `data:...` — legacy (נדיר)
- `NULL` — אין תמונה; UI מציג default

URL ציבורי:

```text
{SUPABASE_URL}/storage/v1/object/public/recipe-images/{image_path}
```

---

## ניקוי Storage (2026-06)

במחיקת מתכון, החלפת תמונה, או רegenracja — **הקובץ הישן נמחק** מ-Storage:

- **Client** (`js/main.js`): `deleteRecipeImageFromStorage()`
- **Edge Functions**: `deleteStorageImage()` ב-`recipe-ai` ו-`regenerate-image`

כך לא נשארים קבצים יתומים ב-bucket.

---

## תמונות ברירת מחדל

קבצים ב-`assets/default-images/` (SVG). ליצירה מחדש:

```bash
npm run generate-default-images
```

דמויות השף: `assets/icons/chef-*.svg` (ממופות מ-`chefImageUrl()`).

---

## SQL Migration (פעם ראשונה)

אם ה-bucket עדיין לא קיים:

1. [Supabase Dashboard](https://supabase.com/dashboard) → SQL Editor
2. הרץ `supabase/migrations/20250128000000_add_image_storage.sql`
3. מיגרציות נוספות (אם טרם הורצו):
   - `20250601120000_backfill_image_path_from_image.sql`
   - `20250601120001_normalize_image_path_prefix.sql`
   - `20250601120002_drop_recipes_image_column.sql`

---

## מיגרציית base64 ישנה

**אוטומטי:** האפליקציה מריצה `migrateLegacyBase64ToStorage()` בטעינה.

**ידני (אופציונלי):**

- `http://localhost:3000/migrate.html`, או
- Console: טען `js/migrate-images.js` והרץ `migrateAllImages()`

---

## פריסת Edge Functions

לאחר שינוי ב-`supabase/functions/`:

```bash
npm run deploy:functions
```

או ידנית:

```bash
npx supabase functions deploy recipe-ai regenerate-image --project-ref nuaepmndtblpmzbutowy --use-api --import-map supabase/functions/deno.json
```

אם ה-CLI נכשל על `.env.local` (BOM / תווים מיוחדים בהערות) — הסר BOM או השתמש בקובץ `.env` ASCII-only.

Secrets נדרשים ב-Supabase (Edge Functions → Secrets):

- `GEMINI_API_KEY` — צ'אט AI
- `OPENAI_API_KEY` — יצירת תמונות
- `SUPABASE_SERVICE_ROLE_KEY` — הוספת מתכונים / מחיקת תמונות ישנות מהשרver

---

## בדיקות

1. **Storage** — Dashboard → Storage → `recipe-images`
2. **DB** — `recipes.image_path` מכיל מפתחות, לא base64
3. **מחיקה** — מחק מתכון; הקובץ לא אמור להישאר ב-Storage
4. **ברירת מחדל** — מתכון בלי תמונה מציג SVG מ-`/default-images/...`
5. **Console** — ללא שגיאות 404 על תמונות

---

## בעיות נפוצות

| בעיה | פתרון |
|------|--------|
| העלאה נכשלת | וודא bucket + RLS policies קיימים |
| תמונת default לא נטענת | `npm run generate-default-images` ואז `npm run build` |
| AI לא יוצר תמונה | בדוק `OPENAI_API_KEY` ב-Secrets |
| תמונה ישנה נשארת ב-Storage | פרוס Edge Functions מעודכנים; client חדש מוחק ב-replace/delete |

---

## קבצים רלוונטיים

```
recipe-book/
├── assets/default-images/          ← SVG placeholders
├── assets/icons/chef-*.svg
├── js/main.js                      ← upload, display, delete from Storage
├── supabase/functions/
│   ├── recipe-ai/index.ts
│   └── regenerate-image/index.ts
├── supabase/migrations/            ← bucket + image_path
├── scripts/generate-default-images.mjs
└── vite.config.js                  ← PWA cache ל-Storage + defaults
```

---

**עודכן**: 9 יוני 2026  
**גרסה**: 2.0
