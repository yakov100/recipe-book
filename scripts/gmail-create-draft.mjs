#!/usr/bin/env node
/**
 * Gmail OAuth + create draft from a report file (design consultant).
 *
 * Usage:
 *   node scripts/gmail-create-draft.mjs --subject "..." --body-file path/to/report.txt
 *   node scripts/gmail-create-draft.mjs --to other@example.com --subject "..." --body-file report.txt
 *   node scripts/gmail-create-draft.mjs --auth-only
 */
import { createServer } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join, relative } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKSPACE = resolve(__dirname, "..");
const OAUTH_CLIENT_FILE = "C:/Users/User/.cursor/gmail-oauth-client.json";
const TOKEN_FILE = "C:/Users/User/.cursor/gmail-token.json";
const DEFAULT_TO_FILE = resolve(
  WORKSPACE,
  ".cursor/skills/recipe-book-design-consultant/draft-to.txt"
);
const DEFAULT_PRESENTATION_URL_FILE = resolve(
  WORKSPACE,
  ".cursor/skills/recipe-book-design-consultant/presentation-url.txt"
);
const ATTACH_MAX_BYTES = Number(process.env.GMAIL_ATTACH_MAX_MB ?? 5) * 1024 * 1024;
const CALLBACK_PORT = 8787;
const CALLBACK_PATH = "/oauth/callback";
const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}${CALLBACK_PATH}`;
const SCOPES = [
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/gmail.readonly",
].join(" ");

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}

const authOnly = process.argv.includes("--auth-only");
const subject = arg("--subject");
const bodyFile = arg("--body-file");
const attachDir = arg("--attach-dir");
const presentationUrl =
  arg("--presentation-url") ??
  (existsSync(DEFAULT_PRESENTATION_URL_FILE)
    ? readFileSync(DEFAULT_PRESENTATION_URL_FILE, "utf8").trim()
    : null);
const toEmail =
  arg("--to") ??
  process.env.GMAIL_DRAFT_TO ??
  (existsSync(DEFAULT_TO_FILE)
    ? readFileSync(DEFAULT_TO_FILE, "utf8").trim()
    : null);

function loadClient() {
  const raw = JSON.parse(readFileSync(OAUTH_CLIENT_FILE, "utf8"));
  return { clientId: raw.client_id, clientSecret: raw.client_secret };
}

function b64url(buf) {
  return buf.toString("base64url");
}

function makePkce() {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

function openBrowser(url) {
  spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
}

function loadToken() {
  if (!existsSync(TOKEN_FILE)) return null;
  try {
    return JSON.parse(readFileSync(TOKEN_FILE, "utf8"));
  } catch {
    return null;
  }
}

function saveToken(token) {
  writeFileSync(TOKEN_FILE, JSON.stringify(token, null, 2), "utf8");
  console.log(`Token saved: ${TOKEN_FILE}`);
}

async function refreshIfNeeded(token, client) {
  const expiresAt = token.obtained_at + (token.expires_in ?? 3600) * 1000;
  if (Date.now() < expiresAt - 60_000) return token.access_token;

  const body = new URLSearchParams({
    client_id: client.clientId,
    client_secret: client.clientSecret,
    grant_type: "refresh_token",
    refresh_token: token.refresh_token,
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`Refresh failed: ${res.status} ${await res.text()}`);
  const next = await res.json();
  const merged = { ...token, ...next, obtained_at: Date.now() };
  saveToken(merged);
  return merged.access_token;
}

async function authorize(client) {
  const existing = loadToken();
  if (existing?.refresh_token) {
    try {
      const access = await refreshIfNeeded(existing, client);
      console.log("Using saved Gmail token.");
      return access;
    } catch (err) {
      console.warn("Saved token invalid, re-authorizing:", err.message);
    }
  }

  const { verifier, challenge } = makePkce();
  const state = b64url(randomBytes(16));
  const params = new URLSearchParams({
    response_type: "code",
    client_id: client.clientId,
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    access_type: "offline",
    prompt: "consent",
  });
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;

  const code = await new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      try {
        const url = new URL(req.url ?? "/", `http://localhost:${CALLBACK_PORT}`);
        if (url.pathname !== CALLBACK_PATH) {
          res.writeHead(404);
          res.end("Not found");
          return;
        }
        if (url.searchParams.get("error")) {
          reject(
            new Error(url.searchParams.get("error_description") ?? url.searchParams.get("error"))
          );
          res.writeHead(400);
          res.end("Authorization failed. You can close this tab.");
          server.close();
          return;
        }
        const gotState = url.searchParams.get("state");
        const gotCode = url.searchParams.get("code");
        if (gotState !== state || !gotCode) {
          res.writeHead(400);
          res.end("Invalid OAuth response.");
          return;
        }
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end("<h1>האימות הצליח!</h1><p>אפשר לסגור את הטאב ולחזור ל-Cursor.</p>");
        server.close();
        resolve(gotCode);
      } catch (e) {
        reject(e);
        server.close();
      }
    });

    server.listen(CALLBACK_PORT, "127.0.0.1", () => {
      console.log("\n=== Gmail OAuth ===");
      console.log("אשר גישה בדפדפן. אחרי האישור — 'האימות הצליח'.\n");
      console.log(authUrl);
      console.log("");
      openBrowser(authUrl);
    });

    server.on("error", (err) => {
      if (err.code === "EADDRINUSE") {
        reject(
          new Error(`Port ${CALLBACK_PORT} in use. סגור gmail MCP ב-Cursor ונסה שוב.`)
        );
      } else {
        reject(err);
      }
    });

    setTimeout(() => {
      server.close();
      reject(new Error("OAuth timeout (10 min)."));
    }, 600_000);
  });

  const body = new URLSearchParams({
    code,
    client_id: client.clientId,
    client_secret: client.clientSecret,
    redirect_uri: REDIRECT_URI,
    grant_type: "authorization_code",
    code_verifier: verifier,
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`);
  const token = { ...(await res.json()), obtained_at: Date.now() };
  saveToken(token);
  return token.access_token;
}

function mimeTypeFor(name) {
  if (name.endsWith(".html")) return "text/html; charset=UTF-8";
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  return "application/octet-stream";
}

function collectAttachments(dir) {
  const base = resolve(dir);
  const files = [];
  const pres = join(base, "presentation.html");
  if (existsSync(pres)) files.push(pres);
  const shots = join(base, "screenshots");
  if (existsSync(shots)) {
    for (const name of readdirSync(shots)) {
      if (/\.(png|jpe?g|webp)$/i.test(name)) files.push(join(shots, name));
    }
  }
  return files.map((path) => {
    const data = readFileSync(path);
    const rel = relative(base, path).replace(/\\/g, "/");
    return { filename: rel.includes("/") ? rel.replace("/", "-") : rel, path, data, mimeType: mimeTypeFor(path) };
  });
}

function buildDraftRaw({ to, subject, bodyText, attachments = [] }) {
  const subjectB64 = `=?UTF-8?B?${Buffer.from(subject, "utf8").toString("base64")}?=`;

  if (!attachments.length) {
    const lines = [
      `To: ${to}`,
      `Subject: ${subjectB64}`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      Buffer.from(bodyText, "utf8").toString("base64"),
    ];
    return Buffer.from(lines.join("\r\n"), "utf8").toString("base64url");
  }

  const boundary = `mix_${randomBytes(12).toString("hex")}`;
  const parts = [
    `To: ${to}`,
    `Subject: ${subjectB64}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(bodyText, "utf8").toString("base64"),
  ];

  for (const att of attachments) {
    const encName = `=?UTF-8?B?${Buffer.from(att.filename, "utf8").toString("base64")}?=`;
    parts.push(
      `--${boundary}`,
      `Content-Type: ${att.mimeType}; name="${encName}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${encName}"`,
      "",
      att.data.toString("base64")
    );
  }
  parts.push(`--${boundary}--`);
  return Buffer.from(parts.join("\r\n"), "utf8").toString("base64url");
}

async function createDraft(accessToken, { to, subject, bodyText, attachments = [] }) {
  const raw = buildDraftRaw({ to, subject, bodyText, attachments });
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/drafts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message: { raw } }),
  });
  if (!res.ok) throw new Error(`create_draft failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  console.log(`Draft created (id: ${data.id}) → ${to}`);
  return data.id;
}

if (!authOnly) {
  if (!subject || !bodyFile) {
    console.error(
      "Usage: node scripts/gmail-create-draft.mjs --subject \"...\" --body-file path/to/report.txt [--to email]"
    );
    process.exit(1);
  }
  if (!toEmail) {
    console.error("Missing --to or draft-to.txt or GMAIL_DRAFT_TO");
    process.exit(1);
  }
  if (!existsSync(bodyFile)) {
    console.error(`Body file not found: ${bodyFile}`);
    process.exit(1);
  }
}

const client = loadClient();
const accessToken = await authorize(client);

if (authOnly) {
  console.log("Auth OK.");
} else {
  let bodyText = readFileSync(resolve(bodyFile), "utf8");
  const footer = "\n\n---\nנוצר אוטומטית מ-recipe-book design consultant.";
  let attachments = [];
  let attachNote = "";

  if (attachDir && existsSync(resolve(attachDir))) {
    const candidates = collectAttachments(attachDir);
    const totalBytes = candidates.reduce((n, a) => n + a.data.length, 0);
    if (totalBytes <= ATTACH_MAX_BYTES && candidates.length) {
      attachments = candidates;
      attachNote = `\n\n📎 המצגת מצורפת (${candidates.length} קבצים, ${(totalBytes / 1024).toFixed(0)} KB).`;
      console.log(`Attaching presentation (${(totalBytes / 1024).toFixed(0)} KB).`);
    } else {
      attachNote = `\n\n📎 המצגת כבדה מדי לצירוף (${(totalBytes / 1024 / 1024).toFixed(1)} MB) — קישור:`;
      console.log(`Skip attach: ${(totalBytes / 1024 / 1024).toFixed(1)} MB > limit.`);
    }
  }

  if (presentationUrl) {
    bodyText += attachNote ? `${attachNote}\n${presentationUrl}` : `\n\n🎞️ מצגת אינטראקטיבית:\n${presentationUrl}`;
  }

  await createDraft(accessToken, {
    to: toEmail,
    subject,
    bodyText: bodyText + footer,
    attachments,
  });
}
