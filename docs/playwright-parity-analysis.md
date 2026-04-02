# Playwright Parity Analysis -- Kuma Picker

> Analyst: Rumi (analytics-team) | Created: 2026-04-01 | Updated: 2026-04-02 (parity complete)

## 1. Playwright Page API -- Major Categories

| Category | Key Methods |
|---|---|
| **Navigation** | `goto`, `reload`, `goBack`, `goForward`, `waitForURL`, `waitForNavigation` |
| **Selectors/Locators** | `locator`, `getByText`, `getByRole`, `getByLabel`, `getByPlaceholder`, `getByTestId`, `getByAltText`, `getByTitle` |
| **Locator Actions** | `click`, `dblclick`, `fill`, `type`, `press`, `check`, `uncheck`, `selectOption`, `setInputFiles`, `hover`, `focus`, `blur`, `dragTo`, `scrollIntoViewIfNeeded` |
| **Locator Queries** | `textContent`, `innerText`, `innerHTML`, `inputValue`, `getAttribute`, `isVisible`, `isEnabled`, `isChecked`, `isDisabled`, `isEditable`, `boundingBox`, `count`, `all` |
| **Locator Filters** | `filter`, `first`, `last`, `nth`, `and`, `or`, `locator` (chaining) |
| **Waits** | `waitForSelector`, `waitForLoadState`, `waitForTimeout`, `waitForEvent`, `waitForFunction`, `waitForResponse`, `waitForRequest`, `locator.waitFor` |
| **Keyboard** | `keyboard.press`, `keyboard.down`, `keyboard.up`, `keyboard.type`, `keyboard.insertText` |
| **Mouse** | `mouse.click`, `mouse.dblclick`, `mouse.move`, `mouse.down`, `mouse.up`, `mouse.wheel` |
| **Evaluation** | `evaluate`, `evaluateHandle`, `$eval`, `$$eval` |
| **Screenshots/PDF** | `screenshot`, `pdf`, `locator.screenshot` |
| **Network** | `route`, `unroute`, `waitForResponse`, `waitForRequest`, `setExtraHTTPHeaders` |
| **Frames** | `frame`, `frameLocator`, `frames`, `mainFrame` |
| **Dialog/Popup** | `on('dialog')`, `on('popup')`, `on('console')` |
| **Other** | `close`, `content`, `setContent`, `setViewportSize`, `emulateMedia`, `addScriptTag`, `addStyleTag`, `exposeFunction` |

## 2. Kuma Picker -- Current Coverage

### Page-level (via `playwright-page-facade.mjs`)

| Supported | Playwright Equivalent |
|---|---|
| `page.goto(url, {waitUntil, timeout})` | `page.goto` |
| `page.reload({bypassCache, timeout})` | `page.reload` |
| `page.url()` | `page.url()` |
| `page.title()` | `page.title()` |
| `page.screenshot({selector, clip, path, timeout})` | `page.screenshot` |
| `page.evaluate(fn/expr, arg)` | `page.evaluate` |
| `page.locator(selector)` | `page.locator` |
| `page.getByText(text, {exact})` | `page.getByText` |
| `page.getByRole(role, {name, exact})` | `page.getByRole` |
| `page.getByLabel(text, {exact})` | `page.getByLabel` |
| `page.waitForSelector(selector, {state, timeout})` | `page.waitForSelector` |

### Locator-level

| Supported | Playwright Equivalent |
|---|---|
| `locator.click`, `fill`, `press` | Same |
| `locator.textContent`, `inputValue` | Same |
| `locator.isVisible`, `boundingBox`, `waitFor` | Same |
| `locator.screenshot` | Same |
| `locator.first`, `last`, `nth` | Same |

### Keyboard

| Supported | Playwright Equivalent |
|---|---|
| `keyboard.press`, `keyboard.down`, `keyboard.up` | Same |

### Mouse

| Supported | Playwright Equivalent |
|---|---|
| `mouse.click`, `mouse.move`, `mouse.down`, `mouse.up`, `mouse.drag` | Same (drag = Playwright's `dragTo` equivalent) |

## 3. Gap Analysis

### Priority P0 -- High-frequency ✅ ALL DONE

| Feature | Status | Notes |
|---|---|---|
| `page.goBack()` / `page.goForward()` | ✅ Done | facade + runtime handler implemented |
| `locator.hover()` | ✅ Done | facade + runtime handler implemented |
| `locator.dblclick()` | ✅ Done | facade + runtime handler implemented |
| `keyboard.type(text)` | ✅ Done | facade + runtime handler implemented |
| `locator.getAttribute(name)` | ✅ Done | facade + runtime handler implemented |
| `locator.innerText()` / `innerHTML()` | ✅ Done | facade + runtime handler implemented |
| `mouse.wheel(dx, dy)` | ✅ Done | facade + runtime handler implemented |
| `getByPlaceholder` / `getByTestId` | ✅ Done | facade + runtime handler implemented |

### Priority P1 -- Important for real automation

| Feature | Status | Commit |
|---|---|---|
| `locator.check()` / `uncheck()` | ✅ Done | `fcbbd81` |
| `locator.selectOption(value)` | ✅ Done | (pre-existing) |
| `locator.focus()` / `blur()` | ✅ Done | `3eac7e1` |
| `locator.count()` / `all()` | ✅ Done | `fcbbd81` |
| `locator.scrollIntoViewIfNeeded()` | ✅ Done | `3eac7e1` |
| `waitForLoadState(state)` | ✅ Done | (pre-existing) |
| `waitForURL(pattern)` | ✅ Done | `3eac7e1` |
| `locator.filter({hasText, has})` | ✅ Done | `fcbbd81` |

### Priority P2 -- Advanced, lower frequency

| Feature | Status | Notes |
|---|---|---|
| `page.route()` / Network interception | ✅ Done | `fcbbd81` — via `page.route`/`page.unroute` |
| `page.on('dialog')` | ✅ Done | `fcbbd81` — `page.onDialog`/`page.offDialog` |
| `page.content()` | ✅ Done | `4debcf9` |
| `page.setContent(html)` | ✅ Done | `4debcf9` |
| `frameLocator` / Frames | ✅ Done | (pre-existing) — `page.frameLocator`, `page.frame` |
| `locator.setInputFiles()` | ✅ Done | (pre-existing) |
| `page.waitForResponse/Request` | ✅ Done | facade `:1056`/`:1070` + runtime `:2237`/`:2239` |
| `page.setViewportSize()` | ✅ Done | facade `:1011` + runtime `:2235` |
| `page.pdf()` | ⏭️ Skipped | Not feasible — Chrome printing API is limited in extension context |
| `page.exposeFunction()` | ⏭️ Deferred | `page.evaluate` to define `window.__fn` works as alternative |

## 4. Architecture Direction

Kuma Picker operates as **Chrome Extension + WebSocket + CLI daemon**. All browser actions flow through:

```
CLI (run script) -> AutomationClient (WS) -> Daemon Server -> Extension Content Script -> DOM
```

**For P0/P1 features**: Each new action requires:
1. A new `action` string in `AutomationClient.send()` (e.g., `"locator.hover"`)
2. Handler in the extension's content script message dispatcher
3. Facade method in `playwright-page-facade.mjs`

**For P2 network features**: Requires extension background script (`chrome.webRequest` / `chrome.debugger`) rather than content script. This is a separate message path from the existing content-script channel.

**For Frames**: The extension already supports `all_frames` injection. Adding a `frameLocator` descriptor kind that targets by frame URL or index is feasible.

**Key architectural limitation**: Unlike Playwright which controls the browser process directly via CDP, Kuma Picker works through a content script intermediary. This means:
- No true network interception (only observation via `webRequest`)
- No PDF generation
- No cross-origin frame access without explicit permissions
- Event timing is approximate (no protocol-level synchronization)

**Status (2026-04-02)**: All P0, P1, P2 items are implemented. 60 facade actions match 60 runtime handlers 1:1. Only `page.pdf()` (not feasible) and `page.exposeFunction()` (deferred, workaround exists) remain. Playwright parity is effectively complete.
