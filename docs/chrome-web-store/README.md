# Chrome Web Store Submission

This folder contains the materials needed to submit Kuma Picker to the Chrome Web Store.

## Recommended submission mode

Use **deferred publish** (staged review) instead of immediate public release. That lets the item pass review first and keeps the final launch under manual control.

Official docs:

- [Publish your extension](https://developer.chrome.com/docs/extensions/develop/migrate/publish-mv3)
- [Chrome Web Store review process](https://developer.chrome.com/docs/webstore/review-process)
- [Chrome Web Store program policies](https://developer.chrome.com/docs/webstore/program-policies/policies)

## Files in this folder

- [LISTING.md](./LISTING.md): short description, detailed description, category suggestions, and listing notes
- [TEST-INSTRUCTIONS.md](./TEST-INSTRUCTIONS.md): reviewer-ready reproduction steps

## Privacy policy URL

Use the repository-hosted policy:

- [https://github.com/aldegad/kuma-picker/blob/main/PRIVACY.md](https://github.com/aldegad/kuma-picker/blob/main/PRIVACY.md)

## Support URL

Recommended support URL:

- [https://github.com/aldegad/kuma-picker](https://github.com/aldegad/kuma-picker)

## Suggested dashboard values

- Name: `Kuma Picker`
- Summary:
  `Playwright-shaped browser sharing for coding agents, with picks, job cards, and visible paw feedback in your real browser.`
- Category:
  `Developer Tools`
- Language:
  `English`
- Support URL:
  repo root
- Privacy policy URL:
  `PRIVACY.md` GitHub URL above

## Permissions review notes

Kuma Picker requests several high-scrutiny permissions. Reviewers should be told why each one exists:

- `<all_urls>`: users can pick or inspect arbitrary web pages, not one fixed domain
- `debugger`: optional debugger-backed inspection and diagnostic features
- `tabCapture`, `desktopCapture`, `offscreen`, `downloads`, `contentSettings`: optional live capture and recording flows
- `tabs`, `scripting`, `activeTab`, `storage`: core extension runtime and local settings

## Packaging

Build a review ZIP with:

```bash
npm run cws:package
```

Generate the bundled store assets with:

```bash
npm run cws:assets
```

Artifacts land under:

- `artifacts/chrome-web-store/v<manifest-version>/`

## Human-only steps

The agent can prepare everything in-repo, but these still require the maintainer:

1. have or create a Chrome Web Store developer account
2. upload the ZIP in the Developer Dashboard
3. paste the prepared listing and privacy-policy URL
4. upload screenshots/promo assets
5. choose **deferred publish**
6. submit for review
7. manually publish after approval
