# Text Highlighter Extension

A simple Chrome/Edge extension to highlight text on any webpage.

## Installation

1. Open Chrome/Edge and go to `chrome://extensions/` (or `edge://extensions/`)
2. Enable **Developer mode** (toggle in top-right corner)
3. Click **Load unpacked**
4. Select the `highlight` folder

## Usage

### Highlight Text
- Select text on any webpage
- **Right-click** and choose "Highlight" from the menu
- Or use keyboard shortcut: **Ctrl+Shift+H** (Cmd+Shift+H on Mac)

### Remove Highlights
- **Click** on any highlight to remove it
- Or select highlighted text, right-click, and choose "Remove Highlight"
- Or click the extension icon and use "Clear All Highlights" button

## Features

- Yellow highlight color
- Highlights persist across page reloads (saved per URL)
- Minimal styling to avoid disrupting page layout
- Works on Chrome and Edge (Manifest V3)

## Note

The extension will work without icon files (Chrome/Edge will show a default icon).
To add custom icons, create PNG files named `icon16.png`, `icon48.png`, and `icon128.png`.
