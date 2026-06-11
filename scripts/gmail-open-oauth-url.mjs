#!/usr/bin/env node
/**
 * Opens Google OAuth URL for Gmail MCP (mcp-remote / localhost:8787).
 * Run while Cursor gmail MCP is active, or run gmail-oauth-start.mjs instead.
 */
import { spawn } from "node:child_process";

const CLIENT_ID =
  "346971120395-kvsqpnt4m1v8361372l6erc6goi4ei55.apps.googleusercontent.com";
const REDIRECT = "http://localhost:8787/oauth/callback";
const SCOPES = [
  "https://mail.google.com/",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.metadata",
].join(" ");

const params = new URLSearchParams({
  response_type: "code",
  client_id: CLIENT_ID,
  redirect_uri: REDIRECT,
  scope: SCOPES,
  access_type: "offline",
  prompt: "consent",
});

const url = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;

console.log("Opening Google OAuth in your default browser...\n");
console.log("If the browser does not open, paste this URL manually:\n");
console.log(url);
console.log("\nImportant: approve ONLY while Cursor gmail MCP (mcp-remote) is running and listening on port 8787.");

spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
