# ניקוי מענפים ו־Git – Recipe Book

## מצב נוכחי
- **main** (ברירת מחדל ב-GitHub): היסטוריה שונה, Supabase, package.json
- **gh-pages**: האתר הסטטי (index.html, js, css, assets) – מפרסם ל־https://yakov100.github.io/recipe-book
- **master**, **vercel**: ענפים נוספים
- **Downloads/recipe-book-gh-pages/**: כפילות בתוך המאגר – להסרה
- לא תחת Git: `docs/`, `supabase/` (צריך להחליט אם לצרף)

## הוראות ניקוי

### 1. גיבוי
- וודא שכל השינויים החשובים (כולל ב־index.html, js/main.js) commit או stashed.

### 2. `main` כמקור האמת לקוד
- העתק את תוכן `gh-pages` (הגרסה העדכנית של האתר) ל־`main`:
  - או: merge של `gh-pages` ל־`main` (אם אין התנגשויות);
  - או: `main` = עותק של `gh-pages` (אם `main` שונה לגמרי ובחרת ב־gh-pages כמקור).

### 3. סנכרון `gh-pages` מ־`main`
- אחרי ש־`main` מעודכן: `gh-pages` יהיה זהה ל־`main` (או רק תת־תיקייה של האתר).
- דחיפה: `git push origin gh-pages` כדי ש־GitHub Pages ימשיך לעבוד.

### 4. הסרת ענפים מיותרים
- מחק **מקומית**: `master` (אם מוחלף על ידי `main`).
- מחק **מרוחק**: `origin/master` (בזהירות, אחרי וידוא).
- **vercel**: מחק רק אם מוזג ל־`main`/`gh-pages` ולא נדרש יותר.

### 5. ניקוי קבצים/תיקיות
- **הסר מהמאגר**: `Downloads/` (כולל `recipe-book-gh-pages/`) – כפילות.
- הוסף ל־`.gitignore`: `Downloads/` (או `Downloads/recipe-book-gh-pages/`).

### 6. קבצים חדשים
- **docs/**: אם שייך לפרויקט – `git add docs/` ו־commit.
- **supabase/**: אם שייך (Edge Functions) – `git add supabase/` ו־commit.

### 7. עדכון `.gitignore`
- וודא: `node_modules/`, `Downloads/`, קבצי IDE, מערכת הפעלה.

### 8. דחיפה סופית
- `git push origin main`
- `git push origin gh-pages`
- אם מחקת ענף מרוחק: `git push origin --delete master` (לדוגמה).

---

## סדר ביצוע מומלץ
1. גיבוי + stash/commit שינויים מקומיים.
2. הסרת `Downloads/` מהמאגר והוספה ל־`.gitignore`.
3. הוספת `docs/` ו־`supabase/` (אם רלוונטי) ו־commit.
4. Merge `gh-pages` → `main` (או החלפת `main` בתוכן `gh-pages` לפי בחירה).
5. סנכרון `gh-pages` מ־`main` ו־push.
6. מחיקת `master` (מקומי ורשת, אם מוחלט).
7. `git push` ל־`main` ו־`gh-pages`.
