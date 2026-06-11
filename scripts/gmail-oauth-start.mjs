#!/usr/bin/env node
import { spawn } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const OAUTH_FILE = "C:/Users/User/.cursor/gmail-oauth-client.json";
const AUTH_URL_RE = /https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth[^\s]*/;

const transport = new StdioClientTransport({
  command: "npx",
  args: [
    "-y",
    "mcp-remote@latest",
    "https://gmailmcp.googleapis.com/mcp/v1",
    "8787",
    "--static-oauth-client-info",
    `@${OAUTH_FILE}`,
  ],
  stderr: "pipe",
});

transport.stderr?.on("data", (chunk) => {
  const text = chunk.toString();
  process.stderr.write(text);
  const match = text.match(AUTH_URL_RE);
  if (match) {
    const url = match[0];
    console.error("\n=== OPENING BROWSER FOR GOOGLE APPROVAL ===\n");
    spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
  }
});

const client = new Client({ name: "gmail-oauth-setup", version: "1.0.0" });

console.log("Starting Gmail OAuth... Complete approval in the browser within 3 minutes.");
console.log("After approval, this window will show SUCCESS.\n");

try {
  await client.connect(transport);
  const result = await client.callTool(
    { name: "list_labels", arguments: {} },
    undefined,
    { timeout: 180_000 }
  );
  console.log("SUCCESS — Gmail MCP is connected.");
  console.log(JSON.stringify(result).slice(0, 400));
} catch (err) {
  console.error("FAILED:", err?.message ?? err);
  process.exitCode = 1;
} finally {
  await client.close();
}
