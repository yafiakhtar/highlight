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

- **Quick access** — appears beside selected text for one-tap highlighting
- **Custom layout** — displays up to eight slots in a configurable 2×4 grid
- **Flexible controls** — place, swap, reorder, replace, or remove tag presets and actions
- **Favorite action** — create a default-tag favorite directly, or choose a tag color first and favorite that same highlight during the retained FAB window
- **Folder action** — file a newly highlighted selection through a searchable recent-folder picker, including create-from-search
- **In-place recoloring** — choosing another tag during the retained window updates the same highlight instead of creating a duplicate
- **Visibility control** — toggle the FAB from the popup or Settings
- **Coming soon** — Comment, Copy link, and Share remain clearly labeled as unfinished

### Color Presets & Tags

Four named presets — **General, Important, Reference, Question** — are included by default. Presets double as tags: highlights store the preset ID rather than a fixed color and are automatically grouped in the Library's Tags view.

- **Custom tags** — add, rename, recolor, and delete tags from Settings
- **Theme-aware colors** — assign separate light and dark colors or derive one from the other
- **Automatic propagation** — names and colors update across Settings, the FAB, Library, open webpages, and pages loaded later
- **Safe default** — `preset1` can be renamed or recolored but is always retained as the fallback tag

### Library

A full-page options view (`options.html`) with a collapsible sidebar and several views:

| View | Description |
| --- | --- |
| **All** | Every highlight, grouped by page, sorted by most recently updated |
| **Favorites** | Highlights you've starred, across all pages |
| **Tags** | Color presets as tag folders; click any folder to see its highlights |
| **Folders** | Create, rename, delete, and browse single-membership highlight folders |
| **Recently Deleted** | Soft-deleted highlights; restore or permanently delete |

- **Search** filters highlights and page titles in real time across all views
- **Star/favorite** any highlight with a single click
- **Reassign tags in place** — click a highlight's tag color in All or Favorites, choose any built-in or custom tag, or jump directly to Tag Presets management
- **Immediate recoloring** — tag reassignment updates already-open webpages and is preserved on future visits
- **Folder organization** — assign or move highlights from All and Favorites, expand folder navigation in the sidebar, and browse each folder by webpage
- **Safe folder deletion** — keep a deleted folder's highlights as unfiled or move them to Recently Deleted
- **Soft delete** — deleted highlights go to Recently Deleted before permanent removal
- **Bulk cleanup** — clear every highlight from one page or empty Recently Deleted entirely
- **Live updates** — the Library refreshes when highlight data changes in another tab

### Settings

- **Unified layout** — a single scrollable page with a desktop section index and automatic saving
- **Appearance** — edit the default tag's linked light/dark colors and preview any tag in compact Light and Dark rows
- **Tag Presets** — add, rename, recolor, or delete custom presets; matching controls derive a harmonious paired theme color using HSL math
- **FAB Builder** — toggle the floating button, click or drag items into the 2×4 layout, swap/reorder/remove buttons, and review a centered compact preview
- **Shortcuts** — display the detected Chrome shortcut as individual keyboard keycaps and open the browser's shortcut settings
- **Reset settings** — restore the built-in presets, appearance, FAB visibility, and default FAB layout without deleting saved highlights or Library records
- **Sync** — placeholder for cross-device sync (coming soon)

### Popup

- **Quick-access toolbar** — clear page highlights, toggle theme, open Settings, toggle the FAB, or open Library
- **Drag-reorderable buttons** — customize the toolbar order and retain it between sessions
- **Preset indicator** — the FAB icon reflects the last-used preset with split light/dark colors

### Dark Mode

- **Complete interface theming** — dark mode covers the popup, Library, and Settings
- **Shared preference** — the selected theme is synchronized across extension views through `chrome.storage.local`
- **Page-aware highlights** — webpage colors use the appropriate light or dark value from each preset

### Storage & Data

- **Local-first storage** — all data remains in `chrome.storage.local`; no external service is used
- **Indexed Library** — page titles and last-updated timestamps support fast rendering and ordering
- **Self-healing records** — duplicate highlight IDs are merged and malformed data is normalized on read

---

Built by [yafiakhtar.me](https://www.yafiakhtar.me/) · Version 1.0.1
