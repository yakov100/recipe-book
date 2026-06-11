#!/usr/bin/env node
/**
 * Standalone Gmail OAuth (localhost:8787) + optional draft creation.
 * Bypasses Cursor MCP OAuth issues on Windows.
 *
 * Usage:
 *   node scripts/gmail-auth-and-draft.mjs              # auth only, save token
 *   node scripts/gmail-auth-and-draft.mjs --draft      # auth + create UX draft
 */
import { createServer } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";

const OAUTH_CLIENT_FILE = "C:/Users/User/.cursor/gmail-oauth-client.json";
const TOKEN_FILE = "C:/Users/User/.cursor/gmail-token.json";
const CALLBACK_PORT = 8787;
const CALLBACK_PATH = "/oauth/callback";
const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}${CALLBACK_PATH}`;
const SCOPES = [
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/gmail.readonly",
].join(" ");

const createDraft = process.argv.includes("--draft");
const toEmail = "yafried100@gmail.com";

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
          reject(new Error(url.searchParams.get("error_description") ?? url.searchParams.get("error")));
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
      console.log("1. הדפדפן ייפתח עם בקשת אישור מ-Google");
      console.log("2. אשר גישה לחשבון yafried100@gmail.com");
      console.log("3. אחרי האישור — הדף יציג 'האימות הצליח'\n");
      console.log("אם הדפדפן לא נפתח, העתק את הקישור:\n");
      console.log(authUrl);
      console.log("");
      openBrowser(authUrl);
    });

    server.on("error", (err) => {
      if (err.code === "EADDRINUSE") {
        reject(new Error(`Port ${CALLBACK_PORT} in use. סגור Cursor gmail MCP או חלון OAuth אחר ונסה שוב.`));
      } else {
        reject(err);
      }
    });

    setTimeout(() => {
      server.close();
      reject(new Error("OAuth timeout (10 min). נסה שוב."));
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

function buildDraftRaw({ to, subject, bodyText }) {
  const lines = [
    `To: ${to}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject, "utf8").toString("base64")}?=`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(bodyText, "utf8").toString("base64"),
  ];
  return Buffer.from(lines.join("\r\n"), "utf8").toString("base64url");
}

async function createUxDraft(accessToken) {
  const summary = readFileSync(new URL("../docs/ux-audit/email-summary.txt", import.meta.url), "utf8");
  const subject = "ביקורת UX — ספר המתכונים (7.6/10)";
  const body = `${summary}\n\n---\nנוצר אוטומטית מ-recipe-book design consultant.`;

  const raw = buildDraftRaw({ to: toEmail, subject, bodyText: body });
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
  console.log(`Draft created (id: ${data.id}). Open Gmail → Drafts.`);
}

const client = loadClient();
const accessToken = await authorize(client);
if (createDraft) {
  await createUxDraft(accessToken);
} else {
  console.log("Auth OK. Run with --draft to create the UX email draft.");
}
