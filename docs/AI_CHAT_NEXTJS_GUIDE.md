# מדריך הטמעה מלא: צ'אט AI באפליקציית Next.js

מדריך שלב‑אחר‑שלב לחיבור צ'אט עם AI (Google Gemini) בפרויקט Next.js.  
המדריך מניח שאתה משתמש ב‑Next.js App Router. אם השם `/api` שונה אצלך, התאם את המסלולים.

---

## תוכן עניינים

1. [טכנולוגיות](#1-טכנולוגיות)
2. [שלב 1: התקנת חבילות](#שלב-1-התקנת-חבילות)
3. [שלב 2: משתני סביבה ומפתח API](#שלב-2-משתני-סביבה-ומפתח-api)
4. [שלב 3: יצירת API Route](#שלב-3-יצירת-api-route)
5. [שלב 4: קומפוננטת צ'אט (פרונט)](#שלב-4-קומפוננטת-צאט-פרונט)
6. [שלב 5: שילוב ב־Layout](#שלב-5-שילוב-בlayout)
7. [הרחבות: אימות והקשר משתמש](#הרחבות-אימות-והקשר-משתמש)
8. [בדיקות ופתרון תקלות](#בדיקות-ופתרון-תקלות)

---

## 1. טכנולוגיות

| רכיב | תפקיד |
|------|--------|
| **Vercel AI SDK** (`ai`) | פונקציית `streamText` – שליחה ל־LLM וקבלת תשובה בזרימה (streaming) |
| **@ai-sdk/google** | חיבור ל־Google Gemini |
| **zod** | ולידציה ל־body של ה־API (אופציונלי אבל מומלץ) |

המודל: **Gemini 2.0 Flash** (מהיר וזול). ניתן להחליף ל־Gemini אחר או ל־OpenAI אם תתקין `@ai-sdk/openai`.

---

## שלב 1: התקנת חבילות

הרץ:

```bash
npm install ai @ai-sdk/google zod
```

- **`ai`** – חובה (streamText, טיפוסים).
- **`@ai-sdk/google`** – חובה לשימוש ב‑Gemini.
- **`zod`** – אופציונלי; מומלץ לולידציה של `messages`.

אם אין לך `lucide-react` ואתה משתמש באייקונים מהקומפוננטה למטה:

```bash
npm install lucide-react
```

---

## שלב 2: משתני סביבה ומפתח API

### 2.1 קבלת מפתח מ־Google

1. היכנס ל־[Google AI Studio](https://aistudio.google.com/apikey).
2. צור API Key חדש.
3. העתק את המפתח (מתחיל בדרך כלל ב‑`AIza...`).

### 2.2 הגדרה בפרויקט

צור או עדכן `.env.local` בשורש הפרויקט:

```env
GOOGLE_GENERATIVE_AI_API_KEY=AIza...המפתח_שלך...
```

חשוב:

- הקובץ `.env.local` לא נשלח ל‑Git (הוסף ל־`.gitignore` אם עדיין לא).
- ב־Vercel/Netlify וכו': הוסף את המשתנה בהגדרות הפרויקט.
- **אל** תשים את המפתח בקוד או ב־Git.

### 2.3 אופציונלי: קובץ דוגמה

ב־`env.example` או `docs/env.example`:

```env
# Google Gemini – ל־/api/chat
GOOGLE_GENERATIVE_AI_API_KEY=
```

---

## שלב 3: יצירת API Route

### 3.1 מיקום הקובץ

ב־Next.js App Router:

```
src/app/api/chat/route.ts
```

אם המבנה אצלך שונה (למשל `app/` ישירות), התאם:  
`app/api/chat/route.ts`.

### 3.2 גרסה מינימלית (בלי אימות, בלי הקשר)

השתמש בקובץ הזה כבסיס. אחרי שזה עובד, אפשר להוסיף אימות ו־`getUserContext` לפי [הרחבות](#הרחבות-אימות-והקשר-משתמש).

```typescript
// src/app/api/chat/route.ts
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { streamText } from 'ai';
import { z } from 'zod';

export const maxDuration = 30; // שניות – חשוב ל-streaming

const messageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string().min(1).max(4000),
});

const requestSchema = z.object({
  messages: z.array(messageSchema).min(1).max(50),
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = requestSchema.safeParse(body);

    if (!parsed.success) {
      return Response.json(
        { error: 'בקשה לא תקינה', details: parsed.error.issues },
        { status: 400 }
      );
    }

    const { messages } = parsed.data;

    const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    if (!apiKey) {
      return Response.json(
        { error: 'שגיאת קונפיגורציה: חסר מפתח API' },
        { status: 500 }
      );
    }

    const google = createGoogleGenerativeAI({ apiKey });

    const result = await streamText({
      model: google('gemini-2.0-flash'),
      system: `אתה עוזר ידידותי. ענה בעברית.`,
      messages,
      temperature: 0.7,
      maxOutputTokens: 1000,
    });

    return new Response(result.textStream, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  } catch (err) {
    console.error('Chat API Error:', err);
    return Response.json(
      { error: 'אירעה שגיאה בשרת. נסה שוב.' },
      { status: 500 }
    );
  }
}
```

נקודות חשובות:

- **`result.textStream`** – זרימת טקסט (stream). ה־`Content-Type` הוא `text/plain`, לא JSON.
- **`messages`** – מערך `{ role, content }`. ה‑`role` יכול להיות `user` / `assistant` / `system`.
- **`system`** – הנחיות קבועות ל־AI (שפה, טון, תפקיד).
- **`maxDuration`** – ב־Vercel/פרויקטים עם הגבלת זמן; 30 מתאים ל־streaming.

### 3.3 פורמט הבקשה (Body)

ה־client שולח `POST` עם JSON:

```json
{
  "messages": [
    { "role": "user", "content": "שלום, איך אפשר להגדיל צעדים?" },
    { "role": "assistant", "content": "הנה כמה רעיונות..." },
    { "role": "user", "content": "תתן דוגמה אחת" }
  ]
}
```

- לפחות 1 הודעה, עד 50.
- כל `content` עד 4000 תווים (אפשר לשנות ב־`messageSchema`).

### 3.4 פורמט התשובה

- **הצלחה:** `Response` עם `body` = **ReadableStream** (stream של טקסט).  
  ה־client קורא עם `response.body.getReader()` ו־`TextDecoder`.
- **שגיאה:** JSON, למשל `{ "error": "..." }` עם `status` 400/401/500.

---

## שלב 4: קומפוננטת צ'אט (פרונט)

### 4.1 מיקום

למשל:

```
src/components/ai/ChatAssistant.tsx
```

או `src/components/ChatAssistant.tsx` – כרצונך.

### 4.2 קומפוננטה מינימלית עם Streaming

גרסה שמתמקדת בלוגיקה: שליחה ל־`/api/chat`, קריאת ה‑stream ועדכון הודעות.

```tsx
'use client';

import { useState, useRef, useEffect, useCallback, FormEvent } from 'react';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

export function ChatAssistant() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isLoading) return;

    abortRef.current?.abort();
    abortRef.current = new AbortController();

    const userMsg: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text.trim(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setError(null);
    setIsLoading(true);

    try {
      const allMessages = [...messages, userMsg];
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: allMessages.map((m) => ({ role: m.role, content: m.content })),
        }),
        signal: abortRef.current.signal,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `שגיאה ${res.status}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error('אין גוף תשובה');

      const assistantId = `assistant-${Date.now()}`;
      let content = '';

      setMessages((prev) => [...prev, { id: assistantId, role: 'assistant', content: '' }]);

      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        content += decoder.decode(value, { stream: true });
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, content } : m))
        );
      }

      if (!content.trim()) {
        setMessages((prev) => prev.filter((m) => m.id !== assistantId));
        throw new Error('לא התקבלה תשובה');
      }
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return;
      setError(e instanceof Error ? e.message : 'שגיאה');
    } finally {
      setIsLoading(false);
    }
  }, [messages, isLoading]);

  const onSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      sendMessage(input);
    },
    [input, sendMessage]
  );

  return (
    <div style={{ maxWidth: 420, margin: '0 auto', padding: 16 }}>
      <div style={{ marginBottom: 12 }}>
        {messages.map((m) => (
          <div
            key={m.id}
            style={{
              textAlign: m.role === 'user' ? 'left' : 'right',
              marginBottom: 8,
            }}
          >
            <strong>{m.role}:</strong> {m.content || '...'}
          </div>
        ))}
      </div>

      {error && <p style={{ color: 'red', marginBottom: 8 }}>{error}</p>}

      <form onSubmit={onSubmit} style={{ display: 'flex', gap: 8 }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="כתוב הודעה..."
          disabled={isLoading}
          style={{ flex: 1, padding: 8 }}
        />
        <button type="submit" disabled={isLoading || !input.trim()}>
          {isLoading ? '...' : 'שלח'}
        </button>
      </form>
      <div ref={bottomRef} />
    </div>
  );
}
```

נקודות:

1. **`fetch('/api/chat', ...)`**  
   - `body`: `{ messages: [...] }` בדיוק כמו שמתואר ב־3.3.  
   - `signal: abortRef.current.signal` – כדי לאפשר ביטול (סגירת חלון, שליחה חדשה).

2. **Streaming**  
   - `res.body.getReader()` → `reader.read()` בלולאה.  
   - `TextDecoder().decode(value, { stream: true })` – חשוב `stream: true` כדי לא לקצץ תווים בחיתוך.  
   - מעדכנים `content` ומרעננים את הודעת ה־assistant בכל chunk.

3. **`AbortController`**  
   - לפני `fetch` חדש: `abortRef.current?.abort()` ואז ליצור `AbortController` חדש.  
   - ב־`catch`, אם `e.name === 'AbortError'` – לא להציג שגיאה.

4. **`messages` ב־`sendMessage`**  
   - `[...messages, userMsg]` – כי `messages` ב־closure עלול להיות ישן; כך אתה שולח גם את ההודעה החדשה.

אם אתה משתמש ב‑`cn` (utils) או ב‑Tailwind, ניתן להוסיף `className` וכפתורי סגירה/ניקוי בדיוק כמו ב־`ChatAssistant.tsx` מהפרויקט המלא.

---

## שלב 5: שילוב ב־Layout

כדי שהצ'אט יהיה זמין בכל הדפים (או בדפים מסוימים), הוסף את הקומפוננטה ל־layout.

דוגמה ל־`src/app/(app)/layout.tsx` (או `app/layout.tsx`):

```tsx
import { ChatAssistant } from '@/components/ai/ChatAssistant';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <main>{children}</main>
      <ChatAssistant />
    </div>
  );
}
```

אם ה־path של `ChatAssistant` שונה:

```ts
import { ChatAssistant } from '@/components/ChatAssistant';
```

הפעל `npm run dev`, פתח דף שמשתמש ב־layout הזה, שלח הודעה ובדוק שהיא מגיעה ל־`/api/chat` והתשובה מופיעה בזרימה.

---

## הרחבות: אימות והקשר משתמש

אם בפרויקט שלך יש אימות (למשל Supabase) ו־DB עם נתוני משתמש, אפשר להרחיב את ה־API כך:

### א. אימות

בתחילת `POST` ב־`route.ts`:

```ts
import { createClient } from '@/lib/supabase/server'; // או איך שאתה יוצר client

const supabase = await createClient();
const { data: { user }, error } = await supabase.auth.getUser();

if (error || !user) {
  return Response.json({ error: 'יש להתחבר כדי להשתמש בצ\'אט' }, { status: 401 });
}
```

אחרי זה כל השימוש ב־`user.id` ו־`getUserContext` יהיה תחת משתמש מאומת.

### ב. `getUserContext` – נתונים מהדאטאבייס

זה דוגמה מותאמת לפרויקט עם `weight_tracker_settings`, `steps_records`, `weight_records`, `user_gamification`.  
**התאם את השמות של הטבלאות והעמודות** לפרויקט שלך.

```ts
async function getUserContext(supabase: any, userId: string) {
  const [settings, steps, weights] = await Promise.all([
    supabase.from('weight_tracker_settings').select('*').eq('user_id', userId).single(),
    supabase.from('steps_records').select('date, minutes').eq('user_id', userId).limit(30),
    supabase.from('weight_records').select('recorded_at, weight').eq('user_id', userId).limit(30),
  ]);

  return {
    settings: settings.data ?? {},
    steps: steps.data ?? [],
    weights: weights.data ?? [],
  };
}
```

### ג. `buildSystemPrompt`

בנה מחרוזת `system` שמכילה את כל מה שאתה רוצה שיהיה ל־AI (הגדרות, סיכומים, תאריך וכו'):

```ts
function buildSystemPrompt(ctx: Awaited<ReturnType<typeof getUserContext>>) {
  return `אתה עוזר אישי. 
הגדרות: ${JSON.stringify(ctx.settings)}
נתוני צעדים: ${ctx.steps.length} רשומות.
...`;
}
```

ב־`POST`, אחרי האימות:

```ts
const context = await getUserContext(supabase, user.id);
const systemPrompt = buildSystemPrompt(context);
// ...
const result = await streamText({
  model: google('gemini-2.0-flash'),
  system: systemPrompt,  // במקום מחרוזת קבועה
  messages,
  temperature: 0.7,
  maxOutputTokens: 1000,
});
```

אם אין לך את הטבלאות האלו – פשוט תשאיר `system` כטקסט קבוע או תבנה `systemPrompt` מנתונים שכן יש לך (משתמש, הגדרות וכו').

---

## בדיקות ופתרון תקלות

### 1. "שגיאת קונפיגורציה" / 500

- וודא ש־`GOOGLE_GENERATIVE_AI_API_KEY` מוגדר ב־`.env.local` ואין טעות בהעתקה.
- אם השרת רץ ב־Docker / PM2 וכו' – וודא שהמשתנה נטען שם.
- ב־Vercel: Environment Variables בפרויקט.

### 2. "בקשה לא תקינה" / 400

- ה־body חייב להיות JSON עם `messages`: מערך של אובייקטים `{ role, content }`.
- `role`: `user` | `assistant` | `system`.
- `content` מחרוזת לא ריקה.

בדיקה ב־Postman/Insomnia:

```http
POST /api/chat
Content-Type: application/json

{"messages":[{"role":"user","content":"הי"}]}
```

### 3. אין תשובה / תשובה נקטעת

- `maxDuration`: אם הסביבה מקצצת אחרי 10 שניות, העלה ל־30 (או כפי שהפלטפורמה מאפשרת).
- וודא שאתה מחזיר `result.textStream` כמו שמופיע ב־route, ולא `result.text` או JSON.

### 4. הצ'אט לא מתעדכן בזרימה

- וודא שה־API מחזיר `text/plain` עם **stream** (`result.textStream`).
- בצד הלקוח: `res.body.getReader()` ו־`decoder.decode(value, { stream: true })`.
- אל תעשה `await res.json()` על התשובה המצליחה – זו stream.

### 5. CORS

אם אתה קורא מ־דומיין אחר (לא אותו מוצא כמו ה־Next): צריך להגדיר CORS ב־`route.ts` או ב־middleware. כשהפרונט וה־API על אותו ה־origin (למשל `localhost:3000`) – אין צורך.

### 6. `getUser` מחזיר null

- וודא שה־cookie / session של האימות נשלח עם הבקשה (בדפדפן זה קורה אוטומטית לאותו דומיין).
- אם ה־API על subdomain אחר, ייתכן שצריך להגדיר `credentials: 'include'` ב־`fetch` ולהגדיר CORS ו־cookie domain.

---

## רשימת צ'ק – סיכום

- [ ] `npm install ai @ai-sdk/google zod`
- [ ] `GOOGLE_GENERATIVE_AI_API_KEY` ב־`.env.local` (ובהעלאה: ב־Vercel וכו')
- [ ] `src/app/api/chat/route.ts` – `POST`, `streamText`, `result.textStream`
- [ ] קומפוננטת `ChatAssistant`: `fetch('/api/chat', { method: 'POST', body: { messages } })`
- [ ] בצד הלקוח: `response.body.getReader()` + `TextDecoder` + עדכון state בכל chunk
- [ ] `ChatAssistant` ב־layout (או בעמוד רלוונטי)
- [ ] אופציונלי: אימות ו־`getUserContext` + `buildSystemPrompt` מותאם לנתונים שלך

---

## קישורים

- [Vercel AI SDK – streamText](https://sdk.vercel.ai/docs/reference/ai-sdk-core/stream-text)
- [@ai-sdk/google – Gemini](https://sdk.vercel.ai/providers/ai-sdk-providers/google-generative-ai)
- [Google AI Studio – API Keys](https://aistudio.google.com/apikey)

---

אם משהו לא עובד, מומלץ:  
1) לבדוק את ה־Network ב־DevTools – את ה־request ל־`/api/chat` ואת ה־response (stream).  
2) לבדוק לוגים ב־`route.ts` (למשל `console.log` לפני `streamText` ואחרי) כדי לראות אם הבעיה לפני או אחרי הקריאה ל־Gemini.
