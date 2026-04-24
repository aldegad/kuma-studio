# Distribution Model

Kuma Studio is distributed as a portable operator bundle, not as one single
plugin.

The bundle contains the product source, installer, reusable skills, slash
commands, hooks, cmux scripts, browser extension, server, and private-state
bootstrap rules needed to run the local operator stack.

## Terms

- **Portable operator bundle**: the whole Kuma Studio distribution. This is the
  preferred name for the repo plus installer model.
- **Plugin**: a host-specific package wrapper. Claude and Codex both have plugin
  formats, but those wrappers are not the whole Kuma Studio system.
- **Skill**: one repeatable agent procedure under `skills/<name>/SKILL.md`.
- **Slash command**: a command surface such as `/kuma:plan`; it routes into a
  skill or CLI path.
- **Private brain**: operator-owned `vault/`, `plans/`, and `team.json` state in
  `kuma-studio-private`.
- **Local runtime**: machine-specific runtime state under paths such as
  `~/.kuma/runtime/`, `~/.kuma/dispatch/`, and `~/.kuma/cmux/`.

## Supported Install Shape

The supported install shape is:

```bash
git clone https://github.com/aldegad/kuma-studio.git
cd kuma-studio
npm install
node scripts/install.mjs
npm run kuma-private:bootstrap
npm run skill:doctor
```

`scripts/install.mjs` installs repo-owned skills into both Claude and Codex
skill directories by default, installs hooks and cmux helpers, and links Kuma
bin scripts.

`npm run kuma-private:bootstrap` creates or links the private operator brain
repo and keeps private knowledge out of the public repo.

## Host-Specific Packaging

Claude has a repo-local plugin wrapper:

- `.claude-plugin/plugin.json`
- `.claude/commands/kuma/*.md`
- `skills/*/SKILL.md`

Codex also supports plugins through `.codex-plugin/plugin.json`, and installed
Codex plugins appear under `~/.codex/plugins/cache/...`. Kuma Studio does not
currently ship as a Codex plugin package. The current Codex integration is skill
sync into `~/.codex/skills`.

Do not describe the whole Kuma Studio stack as only "the plugin" in new docs.
Use "portable operator bundle" or "operator stack" for the whole system, and
"Claude plugin wrapper" only for the Claude packaging layer.

## Lifecycle Labels

Historical plan documents should make their outcome explicit:

- `resolution: absorbed` means the old plan was implemented or folded into the
  current model.
- `resolution: abandoned` means the direction was intentionally dropped.
- `resolution: superseded` means a newer plan replaced it.

Do not leave an absorbed plan blocked because one follow-up check remains.
Close the absorbed plan and create a new focused plan for the remaining check.

For Plan document format, use `skills/kuma-plan/SKILL.md` as the SSoT.
