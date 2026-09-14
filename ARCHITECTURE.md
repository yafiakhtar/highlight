# Architecture

Highlight is a Manifest V3 browser extension implemented with plain HTML, CSS, and JavaScript. It does not require a build step or UI framework.

## Extension entry points

- `background.js` owns browser commands and context-menu routing.
- `content.js` owns webpage highlighting, restoration, the webpage FAB, and page-level persistence interactions.
- `popup.html` and `popup.js` own the toolbar popup.
- `options.html` owns the Library, Settings, Guide, About, and dialog markup.
- `options.css` owns all presentation for `options.html`, including themes and responsive rules.
- `options.js` owns the Options page shell, Settings, FAB Builder, shortcuts, backup handling, and shared definitions used by Library.
- `options-library.js` owns Library navigation, loading, rendering, filtering, folders, notes, tag reassignment, deletion, and final Options-page initialization.
- `styles.css` owns styles injected into webpages alongside `content.js`.

## Options page loading order

`options.html` loads `options.js` before `options-library.js` as classic scripts. This preserves the existing shared page scope without a bundler. Library code may use definitions established by `options.js`, and final initialization remains at the end of `options-library.js` so both responsibilities are loaded before event wiring and initial rendering begin.

Keep this order unless the Options page is deliberately migrated to an explicit module boundary.

## Storage ownership

Persistent product data remains in `chrome.storage.local`. The file split changes only source-code ownership; it does not change storage keys, schemas, synchronization, or backup behavior.
