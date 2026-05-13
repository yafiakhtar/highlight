# Highlight

**A browser extension for saving and organizing text highlights from the web.**

---

## Features

### Core Highlighting
- **Select & highlight** any text on any webpage via keyboard shortcut (`Ctrl+Shift+H` / `Cmd+Shift+H`), right-click context menu, or the floating action button
- **Click to remove** any highlight directly on the page
- **Multi-part highlights** — selections that span across DOM elements are handled gracefully, stored as a unified highlight with multiple parts
- **Highlight restoration** — highlights are re-applied automatically when you revisit a page
- **Light & dark mode aware** — highlight colors adapt to the page's background theme

### Floating Action Button (FAB)
- Appears beside your text selection for quick one-tap highlighting
- Displays up to 8 slots arranged in a **2×4 grid**, configurable in Settings
- Each slot can hold a color preset or an action button (favorite, comment, copy link, share)
- The FAB can be toggled on/off from the popup or Settings

### Color Presets & Tags
Four named presets — **General, Important, Reference, Question** — each with separate light and dark mode colors. Presets double as tags: highlights are automatically grouped by preset in the Library's Tags view.

### Library
A full-page options view (`options.html`) with a collapsible sidebar and six views:

| View | Description |
|---|---|
| **All** | Every highlight, grouped by page, sorted by most recently updated |
| **Favorites** | Highlights you've starred, across all pages |
| **Tags** | Color presets as tag folders; click any folder to see its highlights |
| **History** | *(coming soon)* |
| **Recently Deleted** | Soft-deleted highlights; restore or permanently delete |
| **Folders** | *(coming soon)* |

- **Search** filters highlights and page titles in real time across all views
- **Star/favorite** any highlight with a single click
- **Soft delete** — deleted highlights go to Recently Deleted before permanent removal
- **Clear all** per page, or empty the whole trash at once
- **Live sync** — the Library updates instantly when highlights change in another tab

### Settings
- **Appearance** — customize light and dark highlight colors with a color picker and hex input; live preview updates as you type
- **Tag Presets** — rename presets and set per-theme colors; auto-match derives a harmonious dark color from a light one (and vice versa) using HSL math
- **FAB Builder** — drag preset chips and action buttons into a 2×4 grid; drag within the grid to reorder; drop onto the remove zone to clear a slot
- **Behaviour** — toggle the floating action button
- **Shortcuts** — view the current keyboard shortcut; button opens browser shortcut settings
- **Data** — save or reset all settings to defaults
- **Sync** — placeholder for cross-device sync (coming soon)

### Popup
- Quick-access toolbar with five buttons: clear page highlights, toggle theme, open settings, toggle FAB, open Library
- Buttons are **drag-reorderable** — your preferred order is persisted
- FAB button icon reflects the last-used preset color (split light/dark halves)

### Dark Mode
- Full dark mode across the popup, Library, and Settings
- Synced across all extension views via `chrome.storage.local`
- Respects light/dark per-page for highlight colors applied to webpage content

### Storage & Data
- All data stored locally via `chrome.storage.local` — no external services
- Highlight index tracks page titles and last-updated timestamps for fast Library rendering
- Self-healing storage: duplicate highlight IDs are merged, malformed data is normalized on read

---

Built by [yafiakhtar.me](https://www.yafiakhtar.me/) · Version 1.0.1