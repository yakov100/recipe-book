# הגדרת Secrets לצ'אט AI – הפרויקט שלך

## הקישור הישיר לפרויקט ב-Supabase

**דף ה-Secrets (הוספת מפתחות):**  
https://supabase.com/dashboard/project/nklwzunoipplfkysaztl/settings/functions

(זה הפרויקט שמחובר לאתר ספר המתכונים – `nklwzunoipplfkysaztl`.)

---

## מה לעשות – רק דבר אחד

### להוסיף **GEMINI_API_KEY**

1. **ליצור מפתח ב-Google:**  
   פתח: https://aistudio.google.com/apikey  
   → **Create API Key** → העתק את המפתח.

2. **להוסיף ב-Supabase:**  
   פתח: https://supabase.com/dashboard/project/nklwzunoipplfkysaztl/settings/functions  
   → גלול ל-**Edge Function Secrets** (או **Secrets**)  
   → **Add new secret** / **New secret**  
   - **Name:** `GEMINI_API_KEY`  
   - **Value:** המפתח שהעתקת מ-Google  
   → **Save**.

---

## לגבי SUPABASE_SERVICE_ROLE_KEY ו-SUPABASE_URL

ב-production, Edge Functions של Supabase מקבלות אוטומטית:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

אז בדרך כלל **אין צורך** להוסיף אותם ב-Secrets.  
אם צ'אט ה-AI לא עובד אחרי שהוספת רק `GEMINI_API_KEY`, נסה גם להוסיף את `SUPABASE_SERVICE_ROLE_KEY`:

- **Project Settings** → **API** → ליד **service_role** → **Reveal** → העתק  
- ב-**Edge Function Secrets** הוסף:  
  - **Name:** `SUPABASE_SERVICE_ROLE_KEY`  
  - **Value:** המפתח שהעתקת  

---

## סיכום

| Secret                   | צריך להוסיף? | איפה לקחת |
|--------------------------|--------------|------------|
| `GEMINI_API_KEY`         | **כן**       | [Google AI Studio](https://aistudio.google.com/apikey) → Create API Key |
| `SUPABASE_SERVICE_ROLE_KEY` | בדרך כלל לא (כבר זמין) | אם בכל זאת: **Project Settings** → **API** → service_role → Reveal |
| `SUPABASE_URL`           | לא (כבר זמין) | - |

---

## "לא עובד"? – מה לבדוק

1. **מה בדיוק לא עובד?**  
   - **מתכונים לא נטענים** → בעיה ב-Supabase (טבלת `recipes`, RLS) או בחיבור.  
   - **צ'אט AI** → רוב הסיכויים: `GEMINI_API_KEY` חסר או שגוי. כעת האתר מציג את הודעת השגיאה מהשרת – קרא מה כתוב בתשובת ה-AI.

2. **הודעות נפוצות בצ'אט**  
   - *"נא להגדיר GEMINI_API_KEY ב-Supabase Secrets"* → הוסף את המפתח [בדף ה-Secrets](https://supabase.com/dashboard/project/nklwzunoipplfkysaztl/settings/functions).  
   - *"לא ניתן להתחבר ל-AI"* → בעיית רשת או CORS; נסה דפדפן/רשת אחרת.  
   - *"מפתח ה-API של Gemini לא תקף או חסר"* → הוסף או עדכן GEMINI_API_KEY [בדף ה-Secrets](https://supabase.com/dashboard/project/nklwzunoipplfkysaztl/settings/functions); צור מפתח ב-[Google AI Studio](https://aistudio.google.com/apikey).  
   - *"אין הרשאה לשימוש ב-Gemini"* → המפתח חסום או מוגבל; בדוק הגבלות ב-Google AI Studio.  
   - *"חרגת ממכסת הבקשות"* → חכה כמה דקות ונסה שוב.  
   - *"לא ניתן לתקשר עם ה-AI. נא לבדוק הגדרות"* → שגיאה כללית מ-Gemini; בדוק לוגי ה-Edge Function ב-Supabase.

3. **אחרי שינוי ב-Secrets**  
   הענק ל-Edge Function כמה דקות להתעדכן. אם צריך, הרץ שוב "Deploy" ל-`recipe-ai`.
