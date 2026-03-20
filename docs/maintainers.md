# Maintainer Notes

## Public Repo Safety

Kuma Picker is meant to be published from its own repository root. Avoid pushing to the public repository from an unrelated private host repository root.

Safer options:

- work directly in the standalone `kuma-picker` clone
- keep a dedicated second clone for the public repo
- export only the Kuma Picker subtree when syncing from a host repo

## If You Mirror From Another Repo

Only export the Kuma Picker subtree, never the other repository's full `main` branch.

Example from another repository:

```bash
git subtree split --prefix <path-to-kuma-picker-in-your-host-repo> -b aldegad/kuma-picker-export
git push public-kuma-picker aldegad/kuma-picker-export:main
```

Before any public push, verify:

```bash
git remote -v
git branch --show-current
git log --oneline --decorate -n 5
```

## Release Checklist

- run `npm install`
- run `npm run test`
- confirm `.github/workflows/secret-scan.yml` is still present

## Kuma Vs Playwright

Prefer Kuma Picker when you need:

- shared browser state across agents
- background-tab DOM reads or debugging
- job-card coordination tied to a picked UI surface
- lightweight browser commands inside the existing daemon workflow

Prefer Playwright when you need:

- full browser ownership in a fresh session
- deep app-specific scripting with custom helper code
- flows that depend on Playwright-only browser contexts, tracing, or auth setup

During Phase 1 browser-control work, benchmark Kuma first on the bundled test apps.
Reach for Playwright when the comparison itself is the task, or when Kuma is missing a primitive that should be designed explicitly instead of improvised ad hoc.
