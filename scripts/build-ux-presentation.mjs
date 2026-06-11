#!/usr/bin/env node
/**
 * Build interactive RTL presentation from docs/ux-audit/audit-data.json
 * Output: docs/ux-audit/presentation.html
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DATA_FILE = resolve(ROOT, "docs/ux-audit/audit-data.json");
const OUT_FILE = resolve(ROOT, "docs/ux-audit/presentation.html");

const SEVERITY = {
  high: { badge: "badge-high", label: "חומרה גבוהה", row: "severity-high" },
  medium: { badge: "badge-medium", label: "חומרה בינונית", row: "severity-medium" },
  low: { badge: "badge-low", label: "חומרה נמוכה", row: "severity-low" },
  good: { badge: "badge-good", label: "עובד טוב", row: "severity-low" },
};

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function bulletList(items) {
  if (!items?.length) return "";
  return `<ul class="findings">${items
    .map((b) => {
      const label = b.label ? `<strong>${esc(b.label)}</strong> ` : "";
      const text = b.text ?? b;
      return `<li>${label}${typeof text === "string" ? esc(text) : text}</li>`;
    })
    .join("")}</ul>`;
}

function imgBlock(src, caption) {
  if (!src) return "<div></div>";
  return `<div>
    <img class="screenshot" src="${esc(src)}" alt="${esc(caption ?? "")}" />
    ${caption ? `<p class="screenshot-caption">${esc(caption)}</p>` : ""}
  </div>`;
}

function findingSlide(f, slideIndex, findingNum) {
  const sev = SEVERITY[f.severity] ?? SEVERITY.medium;
  const fix = f.fixHtml
    ? f.fixHtml
    : f.fix
      ? `<p>${esc(f.fix)}</p>`
      : "";
  const files = f.fixFiles ? `<p style="margin-top:10px;">קבצים: <code>${esc(f.fixFiles)}</code></p>` : "";
  return `<section class="slide" data-slide="${slideIndex}">
      <div class="slide-card">
        <div class="slide-header">
          <span class="badge ${sev.badge}">${sev.label}</span>
          <h2>בעיה ${findingNum}: ${esc(f.title)}</h2>
          ${f.subtitle ? `<p>${esc(f.subtitle)}</p>` : ""}
        </div>
        <div class="slide-body two-col">
          <div>
            ${f.highlight ? `<div class="highlight-box">${f.highlight}</div>` : ""}
            ${bulletList(f.bullets)}
            ${fix || files ? `<div class="fix-box" style="margin-top:16px;"><h4>${esc(f.fixTitle ?? "תיקון מוצע")}</h4>${fix}${files}</div>` : ""}
          </div>
          ${imgBlock(f.screenshot, f.screenshotCaption)}
        </div>
      </div>
    </section>`;
}

function buildSlides(data) {
  const slides = [];
  let n = 0;
  const m = data.meta ?? {};

  slides.push(`<section class="slide active" data-slide="${n}">
      <div class="slide-card cover">
        <div class="emoji-icon">📋</div>
        <h1>ביקורת UX — ספר המתכונים</h1>
        <p>${esc(m.coverSubtitle ?? "מצגת ממצאים אינטראקטיבית")}</p>
        <div class="overall" style="margin-top:28px;">
          <div class="big">${esc(m.overallScore ?? "—")}</div>
          <div style="color:var(--muted);margin-top:6px;">ציון כללי (מתוך 10)</div>
        </div>
        <p class="meta">${esc(m.coverMeta ?? `${m.date ?? ""} · ${m.url ?? ""} · ${m.mode ?? ""}`)}</p>
      </div>
    </section>`);
  n++;

  const sum = data.summary ?? {};
  const rows = (sum.tableRows ?? []).map((r) => {
    const sev = SEVERITY[r.severity] ?? SEVERITY.medium;
    return `<tr><td>${esc(r.num)}</td><td>${esc(r.issue)}</td><td class="${sev.row}">${sev.label.replace("חומרה ", "")}</td><td>${esc(r.screen)}</td></tr>`;
  });
  const spots = (sum.spotScores ?? [])
    .map(
      (s) =>
        `<div class="score-item"><div class="num">${esc(s.score)}</div><div class="label">${esc(s.label)}</div></div>`
    )
    .join("");

  slides.push(`<section class="slide" data-slide="${n}">
      <div class="slide-card">
        <div class="slide-header"><h2>סיכום ממצאים</h2><p>${esc(sum.intro ?? "")}</p></div>
        <div class="slide-body">
          <table class="summary"><thead><tr><th>#</th><th>בעיה</th><th>חומרה</th><th>מסך</th></tr></thead><tbody>${rows.join("")}</tbody></table>
          ${spots ? `<div class="score-grid" style="margin-top:20px;">${spots}</div>` : ""}
        </div>
      </div>
    </section>`);
  n++;

  let findingNum = 0;
  for (const f of data.findings ?? []) {
    findingNum++;
    slides.push(findingSlide(f, n, findingNum));
    n++;
  }

  const st = data.strengths;
  if (st) {
    slides.push(`<section class="slide" data-slide="${n}">
        <div class="slide-card">
          <div class="slide-header"><span class="badge badge-good">עובד טוב</span><h2>${esc(st.title ?? "מה שעובד היטב")}</h2><p>${esc(st.subtitle ?? "")}</p></div>
          <div class="slide-body two-col">
            <div>${bulletList(st.bullets)}</div>
            ${imgBlock(st.screenshot, st.screenshotCaption)}
          </div>
        </div>
      </section>`);
    n++;
  }

  const qw = data.quickWins ?? [];
  if (qw.length) {
    const qwRows = qw
      .map((q) => {
        const sev = SEVERITY[q.severity] ?? SEVERITY.medium;
        return `<tr><td class="${sev.row}">${esc(q.priority)}</td><td>${esc(q.action)}</td><td>${esc(q.effort)}</td><td>${esc(q.file)}</td></tr>`;
      })
      .join("");
    slides.push(`<section class="slide" data-slide="${n}">
        <div class="slide-card">
          <div class="slide-header"><h2>Quick Wins — סדר עדיפויות</h2><p>שינויים קטנים עם השפעה גדולה</p></div>
          <div class="slide-body">
            <table class="summary"><thead><tr><th>עדיפות</th><th>פעולה</th><th>מאמץ</th><th>קובץ</th></tr></thead><tbody>${qwRows}</tbody></table>
          </div>
        </div>
      </section>`);
  }

  return slides.join("\n");
}

const STYLES = readFileSync(resolve(__dirname, "ux-presentation-styles.css"), "utf8");
const NAV_SCRIPT = readFileSync(resolve(__dirname, "ux-presentation-nav.js"), "utf8");

if (!existsSync(DATA_FILE)) {
  console.error(`Missing ${DATA_FILE} — write audit data before building.`);
  process.exit(1);
}

const data = JSON.parse(readFileSync(DATA_FILE, "utf8"));
const deck = buildSlides(data);
const html = `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>ביקורת UX — ספר המתכונים</title>
  <style>${STYLES}</style>
</head>
<body>
  <div class="deck" id="deck">${deck}</div>
  <nav class="nav-bar" aria-label="ניווט מצגת">
    <button type="button" id="prev" disabled>→ הקודם</button>
    <div class="dots" id="dots"></div>
    <span class="counter" id="counter">1 / 1</span>
    <button type="button" id="next">הבא ←</button>
  </nav>
  <script>${NAV_SCRIPT}</script>
</body>
</html>`;

writeFileSync(OUT_FILE, html, "utf8");
console.log(`Presentation: ${OUT_FILE} (${(data.findings?.length ?? 0) + 3} slides approx.)`);
