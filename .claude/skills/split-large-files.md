# split-large-files

Scan the codebase for files that are too large and split them into focused, single-responsibility modules.

## When to invoke

- User says "קבצים גדולים מדי", "split files", "פצל קבצים", "קבצים כבדים", or similar
- User asks to "enforce file size" or "keep files small"
- Before writing a new file that will exceed the limit
- After finishing a feature and noticing a file grew too large

## What counts as "too large"

| File type | Soft limit | Hard limit |
|-----------|-----------|------------|
| JS/TS module | 250 lines | 400 lines |
| CSS file | 300 lines | 500 lines |
| Python module | 250 lines | 400 lines |
| Any other source file | 200 lines | 350 lines |

Files under the soft limit: leave alone.
Files between soft and hard: flag, split only if there's a clean boundary.
Files above hard limit: always split.

## Process

### 1. Measure

```bash
wc -l <glob> | sort -rn
```

List every file above its soft limit. Show the table to the user before doing anything.

### 2. Identify split boundaries (for each oversized file)

Read the file and find natural seams:
- Logical groups of functions/classes that share a theme
- Sections already separated by blank lines or comments
- Re-exported symbols (good candidates for their own module)
- Anything that could have a clear, descriptive filename on its own

Never split in the middle of a logical unit. Never create a file with fewer than ~30 lines (too granular).

### 3. Plan before cutting

Announce the proposed split to the user:
```
ai-chat.js (1011 lines) → split into:
  ai-chat-ui.js        (~300 lines) — DOM rendering, message display
  ai-chat-stream.js    (~200 lines) — SSE streaming, abort controller
  ai-chat-voice.js     (~180 lines) — voice input integration
  ai-chat-history.js   (~150 lines) — conversation persistence
  ai-chat.js           (~180 lines) — orchestration, init, exports
```

Wait for user confirmation before proceeding, unless the user explicitly said "just do it".

### 4. Execute the split

- Move code to new files, keeping imports intact
- Update all import sites — grep for every reference to moved symbols
- Re-export from the original file if it's a public API (barrel pattern), or update callers directly if the module is internal
- Delete dead code from the original file

### 5. Verify

```bash
# No file should exceed the hard limit after the split
wc -l <files> | awk '$1 > LIMIT { print }' LIMIT=400

# Build must still pass
npm run build   # or equivalent for this project
```

If build fails, fix imports before committing.

### 6. Commit

One commit per file split, with message:
`refactor: split <filename> into focused modules`

## Rules

- **Single responsibility**: each output file does one thing. Name it after that thing.
- **No circular imports**: if A imports B and B imports A, redesign.
- **Preserve public API**: callers of the original file must not break.
- **No micro-files**: never produce a file under ~30 lines unless it's a pure constants/types file.
- **CSS**: split by component/section, not arbitrarily. Keep related selectors together.
