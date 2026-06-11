# חיבור Gmail MCP ל-Cursor (יועץ עיצוב → טיוטת מייל)

מדריך להגדרת שרת Gmail MCP הרשמי של Google ב-Cursor, כדי שסוכן העיצוב יוכל ליצור **טיוטת מייל** עם דוח הביקורת (לא שליחה אוטומטית).

## מה מקבלים בסוף

אחרי ביקורת עיצוב, אפשר לומר למשל:

> תריץ יועץ עיצוב על localhost:3001 **ושלח לי את המסקנות במייל**

הסוכן ייצור טיוטה ב-Gmail עם הדוח בעברית. אתה בודק ולוחץ "שלח" מ-Gmail.

## דרישות מוקדמות

- חשבון Google
- פרויקט [Google Cloud](https://console.cloud.google.com/) — לפרויקט **recipe-book**: `gen-lang-client-0595932441`
- [Google Cloud CLI](https://cloud.google.com/sdk/docs/install) (אופציונלי — אפשר גם רק דרך המסוף)

## סטטוס הגדרה (recipe-book)

| שלב | סטטוס |
|-----|--------|
| Gmail API + Gmail MCP API | הופעלו |
| Scopes: `gmail.readonly`, `gmail.compose` | נוספו |
| Test user: `yafried100@gmail.com` | נוסף |
| OAuth Client: **Cursor Gmail MCP** (Desktop) | נוצר |
| Cursor `mcp.json` (global + פרויקט) | מוגדר |
| OAuth static client ב-`mcp.json` | **נדרש — ראה שלב 4** |
| אימות OAuth ב-Cursor | **נדרש — ראה שלב 4** |

## שלב 1 — הפעלת APIs

במסוף Google Cloud (החלף `PROJECT_ID`):

```bash
gcloud services enable gmail.googleapis.com --project=PROJECT_ID
gcloud services enable gmailmcp.googleapis.com --project=PROJECT_ID
```

או דרך המסוף: APIs & Services → Enable APIs → חפש **Gmail API** ו-**Gmail MCP API**.

## שלב 2 — מסך הסכמה OAuth

1. **Google Auth Platform → Branding** — אם לא מוגדר, לחץ Get Started.
2. **App name:** `Gmail MCP Server` (או שם אחר).
3. **Audience:** Internal (Workspace) או External + הוספת **Test users** (כתובת Gmail שלך).
4. **Data Access → Add scopes** (הדבקה ידנית):
   - `https://www.googleapis.com/auth/gmail.readonly`
   - `https://www.googleapis.com/auth/gmail.compose`
5. שמור.

## שלב 3 — OAuth Client (Desktop)

ל-Cursor עם `mcp-remote` מומלץ **Desktop application** (לא Web):

1. **Google Auth Platform → Clients → Create Client**
2. סוג: **Desktop app**
3. שם: `Cursor Gmail MCP`
4. אחרי יצירה — הורד/העתק Client ID (אין חובה לשמור secret בקובץ ל-Desktop; `mcp-remote` מנהל OAuth בדפדפן).

אם Cursor מבקש redirect URI מפורש, הוסף:

```text
http://localhost:8787/oauth/callback
```

(הפורט `8787` תואם לקובץ `mcp.json` בפרויקט.)

## שלב 4 — Cursor MCP (מומלץ: OAuth מובנה של Cursor)

בפרויקט `.cursor/mcp.json` משתמש ב-**URL ישיר** (בלי `mcp-remote`):

```json
{
  "mcpServers": {
    "gmail": {
      "url": "https://gmailmcp.googleapis.com/mcp/v1"
    }
  }
}
```

Cursor מנהל OAuth בעצמו דרך `cursor://anysphere.cursor-mcp/oauth/callback` — **לא** דרך `localhost:8787`.

### Redirect URIs ב-GCP (Web client)

ב-**Cursor Gmail MCP Web** הוסף:

- `cursor://anysphere.cursor-mcp/oauth/callback`
- `https://www.cursor.com/agents/mcp/oauth/callback`
- `http://localhost:8787/oauth/callback` (אופציונלי, לגיבוי)

1. **Cursor → Settings → Tools & MCP**
2. רענון / הפעלה מחדש של Cursor
3. ליד `gmail` — **Connect** / **Authenticate** (אם מוצג)
4. התחברות ל-Google והרשאת Gmail
5. ודא שמופיעים כלים כמו `create_draft`, `search_threads`

### אימות

בצ'אט Agent, נסה:

> צור טיוטת מייל אלי עם נושא "בדיקת Gmail MCP" ותוכן "החיבור עובד"

אם נוצרה טיוטה ב-Gmail — ההגדרה תקינה.

## פתרון בעיות

| בעיה | פתרון |
|------|--------|
| הדפדפן לא נפתח באימות | סגור חלונות Cursor נוספים; הרץ שוב Connect; או פתח ידנית את URL מה-Output → MCP |
| `invalid_redirect_uri` | הוסף `http://localhost:8787/oauth/callback` ל-OAuth Client |
| Unauthorized בכלים | התנתק מ-gmail ב-MCP, התחבר מחדש; בדוק Test users ב-External app |
| `does not support dynamic client registration` | הוסף `--static-oauth-client-info` עם client_id/secret (ראה שלב 4) |
| כלים נתקעים 2+ דקות | בדוק static OAuth; סגור חלונות Cursor נוספים; הפעל מחדש |
| אין שרת gmail ברשימה | ודא ש-`.cursor/mcp.json` קיים; הפעל מחדש את Cursor |

## אבטחה

- אל תעלה Client Secret או tokens ל-Git.
- `.cursor/` כבר ב-`.gitignore`.
- הדוח נוצר מהאתר שלך — סיכון prompt injection נמוך; עדיין בדוק טיוטות לפני שליחה.

## קישורים

- [Configure the Gmail MCP server (Google)](https://developers.google.com/workspace/gmail/api/guides/configure-mcp-server)
- סקיל יועץ עיצוב: `.cursor/skills/recipe-book-design-consultant/SKILL.md`
