# ספר מתכונים דיגיטלי | Digital Recipe Book

אפליקציית ווב לניהול וארגון מתכונים אישיים.

## תכונות עיקריות
- שמירת מתכונים
- חיפוש מתכונים
- ארגון לפי קטגוריות
- ממשק משתמש ידידותי
- טיימר מובנה
- תמיכה ב-OCR להעלאת מתכונים מתמונות
- ייצוא וייבוא מתכונים
- **שיחה עם AI** – הצעת מתכונים מהספר לפי שאלות (למשל: עוגת גבינה, מתכון קל בשרי), והוספת מתכון מטקסט חופשי (ה-AI מפרק וממלא את טופס ההוספה)

## גישה לאתר
האתר זמין באופן מקוון בכתובת:
https://yakov100.github.io/recipe-book

## העלאה ל-Vercel
1. חבר את ה-repo ל-Vercel: **Import Project** → בחר את המאגר.
2. **Build & Output:** `vercel.json` מגדיר `buildCommand: ""` ו-`outputDirectory: "."` – מתאים לאתר סטטי (מגיש את `index.html` ו-`js/`, `css/` מהשורש). אם ה-build מושבת – השאר ריק; אם יש `vite build` – עדכן ל-`outputDirectory: "dist"` ו-`buildCommand: "npm run build"`.
3. **קישור פרטי למתכון:** `vercel.json` כולל `rewrites` ל-`/recipe` ו-`/recipe/:path*` → `index.html`. כל מתכון זמין בכתובת `https://<domain>/recipe/<id>`.

## התקנה מקומית
1. Clone את המאגר
```bash
git clone https://github.com/yakov100/recipe-book.git
```
2. פתח את הקובץ `index.html` בדפדפן

## שיחה עם AI (recipe-ai)
כדי שהתכונה "שיחה עם AI" תעבוד, יש להגדיר את ה-Edge Function `recipe-ai` ואת המפתח של Google Gemini ב-Supabase.

**קישור ישיר לדף ה-Secrets של הפרויקט:** [docs/supabase-secrets-setup.md](docs/supabase-secrets-setup.md)

### הגדרת GEMINI_API_KEY
1. צור מפתח API ב-[Google AI Studio](https://aistudio.google.com/apikey).
2. ב-Supabase: **Dashboard** → **Project Settings** → **Edge Functions** → **Secrets** (או: **Settings** → **Functions**), והוסף:
   - **Key:** `GEMINI_API_KEY`
   - **Value:** המפתח שיצרת.
3. או via CLI:
   ```bash
   supabase secrets set GEMINI_API_KEY=המפתח_שלך
   ```

### הגדרת SUPABASE_SERVICE_ROLE_KEY (חובה לצ'אט AI – קריאה מ-DB והכנסת מתכונים)
כדי שה-Edge Function `recipe-ai` יקרא מתכונים ישירות מה-DB ויכניס מתכונים חדשים כשהמשתמש מתאר מתכון בטקסט:
1. ב-Supabase: **Dashboard** → **Project Settings** → **API** – העתק את **service_role** (מפתח סודי, אל תחשוף).
2. ב-**Edge Functions** → **Secrets** הוסף:
   - **Key:** `SUPABASE_SERVICE_ROLE_KEY`
   - **Value:** המפתח service_role.
3. או via CLI:
   ```bash
   supabase secrets set SUPABASE_SERVICE_ROLE_KEY=המפתח_שלך
   ```
`SUPABASE_URL` זמין אוטומטית בסביבת Edge Functions. אם חסר, הוסף גם `SUPABASE_URL` (מ-**Project Settings** → **API** → Project URL).

### הפעלת recipe-ai
ה-Edge Function `recipe-ai` אמורה להיות מפורסמת לפרויקט ב-Supabase. אם פיתחת מקומית:
```bash
supabase login   # נדרש פעם אחת אם לא מחובר
supabase functions deploy recipe-ai
```

אם `GEMINI_API_KEY` לא מוגדר, בצ'אט תופיע הודעה: "לא ניתן לתקשר עם ה-AI. נא להגדיר GEMINI_API_KEY ב-Supabase Secrets."

### גישת Next.js (חלופה)
בפרויקט Next.js אפשר להשתמש ב־API Route, Vercel AI SDK ו־`GOOGLE_GENERATIVE_AI_API_KEY` (במקום Edge Function). מדריך מפורט: [docs/AI_CHAT_NEXTJS_GUIDE.md](docs/AI_CHAT_NEXTJS_GUIDE.md).

## טכנולוגיות
- HTML5
- CSS3
- JavaScript
- Tesseract.js (עבור OCR)
- Supabase (DB ו-Edge Functions)
- Google Gemini (עבור צ'אט AI)

---

A web application for managing and organizing personal recipes.

## Live Website
The website is available at:
https://yakov100.github.io/recipe-book

## Deploy to Vercel
1. Connect the repo in Vercel: **Import Project** → select the repository.
2. **Build & Output:** `vercel.json` sets `buildCommand: ""` and `outputDirectory: "."` for a static site (serves `index.html`, `js/`, `css/` from root). If build is disabled, leave empty; if using `vite build`, set `outputDirectory: "dist"` and `buildCommand: "npm run build"`.
3. **Per-recipe URLs:** `vercel.json` includes rewrites for `/recipe` and `/recipe/:path*` → `index.html`. Each recipe is available at `https://<domain>/recipe/<id>`.

## Main Features
- Save recipes
- Search recipes
- Organize by categories
- User-friendly interface
- Built-in timer
- OCR support for recipe images
- Export and import recipes
- **AI Chat** – get recipe suggestions from your book (e.g. cheesecake, easy meat recipe) and add a recipe from free text (AI parses and pre-fills the add form)

## Local Installation
1. Clone the repository
```bash
git clone https://github.com/yakov100/recipe-book.git
```
2. Open `index.html` in your browser

## AI Chat (recipe-ai)
For the "AI Chat" feature to work, set the `recipe-ai` Edge Function and `GEMINI_API_KEY` in Supabase:

1. Create an API key at [Google AI Studio](https://aistudio.google.com/apikey).
2. In Supabase: **Dashboard** → **Project Settings** → **Edge Functions** → **Secrets**; add `GEMINI_API_KEY` with your key.
3. Or: `supabase secrets set GEMINI_API_KEY=your_key`
4. Deploy: `supabase login` (once if not linked), then `supabase functions deploy recipe-ai` (if developing locally).

### SUPABASE_SERVICE_ROLE_KEY (required for DB read and recipe insert)
For `recipe-ai` to read recipes from the DB and insert new recipes when the user describes one in text:
1. In Supabase: **Dashboard** → **Project Settings** → **API** – copy the **service_role** key (secret, do not expose).
2. In **Edge Functions** → **Secrets**, add:
   - **Key:** `SUPABASE_SERVICE_ROLE_KEY`
   - **Value:** the service_role key.
3. Or: `supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your_key`
`SUPABASE_URL` is usually available in the Edge Functions environment. If missing, add `SUPABASE_URL` (from **Project Settings** → **API** → Project URL).

**Next.js alternative:** For a Next.js app, you can use an API route, Vercel AI SDK, and `GOOGLE_GENERATIVE_AI_API_KEY` instead of the Edge Function. See [docs/AI_CHAT_NEXTJS_GUIDE.md](docs/AI_CHAT_NEXTJS_GUIDE.md).
