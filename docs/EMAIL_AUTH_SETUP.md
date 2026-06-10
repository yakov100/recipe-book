# הגדרת התחברות אימייל + סיסמה — ספר המתכונים

האתר תומך בהתחברות עם **אימייל וסיסמה** (בנוסף ל-Google). אין צורך ב-Redirect URLs או ב-Google Cloud Console.

**פרויקט Supabase:** `nuaepmndtblpmzbutowy`

---

## שלב 1 — Supabase Dashboard

1. פתח [Authentication → Providers → Email](https://supabase.com/dashboard/project/nuaepmndtblpmzbutowy/auth/providers)
2. ודא ש-**Email** מופעל
3. **כבה** את **Confirm email** — כדי שאחרי הרשמה המשתמש ייכנס מיד בלי לאמת מייל

> אם Confirm email דלוק, אחרי הרשמה לא תהיה session עד לחיצה על הקישור במייל. האפליקציה תציג הודעה מתאימה.

### SMTP (אופציונלי — לעתיד)

לשחזור סיסמה (`resetPasswordForEmail`) יש להגדיר SMTP ב-[Project Settings → Auth](https://supabase.com/dashboard/project/nuaepmndtblpmzbutowy/auth/templates). כרגע אין כפתור "שכחתי סיסמה" בממשק.

---

## שלב 2 — בדיקה מקומית

1. `npm run dev` → `http://localhost:3000`
2. במסך ההתחברות: הזן אימייל וסיסמה (לפחות 6 תווים)
3. לחץ **אין לך חשבון? הירשם** → מלא שם (אופציונלי) → **הירשם**
4. אמור להיכנס אוטומטית; שם התצוגה מופיע בפינה הימנית העליונה
5. התנתק → התחבר שוב עם אותו אימייל וסיסמה
6. צור מתכון — נשמר תחת `user_id` שלך (RLS)

**Google:** עדיין זמין מתחת למפריד "או". ראה [GOOGLE_AUTH_SETUP.md](./GOOGLE_AUTH_SETUP.md).

---

## קוד רלוונטי

| קובץ | תפקיד |
|------|--------|
| `js/auth.js` | `signInWithEmailPassword`, `signUpWithEmailPassword` |
| `js/main.js` | טופס authGate, מעבר login/signup, שגיאות בעברית |
| `index.html` | מסך `#authGate` |

---

## פתרון בעיות

| תסמין | סיבה | פתרון |
|--------|------|--------|
| `Email not confirmed` | Confirm email דלוק | כבה ב-Providers → Email, או אמת את המייל |
| `User already registered` | אימייל קיים | התחבר במקום להירשם |
| `Invalid login credentials` | אימייל/סיסמה שגויים | בדוק פרטים או הירשם מחדש |
| אחרי הרשמה לא נכנס | Confirm email דלוק / שגיאת רשת | בדוק Console ו-Supabase Auth logs |
