# Interaction and performance checks

The gallery remains a static HTML/CSS/JavaScript site. Previewing it needs no build step. The optional development checks use Node 24 and a pinned Playwright development dependency:

```sh
npm ci
npx playwright install chromium
npm test
npm run check:assets
```

On a Linux CI machine, `npx playwright install --with-deps chromium` also installs the browser's required system packages. Use `BROWSER=firefox npm test` after installing Playwright Firefox for the second supported engine. To use an already-installed browser locally, set `BROWSER_EXECUTABLE_PATH` to its executable. The test runner starts and closes its own loopback-only HTTP server and browser.

## Browser coverage

Twenty browser tests cover:

- Skip-link and keyboard activation, a named modal, focus within the modal and restoration on Escape.
- Close-button and backdrop dismissal, clicking inside without dismissal, four successive artwork openings, accurate image/caption state and a single forward viewer entry after closing.
- An immediate close/reopen sequence, protecting a newer image from a queued older close event.
- All four image links with JavaScript disabled, including Back navigation.
- 375px and 1280px layouts at device pixel ratio 1, checking no horizontal overflow, reduced-motion behavior and responsive image selection.
- All four direct artwork links, Close/Escape from initial deep links and reloads, without changing the query string or navigating away.
- Visible restored focus after initial shared-link Close/Escape and reload at desktop/mobile widths, with both motion preferences; ordinary modal Close/Escape and Back/Forward retain scroll position.
- Back/Forward, switching the current artwork and returning to the previous section, with focus restoration after fragment traversal.
- Clipboard success, rejection and absence using controlled browser stubs; failure exposes a labeled read-only field with the complete link selected.
- Unknown and hostile fragments, preserving ordinary modified/non-primary clicks and image URLs.
- A requested Close followed immediately by newer selections while Back is pending; the newest artwork wins.
- Late clipboard success/rejection after changing or closing the viewer, without stale status or focus theft.

The tests block requests outside the local test server. They do not claim complete accessibility conformance or screen-reader coverage; manual assistive-technology review remains useful additional checking. The CI workflow is configured for Chromium and Firefox; WebKit is not currently covered. Narrow viewport tests run desktop browser engines at mobile widths, not physical mobile browsers. Clipboard stubs cover application behavior and do not claim an operating-system clipboard integration pass.

During local deep-link verification on October 4, 2026, all twenty tests passed in Playwright Firefox, and the asset checks passed. A separate Firefox smoke also exercised direct-link load, Close, open, Back and Forward using a local `file://` page. The local Chromium launch could not run because the execution environment denied its process-singleton socket (`Operation not permitted`); this is not a passed Chromium run. The checked-in GitHub Actions workflow runs both engines on Ubuntu. Use the actual commit's CI result to establish current browser-test status.

## Deep-link contract

The four explicit `data-artwork` values in `index.html` are the stable identifiers. Keep them unchanged when editing artwork titles or captions. The script maps an exact fragment to an existing authored link; it never treats fragment text as a selector, HTML, source URL or external request. It uses no analytics, storage, new images or external service.

A normal artwork visit creates one same-page history entry. Selecting another artwork while the viewer is already open replaces that entry; Back closes the visit and Forward opens the last selected artwork. Close/Escape/backdrop use Back only for entries created by this page instance. For initial or reloaded deep links, closing instead removes the artwork fragment with `replaceState`, preserving pathname and query, and reveals the focused artwork if needed. Ordinary visits restore focus without scrolling. Unknown fragments and ordinary section navigation remain available. `href` still points to the full image, preserving modified clicks and no-JavaScript navigation.

## Asset budgets, not speed scores

`npm run check:assets` reads local file sizes and fails when any of these uncompressed budgets are exceeded:

| Asset group | Current bytes | Budget |
| --- | ---: | ---: |
| HTML, CSS, JavaScript and icon shell | 23,599 | 24 KiB |
| All four smaller artwork images | 674,746 | 700 KiB |
| Largest full-size artwork | 1,827,514 | 2 MiB |
| All eight artwork files | 5,082,810 | 5 MiB |

These are repository bytes, **not** a measured first-page network payload. Browser viewport, device pixel ratio, cache, lazy-loading distance, response compression and user interactions affect actual transfers. The larger images are available in `srcset`, so high-density displays can request them before the viewer is opened.

The hero image has high fetch priority; the remaining artwork images are lazy-loaded. Explicit image dimensions reserve space, local WebP files avoid third-party image requests, and the site uses system fonts. These are implementation choices, not proof of a particular Core Web Vitals or Lighthouse score. No production timing, Lighthouse score, load-time promise or field-performance result is claimed here.

To measure real performance, serve the exact commit, record browser/version, viewport, device pixel ratio, cache state and throttling, and retain the generated trace or report. Repeat measurements before drawing conclusions. Artwork sources and attribution remain in [the credits](../credits.html) and [download records](../image-credits.json).
