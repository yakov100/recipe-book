# הגדרת התחברות Google — ספר המתכונים (recipe-book)

האתר משתמש ב-`signInWithGoogle()` עם Supabase Auth. הקוד שולח חזרה לכתובת **הנוכחית** (localhost או Vercel).

**פרויקט Supabase ייעודי:** `nuaepmndtblpmzbutowy`  
(נפרד מ-Housing units / `nklwzunoipplfkysaztl` מאז יוני 2026)

**Callback ב-Google (חובה ב-OAuth client):**  
`https://nuaepmndtblpmzbutowy.supabase.co/auth/v1/callback`

**Site URL בפרויקט:**  
`https://recipe-book-gh-pages.vercel.app/`

**כתובת production עיקרית (Vercel):**  
`https://recipe-book-gh-pages.vercel.app/`

**GitHub Pages (אופציונלי):**  
`https://yakov100.github.io/recipe-book/`

---

## שלב 1 — Google Cloud Console

1. [Credentials](https://console.cloud.google.com/apis/credentials) → OAuth client (Web application)
2. **Authorized JavaScript origins** — הוסף:
   - `http://localhost:3000`
   - `http://localhost:3001`
   - `https://yakov100.github.io`
3. **Authorized redirect URIs** — הוסף (בנוסף ל-callback הישן אם Housing עדיין משתמש בו):
   ```
   https://nuaepmndtblpmzbutowy.supabase.co/auth/v1/callback
   ```

> אם login עם Google נכשל עם `redirect_uri_mismatch`, חסרה השורה למעלה ב-Google Console.

---

## שלב 2 — Supabase Dashboard

### Providers → Google

[הפעל Google](https://supabase.com/dashboard/project/nuaepmndtblpmzbutowy/auth/providers?provider=Google) — הוגדר אוטומטית בהעברה (אותו Client ID/Secret).

### URL Configuration — Redirect URLs

[Authentication → URL Configuration](https://supabase.com/dashboard/project/nuaepmndtblpmzbutowy/auth/url-configuration)

רשימת **Redirect URLs** (מקור: `js/auth.js` → `RECIPE_BOOK_OAUTH_REDIRECT_URLS`):

```
http://localhost:3000/
http://localhost:3000/**
http://localhost:3001/
http://localhost:3001/**
http://localhost:3002/
http://localhost:3002/**
http://localhost:5173/
http://localhost:5173/**
https://recipe-book-gh-pages.vercel.app/
https://recipe-book-gh-pages.vercel.app/**
https://recipe-book-gh-pages-git-main-yaakovs-projects-c8a05261.vercel.app/
https://recipe-book-gh-pages-git-main-yaakovs-projects-c8a05261.vercel.app/**
https://*.vercel.app/**
https://yakov100.github.io/recipe-book/
https://yakov100.github.io/recipe-book/**
```

---

## שלב 3 — בדיקה

1. `npm run dev` → `http://localhost:3000`
2. **התחבר עם Google**
3. אחרי אישור — חוזרים **לאותו localhost**, שם/תמונה ב-header
4. שיחת AI עובדת רק אחרי התחברות (JWT משתמש)

**קישור שיתוף** `/recipe/:id` — ציבורי בלי login (`get_public_recipe`).

---

## Edge Functions

ודא `GEMINI_API_KEY` (ו-`OPENAI_API_KEY` לתמונות) ב-[Secrets](https://supabase.com/dashboard/project/nuaepmndtblpmzbutowy/settings/functions).  
Deploy: `npm run deploy:functions`

---

## פתרון בעיות

| תסמין | סיבה | פתרון |
|--------|------|--------|
| `redirect_uri_mismatch` | callback חדש חסר ב-Google | הוסף callback של `nuaepmndtblpmzbutowy` (שלב 1) |
| אחרי login חוזרים לאתר אחר | `redirectTo` לא ברשימת Redirect URLs | הוסף כתובת ל-URL Configuration |
| 401 ב-AI | לא מחוברים או JWT לא נשלח | התחבר מחדש; ודא `eyJ…` anon key |
| `provider is not enabled` | Google כבוי ב-Supabase | הפעל Provider |
