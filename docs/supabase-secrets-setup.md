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
