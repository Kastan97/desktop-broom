# 🧹 Desktop Broom — Freeware Problem Solver

Fun, safe, **undoable** freeware that sweeps a messy folder (your Desktop, Downloads, anywhere)
into tidy folders — and, with an optional AI key, reads your files and gives them clean,
human-readable names.

**Nothing is ever deleted.** Every move is logged to `_DesktopBroom/undo_log.tsv`, and one
command puts it all back. Meet **Sweepy**, the broom that does the work. 🧹

> 🌐 [desktopbroom.com](https://desktopbroom.com) · 💸 donation-supported · 🪟 Windows now · 📱 iPhone soon

![Desktop Broom](logo.svg)

## Two modes

| Mode | Needs a key? | What it does |
|------|--------------|--------------|
| **Rules** (default) | No — 100% offline | Buckets files by type: Images, PDFs, Documents, Installers, Archives, Code… |
| **AI / Smart** (`--ai`) | Yes — your own key | Reads names + text snippets and proposes purpose-based folders and clean filenames |

### Connect an AI key (bring-your-own)
Freeware can't ship a paid key, so you bring your own. **Supported: Claude, GPT, DeepSeek.**

- Interactive: just run the app and answer **"Use SMART AI mode?"**, or run `DesktopBroom.exe setup`
  to pick a provider, paste a key, and (optionally) save it for next time.
- Or via environment variables / flags:
  ```
  setx DESKTOPBROOM_API_KEY  "sk-..."
  setx DESKTOPBROOM_PROVIDER "gpt"     # anthropic | gpt | deepseek
  DesktopBroom.exe plan "C:\Users\me\Downloads" --ai --provider deepseek --key sk-...
  ```

## Usage

Double-click `DesktopBroom.exe` for a friendly interactive run, or from a terminal:

```
DesktopBroom.exe                                   # interactive (picks Desktop by default)
DesktopBroom.exe plan   "C:\Users\me\Downloads"    # preview, then confirm
DesktopBroom.exe apply  "C:\Users\me\Downloads" --yes
DesktopBroom.exe revert "C:\Users\me\Downloads"    # undo everything
DesktopBroom.exe setup                             # connect / change your AI key
DesktopBroom.exe how                               # what it is + why it's safe
```

Run from source (no build needed): `node desksweep.js plan "C:\path"`

## Build the .exe

Node 20+ (uses Node's built-in Single Executable Application feature):
```
npm run build      # -> DesktopBroom.exe (first run fetches postject via npx)
```

## Why it's safe 🛡️
- **Never deletes** anything, ever.
- Only touches **loose files at the top level** — never your existing folders, projects, or code.
- Shows you a **plan first**; nothing moves until you confirm.
- Name clash? adds ` (1)`, ` (2)` — never overwrites.
- Full undo log + one-command `revert`.
- AI is **optional** and uses **your** key.

## The (quirky) fine print
Provided **"AS-IS" with no warranty**. We are not responsible if your computer blows up, your
files stage a revolt, or anything else quirky happens. You run it, you own it. (Relax — it only
moves files and can undo everything.) MIT licensed — do whatever you want.

## Support it 💸
Desktop Broom is **free forever**. If it saved you time, donations keep Sweepy in bristles —
see [desktopbroom.com](https://desktopbroom.com).
