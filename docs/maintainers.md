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
