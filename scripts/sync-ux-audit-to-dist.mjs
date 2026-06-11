#!/usr/bin/env node
/** Copy docs/ux-audit presentation + screenshots to dist/ux-audit for Vercel hosting */
import { cpSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SRC = resolve(ROOT, "docs/ux-audit");
const DEST = resolve(ROOT, "dist/ux-audit");

const files = ["presentation.html"];
mkdirSync(resolve(DEST, "screenshots"), { recursive: true });

for (const f of files) {
  const src = resolve(SRC, f);
  if (!existsSync(src)) {
    console.error(`Missing ${src}`);
    process.exit(1);
  }
  cpSync(src, resolve(DEST, f));
}

const shots = resolve(SRC, "screenshots");
if (existsSync(shots)) {
  cpSync(shots, resolve(DEST, "screenshots"), { recursive: true });
}

console.log(`Synced UX audit → dist/ux-audit/`);
