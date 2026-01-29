# MCP Server for Vercel

שרת MCP (Model Context Protocol) לאינטגרציה עם Vercel API מ‑Cursor או כל MCP client.

## כלים (Tools)

| Tool | תיאור |
|------|--------|
| `list_projects` | רשימת כל הפרויקטים ב‑Vercel |
| `list_deployments` | רשימת דיפלואים (עם סינון לפי פרויקט, target, state) |
| `get_deployment` | פרטי דיפלוי לפי ID או URL |
| `get_deployment_events` | לוגים/אירועי build של דיפלוי |
| `get_project` | פרטי פרויקט בודד לפי ID או שם |
| `cancel_deployment` | ביטול דיפלוי שב‑BUILDING או QUEUED |

## דרישות

- **Node.js** 18+
- **Vercel Token** – [צור ב‑Vercel](https://vercel.com/account/tokens) והגדר משתנה סביבה.

## התקנה

```bash
cd mcp-vercel
npm install
npm run build
```

## הרצה

```bash
VERCEL_TOKEN=הטוקן_שלך node build/index.js
```

ב‑Windows (PowerShell):

```powershell
$env:VERCEL_TOKEN="הטוקן_שלך"; node build/index.js
```

## חיבור ל‑Cursor

### 1. הגדרת טוקן

הגדר `VERCEL_TOKEN` או `VERCEL_ACCESS_TOKEN`:

- **Windows:** בהגדרות המערכת (משתני סביבה) או ב‑PowerShell:  
  `$env:VERCEL_TOKEN = "xxx"`
- **macOS/Linux:** ב‑`~/.zshrc` / `~/.bashrc`:  
  `export VERCEL_TOKEN=xxx`

או העבר את הטוקן ישירות ב־`env` בהגדרת ה‑MCP (ראו דוגמה למטה).

### 2. הוספת השרת ב‑Cursor

ב‑Cursor: **Settings → MCP → Add new MCP server** (או עריכת `~/.cursor/mcp.json` / קובץ MCP של הפרויקט).

הוסף שרת חדש עם הקונפיגורציה הבאה. **החלף `C:\...\mcp-vercel` בנתיב המלא לתיקיית `mcp-vercel` בפרויקט שלך.**

#### stdio (מומלץ)

**אם VERCEL_TOKEN כבר מוגדר במערכת (משתנה סביבה):**

```json
{
  "mcpServers": {
    "vercel": {
      "command": "node",
      "args": ["C:\\recipe-book-gh-pages\\mcp-vercel\\build\\index.js"]
    }
  }
}
```

**אם מעדיף להעביר את הטוקן רק ל־MCP:**

```json
{
  "mcpServers": {
    "vercel": {
      "command": "node",
      "args": ["C:\\recipe-book-gh-pages\\mcp-vercel\\build\\index.js"],
      "env": {
        "VERCEL_TOKEN": "הטוקן_שלך_מ_Vercel"
      }
    }
  }
}
```

- ב‑Windows: השתמש ב־`\\` או `/` בנתיב.
- ב‑macOS/Linux:  
  `"args": ["/path/to/recipe-book-gh-pages/mcp-vercel/build/index.js"]`

### 3. אימות

אחרי שמירה והפעלה מחדש של Cursor, ה‑tools של `vercel` (למשל `list_projects`, `list_deployments`) אמורים להופיע ב־MCP, וניתן לשאול:  
"תריץ list_projects של Vercel" או "הצג את הדיפלואים האחרונים של הפרויקט X".

## Team ID / Team slug

לחשבון עם Teams, ניתן להעביר `teamId` או `slug` כארגומנטים ל‑tools המתאימים (למשל `list_projects`, `list_deployments`) במקום להגדיר במערכת.

## רישיון

MIT
