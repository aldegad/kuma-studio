# Kuma Picker Privacy Policy

Last updated: 2026-03-29

Kuma Picker is a browser extension and local companion daemon for sharing a live browser with a coding agent. This policy describes what the extension handles, where that data goes, and how it is used.

## Summary

- Kuma Picker is designed to be local-first.
- The extension connects only to a user-configured local Kuma Picker daemon, which defaults to `http://127.0.0.1:4312`.
- The extension does not send browsing data to a Kuma-operated remote server.
- The extension only captures or stores page data when the user invokes Kuma Picker features such as picking an element, creating a job card, running browser automation, or starting a live capture/recording flow.

## What data Kuma Picker handles

Depending on the feature the user invokes, Kuma Picker may handle:

- current tab URL, pathname, and page title
- selected element or area metadata such as selector, bounding box, text preview, label, and form state
- viewport screenshots needed to save a pick or fulfill an explicit screenshot command
- job card messages created by the user or agent
- local browser session presence such as active tab id, focus state, and connection heartbeat metadata
- browser console, runtime, network, or debugger-derived diagnostics when the user explicitly runs those debugging or automation features
- recordings or downloaded files when the user explicitly starts live capture or recording features

## How data is used

Kuma Picker uses this data only to provide its user-facing features:

- save a picked element or area into the local shared state
- show job cards anchored to the picked UI
- let an agent automate the user's real browser through the local daemon
- keep browser-session coordination working between the extension and local agent tooling
- create screenshots, recordings, or diagnostic captures the user explicitly requested

Kuma Picker does not sell user data.

## Where data is sent

The extension sends data only to:

- the local Kuma Picker daemon configured by the user, typically on `127.0.0.1` or `localhost`
- Chrome APIs needed to provide browser-native features such as tab capture, downloads, storage, or debugger access

Kuma Picker does not operate a hosted backend that receives browsing data from the extension.

## Local storage

Kuma Picker stores some state locally in the browser and local filesystem, including:

- daemon connection settings
- dismissed job card state
- saved selections, snapshots, and job-card feed data in the local Kuma Picker state home

By default, shared state is stored under `~/.kuma-picker/` unless the user overrides the state-home path.

## When permissions are used

Kuma Picker requests permissions only to support the features it exposes:

- `activeTab`, `tabs`, `scripting`: target the current page and inject the extension runtime
- `storage`: remember local extension settings
- `tabCapture`, `desktopCapture`, `offscreen`, `downloads`, `contentSettings`: provide live capture and recording flows the user explicitly starts
- `debugger`: run optional debugger-based inspection and diagnostics features
- host permissions for `<all_urls>` and local `localhost`/`127.0.0.1` endpoints: let the user pick from arbitrary pages and communicate with the local daemon

## User control

The user controls when Kuma Picker runs. The extension acts only after the user:

- opens the popup
- picks an element or area
- creates or updates a job card
- runs automation through Kuma Picker
- explicitly starts screenshot, recording, or live capture features

The user can remove the extension, clear local storage, or delete local Kuma Picker state at any time.

## Third-party services

Kuma Picker itself does not send extension-collected browsing data to third-party hosted services. If a user separately connects their own local agent tooling, model provider, or external workflow on top of Kuma Picker, that downstream processing is controlled by the user and governed by those separate tools or services.

## Contact

Repository: [https://github.com/aldegad/kuma-picker](https://github.com/aldegad/kuma-picker)

For questions, issues, or privacy concerns, open an issue or contact the maintainer through the repository.
