# Kuma Picker — Installation Guide

This guide is written for **agents** (Claude, Codex, etc.) that need to set up
Kuma Picker. If you are a human reading this, just ask your agent to install it.

## TL;DR for agents

```bash
node scripts/install.mjs
```

Done. The only remaining step requires human action in Chrome (see below).

## What the installer does

| Step | What | Automated? |
|------|------|------------|
| 1 | Check Node.js >= 20 | Yes |
| 2 | `npm install` | Yes (skipped if node_modules exists) |
| 3 | Create shared state home (`$CODEX_HOME/kuma-picker/` or `~/.codex/kuma-picker/`) | Yes |
| 4 | Install Codex skill to `~/.codex/skills/kuma-picker/` | Yes |
| 5 | Install Claude skill to `~/.claude/skills/kuma-picker/` | Yes |
| 6 | Start `kuma-pickerd` daemon on `:4312` | Yes (background process) |
| 7 | Load Chrome extension | **No — human required** |

## Architecture

```
kuma-picker repo (cloned once)
  ├── packages/browser-extension/     ← Chrome loads directly from here
  ├── packages/server/src/cli.mjs     ← daemon + all CLI commands
  └── tools/kuma-pickerd/             ← state management

~/.codex/skills/kuma-picker/          ← Codex global skill
  └── SKILL.md                        ← knows the repo path

~/.claude/skills/kuma-picker/         ← Claude global skill
  └── SKILL.md                        ← points to the same repo

~/.codex/kuma-picker/                 ← shared state
```

No files are copied into target projects. No npm scripts are injected.
The global skill points agents to the repo. Everything runs from the repo.

## The one human step

After automated setup, tell the user:

> Chrome 익스텐션 하나만 직접 로드해주세요:
> 1. `chrome://extensions` 열기
> 2. 우측 상단 **개발자 모드** 켜기
> 3. **압축해제된 확장 프로그램을 로드합니다** 클릭
> 4. kuma-picker 레포의 `packages/browser-extension/` 폴더 선택
> 5. 아무 페이지에서 새로고침 한 번

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
  ✓ state_home         /home/user/.codex/kuma-picker
  ✗ extension_status   No heartbeat. Load the extension...
  ✗ browser_bridge     No live tabs. Open a page...
  ✓ codex_skill       ~/.codex/skills/kuma-picker/SKILL.md
  ✓ claude_skill      ~/.claude/skills/kuma-picker/SKILL.md
  ✓ extension_source   packages/browser-extension
```

Use `--json` for machine-readable output.

## Troubleshooting decision tree

```
doctor fails?
  ├─ node_modules missing     → npm install (from repo root)
  ├─ daemon_reachable fails   → node packages/server/src/cli.mjs serve &
  ├─ extension_status fails   → remind human to load extension
  ├─ browser_bridge fails     → remind human to refresh page
  ├─ global_skill missing     → node scripts/install.mjs
  └─ extension_source missing → check repo integrity (git status)
```

## Updating

```bash
cd ~/kuma-picker && git pull && npm install
node scripts/install.mjs
```

`git pull` updates daemon, extension, and skill source all at once.
The installer re-stamps the global skill with the latest content.
Chrome auto-reloads the extension from the same folder.
