# הגדרת התחברות Google — ספר המתכונים (recipe-book)

האתר משתמש ב-`signInWithGoogle()` עם Supabase Auth. הקוד שולח חזרה לכתובת **הנוכחית** (localhost או GitHub Pages), לא לפרויקט אחר.

**פרויקט Supabase משותף:** `nklwzunoipplfkysaztl`  
(משמש גם אפליקציות אחרות — **אל תשנה Site URL** אם אפליקציה אחרת תלויה בו)

**Callback ב-Google (קבוע לכל האפליקציות על אותו Supabase):**  
`https://nklwzunoipplfkysaztl.supabase.co/auth/v1/callback`

**כתובת production עיקרית (Vercel):**  
`https://recipe-book-gh-pages.vercel.app/`

**GitHub Pages (אופציונלי):**  
`https://yakov100.github.io/recipe-book/` — כרגע עלול להחזיר 404; אם לא משתמשים בו, אפשר לדלג.

---

## שלב 1 — Google Cloud Console

1. [Credentials](https://console.cloud.google.com/apis/credentials) → OAuth client (Web application)
2. **Authorized JavaScript origins** — הוסף:
   - `http://localhost:3000`
   - `http://localhost:3001`
   - `https://yakov100.github.io`
3. **Authorized redirect URIs** — רק:
   ```
   https://nklwzunoipplfkysaztl.supabase.co/auth/v1/callback
   ```

---

## שלב 2 — Supabase Dashboard (חובה ל-recipe-book)

### Providers → Google

[הפעל Google](https://supabase.com/dashboard/project/nklwzunoipplfkysaztl/auth/providers?provider=Google) עם Client ID + Secret מ-Google.

### URL Configuration — Redirect URLs (הוסף, אל תמחק של אפליקציות אחרות)

[Authentication → URL Configuration](https://supabase.com/dashboard/project/nklwzunoipplfkysaztl/auth/url-configuration)

הוסף לרשימת **Redirect URLs** (העתק הכל — **חובה כולל Vercel**):

```
http://localhost:3000/
http://localhost:3000/**
http://localhost:3001/
http://localhost:3001/**
https://recipe-book-gh-pages.vercel.app/
https://recipe-book-gh-pages.vercel.app/**
https://recipe-book-gh-pages-git-main-yaakovs-projects-c8a05261.vercel.app/
https://recipe-book-gh-pages-git-main-yaakovs-projects-c8a05261.vercel.app/**
https://yakov100.github.io/recipe-book/
https://yakov100.github.io/recipe-book/**
```

אם אחרי login אתה מגיע ל-**Housing_units** או אפליקציה אחרת — כמעט תמיד חסרה כאן שורת ה-**Vercel** למעלה. Supabase אז נופל ל-**Site URL** של הפרויקט המשותף.

**Site URL:** אפשר להשאיר את הכתובת של אפליקציה אחרת (למשל Housing_units).  
recipe-book לא תלוי ב-Site URL כל עוד ה-Redirect URLs למעלה קיימים — הקוד שולח `redirectTo` מדויק.

---

## שלב 3 — בדיקה

1. `npm run dev` → `http://localhost:3000`
2. **התחבר עם Google**
3. אחרי אישור — חוזרים **לאותו localhost**, שם/תמונה ב-header, ספר מתכונים ריק (רק שלך)
4. שיחת AI עובדת רק אחרי התחברות (JWT משתמש)

**קישור שיתוף** `/recipe/:id` — נשאר ציבורי בלי login (`get_public_recipe`).

---

## Supabase משותף — מה משפיע רק על recipe-book

| שינוי | היקף |
|--------|------|
| טבלאות `recipes`, `chat_*`, `recipe_book_settings` + RLS | רק נתוני ספר המתכונים |
| Edge Functions `recipe-ai`, `regenerate-image` | רק אם אפליקציה אחרת קוראת לאותן פונקציות |
| Google Provider + Redirect URLs | משותף — מוסיפים URLs, לא מוחקים של אחרים |

---

## Edge Functions

ודא `GEMINI_API_KEY` ו-`SUPABASE_ANON_KEY` ב-Secrets.  
Deploy: `npm run deploy:functions`

---

## פתרון בעיות

| תסמין | סיבה | פתרון |
|--------|------|--------|
| אחרי login חוזרים ל-Housing_units / אפליקציה אחרת | `redirectTo` לא ברשימת Redirect URLs | הוסף כתובת recipe-book לרשימה (שלב 2) |
| 401 ב-AI | לא מחוברים או JWT לא נשלח | התחבר מחדש; ודא `eyJ…` anon key |
| `provider is not enabled` | Google כבוי ב-Supabase | הפעל Provider |
| מתכונים לא נשמרים | אין `user_id` / לא מחוברים | התחבר; RLS דורש `authenticated` |
