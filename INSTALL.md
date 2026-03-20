# Kuma Picker — Installation Guide

This guide is written for **agents** (Claude, Codex, etc.) that need to set up
Kuma Picker. If you are a human reading this, just ask your agent to install it.

## TL;DR for agents

```bash
npm run skill:install
```

Done. The only remaining step requires human action in Chrome (see below).

## What the installer does

| Step | What | Automated? |
|------|------|------------|
| 1 | Check Node.js >= 20 | Yes |
| 2 | `npm install` | Yes (skipped if node_modules exists) |
| 3 | Start `kuma-pickerd` daemon on `:4312` | Yes (background process) |
| 4 | Create `~/.kuma-picker/` state home | Yes |
| 5 | Load Chrome extension | **No — human required** |

## Installing into another project

When a user wants Kuma Picker in their own project:

```bash
npm run skill:install -- --target-project /path/to/their/project
```

This copies skill files to `.claude/skills/kuma-picker/` in the target project
and injects `kuma-pickerd:*` npm scripts into the target `package.json`.

## The one human step

After automated setup, tell the user:

> Chrome 익스텐션 하나만 직접 로드해주세요:
> 1. `chrome://extensions` 열기
> 2. 우측 상단 **개발자 모드** 켜기
> 3. **압축해제된 확장 프로그램을 로드합니다** 클릭
> 4. `packages/browser-extension/` 폴더 선택
> 5. 아무 페이지에서 새로고침 한 번

## Health check

```bash
npm run skill:doctor
```

Outputs a checklist:

```
── Kuma Picker Doctor ──────────────────────────────
  ✓ node_version      v22.x.x
  ✓ node_modules      installed
  ✓ daemon_reachable   http://127.0.0.1:4312
  ✓ state_home         /home/user/.kuma-picker
  ✗ extension_status   No heartbeat. Load the extension...
  ✗ browser_bridge     No live tabs. Open a page...
  ✓ skill_files        present
```

Use `--json` for machine-readable output.

## Troubleshooting decision tree

```
skill:doctor fails?
  ├─ node_modules missing     → npm install
  ├─ daemon_reachable fails   → npm run kuma-pickerd:serve &
  ├─ extension_status fails   → remind human to load extension
  ├─ browser_bridge fails     → remind human to refresh page
  └─ skill_files missing      → npm run skill:install
```

## Architecture (for agents that need context)

```
Chrome Extension  ←WebSocket→  kuma-pickerd daemon  ←Files→  ~/.kuma-picker/
     (human)                     (agent starts)              (shared state)
                                       ↑
                                 npm run kuma-pickerd:*
                                   (agent reads/writes)
```

The agent controls everything except the Chrome extension.
The human does exactly one thing: load the extension.
