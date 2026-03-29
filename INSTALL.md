# Kuma Picker — Installation Guide

This guide is written for **agents** (Claude, Codex, etc.) that need to set up
Kuma Picker, but a human can follow the same steps directly.

## TL;DR for agents

```bash
node scripts/install.mjs
node scripts/install.mjs --also-codex
node scripts/install.mjs --also-claude
node scripts/install.mjs --all
```

Done. The only remaining step requires human action in Chrome (see below).

`node scripts/install.mjs` installs the active agent skill by default.
Use `--also-codex`, `--also-claude`, or `--all` only when you explicitly want extra skill targets stamped in the same run.

## Install model

Kuma Picker is meant to feel like three install parts:

- one repo/daemon checkout
- one Chrome extension load
- one agent skill install (Codex or Claude)

The shared state home at `~/.kuma-picker/` is created automatically and is not a separate install target.

## What the installer does

| Step | What | Automated? |
|------|------|------------|
| 1 | Check Node.js >= 20 | Yes |
| 2 | `npm install` | Yes (skipped if node_modules exists) |
| 3 | Create shared state home `~/.kuma-picker/` | Yes |
| 4 | Install the active agent skill (`~/.codex/...` or `~/.claude/...`) | Yes |
| 4b | Install other agent skill targets via `--also-*` or `--all` | Optional |
| 5 | Start `kuma-pickerd` daemon on `:4312` | Yes (background process) |
| 6 | Load Chrome extension | **No — human required** |

## Architecture

```
kuma-picker repo (cloned once)
  ├── packages/browser-extension/     ← Chrome loads directly from here
  ├── packages/server/src/cli.mjs     ← daemon + all CLI commands
  └── tools/kuma-pickerd/             ← state management

~/.codex/skills/kuma-picker/          ← Codex skill target
  └── SKILL.md                        ← points at the same repo

~/.claude/skills/kuma-picker/         ← Claude skill target
  └── SKILL.md                        ← points at the same repo

~/.kuma-picker/                       ← shared state for both Claude and Codex
```

No files are copied into target projects. No npm scripts are injected.
The active agent skill points agents to the repo. Everything runs from the repo.

## The one human step

After automated setup, tell the user:

> Please load the Chrome extension manually:
> 1. Open `chrome://extensions`
> 2. Turn on **Developer mode** in the top-right corner
> 3. Click **Load unpacked**
> 4. Select the `packages/browser-extension/` folder from the kuma-picker repo
> 5. Refresh any open page once

## Health check

```bash
node scripts/doctor.mjs
```

Outputs a checklist:

```
── Kuma Picker Doctor ──────────────────────────────
  ✓ node_version       v22.x.x
  ✓ node_modules       installed
  ✓ daemon_reachable   http://127.0.0.1:4312
  ✓ state_home         /home/user/.kuma-picker
  ✗ extension_status   No heartbeat. Load the extension...
  ✗ browser_bridge     No live tabs. Open a page...
  ✓ codex_skill        /path/to/installed-skill-or-optional-note
  ✓ claude_skill       /path/to/installed-skill-or-optional-note
  ✓ extension_source   packages/browser-extension
```

The active agent skill is required. The other skill target is informational unless you explicitly install it.

Use `--json` for machine-readable output.

## Troubleshooting decision tree

```
doctor fails?
  ├─ node_modules missing     → npm install (from repo root)
  ├─ daemon_reachable fails   → node packages/server/src/cli.mjs serve &
  ├─ extension_status fails   → remind human to load extension
  ├─ browser_bridge fails     → remind human to refresh page
  ├─ active skill missing     → node scripts/install.mjs
  ├─ optional extra skill     → node scripts/install.mjs --all
  └─ extension_source missing → check repo integrity (git status)
```

## Updating

```bash
cd ~/kuma-picker && git pull && npm install
node scripts/install.mjs
```

`git pull` updates daemon, extension, and skill source all at once.
The installer re-stamps the selected skill targets with the latest content.
If the extension code changed, reload the unpacked extension once in `chrome://extensions`
before trusting new browser-side behavior or benchmark numbers.
