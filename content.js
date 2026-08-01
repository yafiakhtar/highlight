// Default settings
const DEFAULT_SETTINGS = {
  colorLight: '#FFEA99',
  colorDark: '#7C6129',
  showFab: true,
  // Four quick highlight presets for the FAB palette.
  // Each preset has a name and per-theme colors.
  presets: [
    {
      id: 'preset1',
      name: 'General',
      colorLight: '#FFEA99',
      colorDark: '#7C6129'
    },
    {
      id: 'preset2',
      name: 'Important',
      colorLight: '#FFD1A3',
      colorDark: '#A05A1F'
    },
    {
      id: 'preset3',
      name: 'Reference',
      colorLight: '#C7F0D8',
      colorDark: '#2E7C4F'
    },
    {
      id: 'preset4',
      name: 'Question',
      colorLight: '#CDE5FF',
      colorDark: '#245B9B'
    }
  ]
};

let userSettings = { ...DEFAULT_SETTINGS };
let fabLayoutV1 = null;

const FAB_LAYOUT_KEY = 'fabLayoutV1';
const FOLDERS_KEY = 'highlightFoldersV1';
const FAB_ACTION_IDS = new Set(['favorite', 'folder', 'close', 'comment', 'copyLink', 'share']);
const MAX_FOLDER_NAME_LENGTH = 60;
const RECENT_FOLDER_LIMIT = 5;

function defaultFabLayoutV1() {
  return { rows: 2, cols: 4, slots: ['preset1', 'preset2', 'preset3', 'preset4', null, null, null, null] };
}

function reconcileFabLayoutV1(raw) {
  const base = defaultFabLayoutV1();
  const expected = base.rows * base.cols;
  const rawSlots = raw && Array.isArray(raw.slots) ? raw.slots.slice(0, expected) : [];
  while (rawSlots.length < expected) rawSlots.push(null);

  const presetIds = new Set(getPresets().map(preset => preset.id));
  const allowed = new Set([...presetIds, ...FAB_ACTION_IDS]);
  const presentValidIds = new Set(rawSlots.filter(id => typeof id === 'string' && allowed.has(id)));
  const slots = rawSlots.map((slotId, index) => {
    if (slotId == null) return null;
    if (typeof slotId === 'string' && allowed.has(slotId)) return slotId;

    const expectedPresetId = index < 4 ? `preset${index + 1}` : null;
    if (expectedPresetId && presetIds.has(expectedPresetId) && !presentValidIds.has(expectedPresetId)) {
      presentValidIds.add(expectedPresetId);
      return expectedPresetId;
    }
    return null;
  });

  const layout = { rows: base.rows, cols: base.cols, slots };
  const changed =
    !raw ||
    typeof raw !== 'object' ||
    raw.rows !== layout.rows ||
    raw.cols !== layout.cols ||
    !Array.isArray(raw.slots) ||
    raw.slots.length !== expected ||
    slots.some((slotId, index) => raw.slots[index] !== slotId);

  return { layout, changed };
}

function persistFabLayoutRepair(layout) {
  if (!isExtensionContextValid()) return;
  try {
    chrome.storage.local.set({ [FAB_LAYOUT_KEY]: layout });
  } catch {
    // ignore
  }
}

function reconcileCurrentFabLayoutV1(shouldPersist = false) {
  if (!fabLayoutV1) return false;
  const reconciled = reconcileFabLayoutV1(fabLayoutV1);
  fabLayoutV1 = reconciled.layout;
  if (shouldPersist && reconciled.changed) {
    persistFabLayoutRepair(fabLayoutV1);
  }
  return reconciled.changed;
}

function loadFabLayoutV1() {
  return new Promise((resolve) => {
    if (!isExtensionContextValid()) {
      fabLayoutV1 = defaultFabLayoutV1();
      resolve(fabLayoutV1);
      return;
    }
    try {
      chrome.storage.local.get(FAB_LAYOUT_KEY, (result) => {
        if (chrome.runtime.lastError) {
          fabLayoutV1 = defaultFabLayoutV1();
          resolve(fabLayoutV1);
          return;
        }
        const reconciled = reconcileFabLayoutV1(result && result[FAB_LAYOUT_KEY]);
        fabLayoutV1 = reconciled.layout;
        if (reconciled.changed) persistFabLayoutRepair(fabLayoutV1);
        resolve(fabLayoutV1);
      });
    } catch {
      fabLayoutV1 = defaultFabLayoutV1();
      resolve(fabLayoutV1);
    }
  });
}

function isExtensionContextValid() {
  try {
    return !!(chrome && chrome.runtime && chrome.runtime.id);
  } catch {
    return false;
  }
}

function normalizeFolderName(name) {
  return (name || '').toString().replace(/\s+/g, ' ').trim().slice(0, MAX_FOLDER_NAME_LENGTH);
}

function generateFolderId() {
  return 'folder_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
}

function normalizeFolders(rawFolders) {
  if (!Array.isArray(rawFolders)) return [];
  const seenIds = new Set();
  const seenNames = new Set();
  const folders = [];
  rawFolders.forEach(raw => {
    if (!raw || typeof raw !== 'object') return;
    const name = normalizeFolderName(raw.name);
    const normalizedName = name.toLocaleLowerCase();
    if (!name || seenNames.has(normalizedName)) return;
    let id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : generateFolderId();
    if (seenIds.has(id)) id = generateFolderId();
    seenIds.add(id);
    seenNames.add(normalizedName);
    const createdAt = Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now();
    folders.push({
      id,
      name,
      createdAt,
      lastUsedAt: Number.isFinite(raw.lastUsedAt) ? raw.lastUsedAt : createdAt
    });
  });
  return folders;
}

function normalizePresets(presets) {
  const defaults = DEFAULT_SETTINGS.presets.map(p => ({ ...p }));
  const source = Array.isArray(presets) && presets.length > 0 ? presets : defaults;
  const seen = new Set();
  const normalized = [];

  source.forEach((raw, index) => {
    if (!raw || typeof raw !== 'object') return;
    const fallback = defaults.find(p => p.id === raw.id) || defaults[index] || defaults[0];
    const id = typeof raw.id === 'string' && raw.id.trim() !== '' ? raw.id.trim() : fallback.id;
    if (seen.has(id)) return;
    seen.add(id);
    normalized.push({
      id,
      name: typeof raw.name === 'string' ? raw.name : fallback.name,
      colorLight: typeof raw.colorLight === 'string' ? raw.colorLight : fallback.colorLight,
      colorDark: typeof raw.colorDark === 'string' ? raw.colorDark : fallback.colorDark
    });
  });

  const defaultPreset = defaults.find(preset => preset.id === 'preset1') || defaults[0];
  if (!seen.has(defaultPreset.id)) normalized.push({ ...defaultPreset });
  return normalized.length > 0 ? normalized : defaults;
}

function getPresets() {
  return normalizePresets(userSettings.presets);
}

function getPresetById(presetId) {
  const presets = getPresets();
  return presets.find(preset => preset.id === presetId)
    || presets.find(preset => preset.id === 'preset1')
    || DEFAULT_SETTINGS.presets[0];
}

function getPresetColor(presetId, theme = getPageTheme()) {
  const preset = getPresetById(presetId);
  return theme === 'dark'
    ? (preset.colorDark || DEFAULT_SETTINGS.colorDark)
    : (preset.colorLight || DEFAULT_SETTINGS.colorLight);
}

// Load user settings from storage
function loadUserSettings() {
  return new Promise((resolve) => {
    if (!isExtensionContextValid()) {
      resolve(userSettings);
      return;
    }
    try {
      chrome.storage.local.get('highlightSettings', (result) => {
        if (chrome.runtime.lastError) {
          resolve(userSettings);
          return;
        }
        if (result.highlightSettings) {
          userSettings = { ...DEFAULT_SETTINGS, ...result.highlightSettings };
        }
        resolve(userSettings);
      });
    } catch {
      resolve(userSettings);
    }
  });
}

// Listen for storage changes in real time
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  const hasFabLayoutChange = Object.prototype.hasOwnProperty.call(changes, FAB_LAYOUT_KEY);

  // Settings changed (colors, FAB toggle)
  if (changes.highlightSettings) {
    const newVal = changes.highlightSettings.newValue;
    userSettings = { ...DEFAULT_SETTINGS, ...newVal };
    reconcileCurrentFabLayoutV1(!hasFabLayoutChange);
    rebuildHighlightFab();
    applyCustomColors();
    updateFabVisibility();
  }

  if (hasFabLayoutChange) {
    const next = changes[FAB_LAYOUT_KEY] && changes[FAB_LAYOUT_KEY].newValue;
    const reconciled = reconcileFabLayoutV1(next);
    fabLayoutV1 = reconciled.layout;
    if (reconciled.changed) persistFabLayoutRepair(fabLayoutV1);
    rebuildHighlightFab();
  }

  if (changes[FOLDERS_KEY]) {
    const folders = normalizeFolders(changes[FOLDERS_KEY].newValue);
    if (fabPostFolderId && !folders.some(folder => folder.id === fabPostFolderId)) {
      fabPostFolderId = null;
      syncHighlightFabState();
    }
    closeHighlightFabFolderPopover();
  }

  // Highlight data for this page changed (e.g. deleted from options page)
  const key = getStorageKey();
  if (changes[key]) {
    const newHighlights = changes[key].newValue;
    if (
      fabPostHighlightId
      && (
        !Array.isArray(newHighlights)
        || !newHighlights.some(highlight => highlight?.id === fabPostHighlightId)
      )
    ) {
      hideHighlightFab();
    }
    if (!newHighlights) {
      // Key was deleted — remove all marks
      document.querySelectorAll('.text-highlighter-mark').forEach(mark => {
        const parent = mark.parentNode;
        while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
        parent.removeChild(mark);
        parent.normalize();
      });
    } else {
      // Compare: remove marks whose IDs no longer exist
      const activeIds = new Set(newHighlights.map(h => h.id));
      const highlightsById = new Map(newHighlights.map(highlight => [highlight.id, highlight]));
      let presetAssignmentChanged = false;
      document.querySelectorAll('.text-highlighter-mark').forEach(mark => {
        if (!activeIds.has(mark.dataset.highlightId)) {
          const parent = mark.parentNode;
          while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
          parent.removeChild(mark);
          parent.normalize();
          return;
        }

        const storedHighlight = highlightsById.get(mark.dataset.highlightId);
        const storedPresetId = getPresetById(storedHighlight?.presetId).id;
        if (mark.dataset.presetId !== storedPresetId) {
          mark.dataset.presetId = storedPresetId;
          presetAssignmentChanged = true;
        }
      });
      if (fabPostHighlightId && highlightsById.has(fabPostHighlightId)) {
        const postHighlight = highlightsById.get(fabPostHighlightId);
        fabPostPresetId = getPresetById(postHighlight?.presetId).id;
        fabPostFolderId = typeof postHighlight?.folderId === 'string' ? postHighlight.folderId : null;
        syncHighlightFabState();
      }
      if (presetAssignmentChanged) applyCustomColors();
      // Restore highlights added from options (e.g. Recently Deleted) without full reload
      const domIds = new Set(
        Array.from(document.querySelectorAll('.text-highlighter-mark')).map(m => m.dataset.highlightId)
      );
      const hasNewInStorage = newHighlights.some(h => h.id && !domIds.has(h.id));
      if (hasNewInStorage) {
        restoreHighlights();
      }
    }
  }
});

// Apply custom highlight colors to existing marks / FAB palette
function applyCustomColors() {
  const theme = getPageTheme();
  const isDark = theme === 'dark';
  const presets = getPresets();
  if (highlightFab) highlightFab.classList.toggle('is-dark-page', isDark);

  // Preset IDs are authoritative: recolor every existing mark immediately.
  document.querySelectorAll('.text-highlighter-mark').forEach(mark => {
    const preset = getPresetById(mark.dataset.presetId);
    mark.dataset.presetId = preset.id;
    mark.classList.toggle('hl-dark', isDark);
    mark.classList.toggle('hl-light', !isDark);
    mark.style.backgroundColor = isDark
      ? (preset.colorDark || DEFAULT_SETTINGS.colorDark)
      : (preset.colorLight || DEFAULT_SETTINGS.colorLight);
  });

  if (!highlightFab || !Array.isArray(highlightFabButtons) || highlightFabButtons.length === 0) return;

  highlightFabButtons.forEach((btn) => {
    if (!btn) return;
    if (btn.dataset.fabKind !== 'preset') return;
    const presetId = btn.dataset.presetId;
    const preset = (presetId ? presets.find(p => p && p.id === presetId) : null) || presets[0];
    const color = isDark
      ? (preset.colorDark || userSettings.colorDark)
      : (preset.colorLight || userSettings.colorLight);
    if (color) btn.style.backgroundColor = color;
  });
}

// Hide FAB immediately when setting is turned off
// (When turned back on, it will appear naturally on the next text selection)
function updateFabVisibility() {
  if (highlightFab && !userSettings.showFab) {
    hideHighlightFab();
  }
}

// Get storage key for current URL
function getStorageKey() {
  return 'highlights_' + window.location.href;
}

const RECENTLY_DELETED_KEY = 'recentlyDeletedHighlights';

function generateTrashId() {
  return 'tr_' + Date.now() + '_' + Math.random().toString(36).substring(2, 11);
}

// Generate unique ID for highlights
function generateId() {
  return 'hl_' + Date.now() + '_' + Math.random().toString(36).substring(2, 11);
}

function collapseWhitespace(text) {
  return (text || '').toString().replace(/\s+/g, ' ').trim();
}

function tightenPunctuation(text) {
  return (text || '')
    .toString()
    // remove spaces before punctuation
    .replace(/\s+([,.;:!?])/g, '$1')
    // remove spaces just inside brackets/parentheses
    .replace(/([\(\[\{])\s+/g, '$1')
    .replace(/\s+([\)\]\}])/g, '$1')
    // wikipedia-style numeric citations: "word [2]" -> "word[2]"
    .replace(/\s+(\[\d+\])/g, '$1');
}

function normalizeStoredHighlights(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return { highlights: [], changed: false };

  let changed = false;
  const byId = new Map();

  for (const h of raw) {
    if (!h || typeof h.id !== 'string' || h.id.trim() === '') continue;
    if (!byId.has(h.id)) byId.set(h.id, []);
    byId.get(h.id).push(h);
  }

  const merged = [];
  for (const [id, items] of byId.entries()) {
    if (items.length === 1 && Array.isArray(items[0].parts) && items[0].parts.length > 0) {
      // Ensure text is normalized
      const one = { ...items[0] };
      const normalizedPresetId = getPresetById(one.presetId).id;
      if (one.presetId !== normalizedPresetId) {
        one.presetId = normalizedPresetId;
        changed = true;
      }
      if (Object.prototype.hasOwnProperty.call(one, 'color')) {
        delete one.color;
        changed = true;
      }
      const collapsed = collapseWhitespace(
        (one.parts || []).map(p => (p && p.text) || '').join(' ')
      );
      const combined = one.parts.length > 1 ? tightenPunctuation(collapsed) : collapsed;
      if (combined && combined !== one.text) {
        one.text = combined;
        changed = true;
      }
      merged.push(one);
      continue;
    }

    if (items.length > 1) changed = true;
    if (items.length === 1 && !Array.isArray(items[0].parts)) changed = true;

    // Merge duplicates into one record with parts[]
    const base = items[0] || { id };

    const parts = [];
    for (const it of items) {
      if (Array.isArray(it.parts) && it.parts.length > 0) {
        for (const p of it.parts) {
          if (!p) continue;
          parts.push({
            xpath: p.xpath || it.xpath || '',
            offset: typeof p.offset === 'number' ? p.offset : (typeof it.offset === 'number' ? it.offset : 0),
            text: p.text || ''
          });
        }
      } else {
        parts.push({
          xpath: it.xpath || '',
          offset: typeof it.offset === 'number' ? it.offset : 0,
          text: it.text || ''
        });
      }
    }

    const collapsed = collapseWhitespace(parts.map(p => p.text).join(' '));
    const combinedText = parts.length > 1 ? tightenPunctuation(collapsed) : collapsed;
    const createdAt = Math.min(...items.map(it => (typeof it.createdAt === 'number' ? it.createdAt : Date.now())));
    const favorited = items.some(it => it && it.favorited === true);
    const folderId = items.find(it => typeof it?.folderId === 'string' && it.folderId.trim())?.folderId || null;
    const rawPresetId = items.find(it => typeof it.presetId === 'string' && it.presetId.trim() !== '')?.presetId
      || base.presetId
      || DEFAULT_SETTINGS.presets[0].id;
    const presetId = getPresetById(rawPresetId).id;

    const firstPart = parts[0] || { xpath: base.xpath || '', offset: base.offset || 0 };

    const out = {
      ...base,
      id,
      presetId,
      text: combinedText,
      xpath: firstPart.xpath,
      offset: firstPart.offset,
      createdAt,
      parts
    };
    delete out.color;

    if (favorited) out.favorited = true;
    else delete out.favorited;
    if (folderId) out.folderId = folderId;
    else delete out.folderId;

    merged.push(out);
  }

  return { highlights: merged, changed };
}

// Save highlights to storage and update the global index.
// Optional favorite overrides let a newly-created highlight be favorited
// atomically without introducing a second source of truth in the DOM.
function saveHighlights({ favoriteOverrides = new Map() } = {}) {
  const key = getStorageKey();
  const url = window.location.href;

  // Gather current highlights from the DOM first (synchronous)
  const marks = Array.from(document.querySelectorAll('.text-highlighter-mark'));
  const byId = new Map();

  for (const mark of marks) {
    const id = mark.dataset.highlightId;
    if (!id) continue;
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id).push(mark);
  }

  const highlights = [];
  for (const [id, group] of byId.entries()) {
    const first = group[0];
    const parts = group.map(mark => ({
      xpath: getXPath(mark.parentNode),
      offset: getTextOffset(mark),
      text: mark.textContent || ''
    }));

    const collapsed = collapseWhitespace(parts.map(p => p.text).join(' '));
    const combinedText = parts.length > 1 ? tightenPunctuation(collapsed) : collapsed;
    const presetId = first.dataset.presetId || DEFAULT_SETTINGS.presets[0].id;

    // Keep xpath/offset for older readers; points at first part.
    const firstPart = parts[0] || { xpath: '', offset: 0, text: '' };

    highlights.push({
      id,
      presetId,
      text: combinedText,
      xpath: firstPart.xpath,
      offset: firstPart.offset,
      parts
    });
  }

  // Read existing data immediately before merging so createdAt and favorite
  // metadata cannot be lost to a stale in-memory snapshot.
  return new Promise((resolve) => {
    if (!isExtensionContextValid()) {
      resolve(false);
      return;
    }
    try {
      chrome.storage.local.get([key, 'highlightIndex'], (result) => {
        if (chrome.runtime.lastError) {
          resolve(false);
          return;
        }

        const oldHighlights = Array.isArray(result[key]) ? result[key] : [];
        const oldById = new Map(oldHighlights.map(highlight => [highlight.id, highlight]));

        highlights.forEach(highlight => {
          const oldHighlight = oldById.get(highlight.id);
          highlight.createdAt = oldHighlight?.createdAt || Date.now();
          if (typeof oldHighlight?.folderId === 'string' && oldHighlight.folderId) {
            highlight.folderId = oldHighlight.folderId;
          }
          if (favoriteOverrides.has(highlight.id)) {
            if (favoriteOverrides.get(highlight.id) === true) highlight.favorited = true;
          } else if (oldHighlight?.favorited === true) {
            highlight.favorited = true;
          }
        });

        const index = result.highlightIndex || {};
        if (highlights.length > 0) {
          index[url] = {
            title: document.title || url,
            lastUpdated: Date.now()
          };
          chrome.storage.local.set({ [key]: highlights, highlightIndex: index }, () => {
            resolve(!chrome.runtime.lastError);
          });
          return;
        }

        delete index[url];
        chrome.storage.local.remove(key, () => {
          if (chrome.runtime.lastError) {
            resolve(false);
            return;
          }
          chrome.storage.local.set({ highlightIndex: index }, () => {
            resolve(!chrome.runtime.lastError);
          });
        });
      });
    } catch {
      resolve(false);
    }
  });
}

function patchStoredHighlight(highlightId, patch) {
  const key = getStorageKey();
  const url = window.location.href;
  return new Promise((resolve) => {
    if (!highlightId || !isExtensionContextValid()) {
      resolve(null);
      return;
    }
    try {
      chrome.storage.local.get([key, 'highlightIndex'], (result) => {
        if (chrome.runtime.lastError) {
          resolve(null);
          return;
        }
        const highlights = Array.isArray(result[key]) ? result[key] : [];
        const index = highlights.findIndex(highlight => highlight?.id === highlightId);
        if (index < 0) {
          resolve(null);
          return;
        }

        const nextHighlight = { ...highlights[index], ...patch };
        if (
          Object.prototype.hasOwnProperty.call(patch, 'favorited')
          && patch.favorited !== true
        ) {
          delete nextHighlight.favorited;
        }
        if (
          Object.prototype.hasOwnProperty.call(patch, 'folderId')
          && (typeof patch.folderId !== 'string' || !patch.folderId)
        ) {
          delete nextHighlight.folderId;
        }
        const nextHighlights = highlights.slice();
        nextHighlights[index] = nextHighlight;

        const highlightIndex = result.highlightIndex || {};
        highlightIndex[url] = {
          title: document.title || url,
          lastUpdated: Date.now()
        };
        chrome.storage.local.set({
          [key]: nextHighlights,
          highlightIndex
        }, () => {
          resolve(chrome.runtime.lastError ? null : nextHighlight);
        });
      });
    } catch {
      resolve(null);
    }
  });
}

async function updateHighlightPreset(highlightId, presetId) {
  const preset = getPresetById(presetId);
  const marks = Array.from(
    document.querySelectorAll(`.text-highlighter-mark[data-highlight-id="${highlightId}"]`)
  );
  if (!preset || marks.length === 0) return null;

  const updated = await patchStoredHighlight(highlightId, { presetId: preset.id });
  if (!updated) return null;

  const theme = getPageTheme();
  const isDark = theme === 'dark';
  const color = getPresetColor(preset.id, theme);
  marks.forEach(mark => {
    mark.dataset.presetId = preset.id;
    mark.classList.toggle('hl-dark', isDark);
    mark.classList.toggle('hl-light', !isDark);
    mark.style.backgroundColor = color;
  });
  return updated;
}

// Get XPath for an element
function getXPath(element) {
  if (!element || element.nodeType !== Node.ELEMENT_NODE) {
    return '';
  }
  
  if (element.id) {
    return `//*[@id="${element.id}"]`;
  }
  
  if (element === document.body) {
    return '/html/body';
  }
  
  let ix = 1;
  const siblings = element.parentNode ? element.parentNode.childNodes : [];
  
  for (let i = 0; i < siblings.length; i++) {
    const sibling = siblings[i];
    if (sibling === element) {
      const parentPath = getXPath(element.parentNode);
      const tagName = element.tagName.toLowerCase();
      return `${parentPath}/${tagName}[${ix}]`;
    }
    if (sibling.nodeType === Node.ELEMENT_NODE && sibling.tagName === element.tagName) {
      ix++;
    }
  }
  
  return '';
}

// Get text offset within parent
function getTextOffset(mark) {
  const parent = mark.parentNode;
  let offset = 0;
  
  for (const child of parent.childNodes) {
    if (child === mark) {
      break;
    }
    if (child.nodeType === Node.TEXT_NODE || child.nodeType === Node.ELEMENT_NODE) {
      offset += child.textContent.length;
    }
  }
  
  return offset;
}

// Detect if page has dark or light background
function getPageTheme() {
  const bg = getComputedStyle(document.body).backgroundColor;
  const rgb = bg.match(/\d+/g);
  if (!rgb || rgb.length < 3) return 'light'; // fallback
  const [r, g, b] = rgb.map(Number);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance < 0.25 ? 'dark' : 'light';
}

// Highlight the current selection and resolve with its persisted identity.
async function highlightSelection(presetIdOrIndex = 0, { favorited = false } = {}) {
  await loadUserSettings();
  const selection = window.getSelection();
  
  if (!selection || selection.isCollapsed || !selection.toString().trim()) {
    return null;
  }
  
  const range = selection.getRangeAt(0);
  
  // Check if selection is already highlighted
  const ancestor = range.commonAncestorContainer;
  if (ancestor.nodeType === Node.ELEMENT_NODE && ancestor.classList?.contains('text-highlighter-mark')) {
    return null;
  }
  if (ancestor.parentNode?.classList?.contains('text-highlighter-mark')) {
    return null;
  }
  
  const highlightId = generateId();
  const theme = getPageTheme();
  const themeClass = theme === 'dark' ? 'hl-dark' : 'hl-light';
  const presets = getPresets();
  const preset = typeof presetIdOrIndex === 'string'
    ? (presets.find(item => item.id === presetIdOrIndex) || presets[0])
    : (presets[presetIdOrIndex] || presets[0]);
  const presetId = preset && typeof preset.id === 'string' ? preset.id : null;
  const appliedColor = theme === 'dark'
    ? (preset.colorDark || userSettings.colorDark)
    : (preset.colorLight || userSettings.colorLight);
  
  try {
    const mark = document.createElement('mark');
    mark.className = 'text-highlighter-mark ' + themeClass;
    mark.dataset.highlightId = highlightId;
    if (presetId) mark.dataset.presetId = presetId;
    if (appliedColor) {
      mark.style.backgroundColor = appliedColor;
    }
    
    // Use surroundContents for simple selections
    range.surroundContents(mark);
    
    // Add click handler to remove
    mark.addEventListener('click', handleHighlightClick);
    
    selection.removeAllRanges();
    const saved = await saveHighlights({
      favoriteOverrides: favorited ? new Map([[highlightId, true]]) : new Map()
    });
    return saved ? { highlightId, presetId, favorited } : null;
  } catch (e) {
    // surroundContents fails if selection crosses element boundaries
    // Wrap each text node individually to preserve DOM structure
    try {
      const textNodes = getTextNodesInRange(range);
      
      if (textNodes.length === 0) {
        return null;
      }

      let createdPartCount = 0;
      textNodes.forEach((nodeInfo) => {
        const { node, start, end } = nodeInfo;
        
        // Create a range for just this portion of text
        const nodeRange = document.createRange();
        nodeRange.setStart(node, start);
        nodeRange.setEnd(node, end);
        
        const mark = document.createElement('mark');
        mark.className = 'text-highlighter-mark ' + themeClass;
        mark.dataset.highlightId = highlightId;
        if (presetId) mark.dataset.presetId = presetId;
        if (appliedColor) {
          mark.style.backgroundColor = appliedColor;
        }
        
        try {
          nodeRange.surroundContents(mark);
          mark.addEventListener('click', handleHighlightClick);
          createdPartCount++;
        } catch (err) {
          // Skip nodes that can't be wrapped
        }
      });

      if (createdPartCount === 0) return null;
      selection.removeAllRanges();
      const saved = await saveHighlights({
        favoriteOverrides: favorited ? new Map([[highlightId, true]]) : new Map()
      });
      return saved ? { highlightId, presetId, favorited } : null;
    } catch (e2) {
      console.error('Could not highlight selection:', e2);
      return null;
    }
  }
}

// Get all text nodes within a range with their start/end offsets
function getTextNodesInRange(range) {
  const textNodes = [];
  const startContainer = range.startContainer;
  const endContainer = range.endContainer;
  const startOffset = range.startOffset;
  const endOffset = range.endOffset;
  
  // If start and end are the same text node
  if (startContainer === endContainer && startContainer.nodeType === Node.TEXT_NODE) {
    textNodes.push({
      node: startContainer,
      start: startOffset,
      end: endOffset
    });
    return textNodes;
  }
  
  // Walk through all text nodes in the range
  const walker = document.createTreeWalker(
    range.commonAncestorContainer,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: function(node) {
        // Check if this text node is within the range
        const nodeRange = document.createRange();
        nodeRange.selectNodeContents(node);
        
        // Check if node intersects with selection range
        if (range.compareBoundaryPoints(Range.END_TO_START, nodeRange) >= 0) {
          return NodeFilter.FILTER_REJECT; // Node is before range
        }
        if (range.compareBoundaryPoints(Range.START_TO_END, nodeRange) <= 0) {
          return NodeFilter.FILTER_REJECT; // Node is after range
        }
        
        // Skip empty or whitespace-only nodes
        if (!node.textContent.trim()) {
          return NodeFilter.FILTER_REJECT;
        }
        
        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );
  
  let node;
  while ((node = walker.nextNode())) {
    let start = 0;
    let end = node.textContent.length;
    
    // Adjust boundaries for start and end containers
    if (node === startContainer) {
      start = startOffset;
    }
    if (node === endContainer) {
      end = endOffset;
    }
    
    // Only add if there's actual content to highlight
    if (end > start) {
      textNodes.push({ node, start, end });
    }
  }
  
  return textNodes;
}

// Handle click on highlight to remove it
function handleHighlightClick(e) {
  e.preventDefault();
  e.stopPropagation();
  removeHighlight(e.target);
}

// Remove a highlight (and all parts if it spans multiple elements)
function removeHighlight(mark) {
  if (!mark.classList.contains('text-highlighter-mark')) {
    mark = mark.closest('.text-highlighter-mark');
  }

  if (!mark) return;

  const highlightId = mark.dataset.highlightId;
  const key = getStorageKey();
  const url = window.location.href;

  const allParts = document.querySelectorAll(`.text-highlighter-mark[data-highlight-id="${highlightId}"]`);

  if (!isExtensionContextValid()) return;
  try {
    chrome.storage.local.get([key, RECENTLY_DELETED_KEY, 'highlightIndex'], (result) => {
      if (chrome.runtime.lastError) return;
    const highlights = result[key] || [];
    const hl = highlights.find(h => h.id === highlightId);
    const trash = Array.isArray(result[RECENTLY_DELETED_KEY])
      ? [...result[RECENTLY_DELETED_KEY]]
      : [];
    const index = result.highlightIndex || {};
    const pageTitle = (index[url] && index[url].title) || document.title || url;

    if (hl) {
      trash.unshift({
        trashId: generateTrashId(),
        pageUrl: url,
        pageTitle,
        deletedAt: Date.now(),
        highlight: { ...hl }
      });
    }

    allParts.forEach(part => {
      const parent = part.parentNode;
      while (part.firstChild) {
        parent.insertBefore(part.firstChild, part);
      }
      parent.removeChild(part);
      parent.normalize();
    });

    const newHighlights = highlights.filter(h => h.id !== highlightId);

    if (newHighlights.length > 0) {
      index[url] = {
        title: document.title || url,
        lastUpdated: Date.now()
      };
      chrome.storage.local.set({
        [key]: newHighlights,
        highlightIndex: index,
        [RECENTLY_DELETED_KEY]: trash
      });
    } else {
      delete index[url];
      chrome.storage.local.remove(key, () => {
        chrome.storage.local.set({
          highlightIndex: index,
          [RECENTLY_DELETED_KEY]: trash
        });
      });
    }
    });
  } catch {
    // ignore
  }
}

// Remove highlight from current selection
function removeSelectedHighlight() {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) return;
  
  const range = selection.getRangeAt(0);
  const ancestor = range.commonAncestorContainer;
  
  let mark = null;
  if (ancestor.nodeType === Node.ELEMENT_NODE && ancestor.classList?.contains('text-highlighter-mark')) {
    mark = ancestor;
  } else if (ancestor.parentNode?.classList?.contains('text-highlighter-mark')) {
    mark = ancestor.parentNode;
  }
  
  if (mark) {
    removeHighlight(mark);
    selection.removeAllRanges();
  }
}

// Clear all highlights on the page
function clearAllHighlights() {
  const key = getStorageKey();
  const url = window.location.href;

  if (!isExtensionContextValid()) return;
  try {
    chrome.storage.local.get([key, RECENTLY_DELETED_KEY, 'highlightIndex'], (result) => {
      if (chrome.runtime.lastError) return;
    const highlights = result[key] || [];
    const trash = Array.isArray(result[RECENTLY_DELETED_KEY])
      ? [...result[RECENTLY_DELETED_KEY]]
      : [];
    const index = result.highlightIndex || {};
    const pageTitle = (index[url] && index[url].title) || document.title || url;
    const now = Date.now();

    for (let i = highlights.length - 1; i >= 0; i--) {
      trash.unshift({
        trashId: generateTrashId(),
        pageUrl: url,
        pageTitle,
        deletedAt: now,
        highlight: { ...highlights[i] }
      });
    }

    document.querySelectorAll('.text-highlighter-mark').forEach(mark => {
      const parent = mark.parentNode;
      while (mark.firstChild) {
        parent.insertBefore(mark.firstChild, mark);
      }
      parent.removeChild(mark);
      parent.normalize();
    });

    delete index[url];
    chrome.storage.local.remove(key, () => {
      chrome.storage.local.set({
        highlightIndex: index,
        [RECENTLY_DELETED_KEY]: trash
      });
    });
    });
  } catch {
    // ignore
  }
}

// Restore highlights from storage
function restoreHighlights() {
  const key = getStorageKey();

  if (!isExtensionContextValid()) return;
  try {
    chrome.storage.local.get(key, (result) => {
      if (chrome.runtime.lastError) return;
    const raw = result[key];
    if (!raw || !raw.length) return;

    const normalized = normalizeStoredHighlights(raw);
    const highlights = normalized.highlights;
    if (!highlights || highlights.length === 0) return;

    if (normalized.changed) {
      try {
        chrome.storage.local.set({ [key]: highlights });
      } catch {
        // ignore
      }
    }

    const theme = getPageTheme();
    const themeClass = theme === 'dark' ? 'hl-dark' : 'hl-light';
    highlights.forEach(highlight => {
      try {
        if (document.querySelector(`.text-highlighter-mark[data-highlight-id="${highlight.id}"]`)) {
          return;
        }
        const parts = Array.isArray(highlight.parts) && highlight.parts.length > 0
          ? highlight.parts
          : [{ xpath: highlight.xpath, offset: highlight.offset, text: highlight.text }];

        const preset = getPresetById(highlight.presetId);
        const appliedColor = getPresetColor(preset.id, theme);

        parts.forEach(part => {
          if (!part || !part.xpath) return;

          // Find the element using XPath
          const xpathResult = document.evaluate(
            part.xpath,
            document,
            null,
            XPathResult.FIRST_ORDERED_NODE_TYPE,
            null
          );
          
          const element = xpathResult.singleNodeValue;
          if (!element) return;
          
          // Find the text within the element
          const walker = document.createTreeWalker(
            element,
            NodeFilter.SHOW_TEXT,
            null,
            false
          );
          
          let currentOffset = 0;
          let node;
          
          while ((node = walker.nextNode())) {
            const nodeLength = node.textContent.length;
            
            // Check if this node contains our highlight start
            if (currentOffset + nodeLength > (part.offset || 0)) {
              const localOffset = (part.offset || 0) - currentOffset;
              const text = node.textContent;
              const needle = (part.text || '').toString();
              if (!needle) return;
              
              // Search slightly before expected offset to tolerate minor DOM changes
              const idx = text.indexOf(needle, localOffset > 0 ? localOffset - 5 : 0);
              if (idx !== -1) {
                const range = document.createRange();
                range.setStart(node, idx);
                range.setEnd(node, idx + needle.length);

                const mark = document.createElement('mark');
                mark.className = 'text-highlighter-mark ' + themeClass;
                mark.dataset.highlightId = highlight.id;
                mark.dataset.presetId = preset.id;
                if (appliedColor) {
                  mark.style.backgroundColor = appliedColor;
                }
                
                try {
                  range.surroundContents(mark);
                  mark.addEventListener('click', handleHighlightClick);
                } catch (e) {
                  // Ignore errors during restore
                }
                
                return;
              }
            }
            
            currentOffset += nodeLength;
          }
        });
      } catch (e) {
        // Ignore errors during restore
      }
    });

    });
  } catch {
    // ignore
  }
}

// ============================================
// Floating Action Button (FAB) palette
// ============================================

// Create the FAB palette element once
let highlightFab = null;
let highlightFabButtons = [];
let highlightFabStatus = null;
let highlightFabStatusTimer = null;
let highlightFabFolderPopover = null;
let highlightFabFolderRequestVersion = 0;
let highlightFabFolderRequestPending = false;
let fabPostHighlightId = null;
let fabPostPresetId = null;
let fabPostFolderId = null;
let fabPostTimeout = null;
let fabHideTimeout = null;
let fabPointerPaused = false;
let fabKeyboardPaused = false;
let fabLastInputWasKeyboard = false;
let fabOperationInFlight = false;
let fabOperationChain = Promise.resolve();
let fabInteractionVersion = 0;

const FAB_POST_ACTION_TIMEOUT_MS = 4000;
const FAB_FADE_OUT_MS = 170;

function hasPostHighlightFabAction() {
  const layout = fabLayoutV1 || defaultFabLayoutV1();
  return Array.isArray(layout.slots)
    && (layout.slots.includes('favorite') || layout.slots.includes('folder'));
}

function clearFabPostTimeout() {
  if (fabPostTimeout !== null) {
    clearTimeout(fabPostTimeout);
    fabPostTimeout = null;
  }
}

function scheduleFabPostTimeout() {
  clearFabPostTimeout();
  if (!fabPostHighlightId || fabPointerPaused || fabKeyboardPaused) return;
  fabPostTimeout = setTimeout(() => {
    fabPostTimeout = null;
    hideHighlightFab({ fade: true });
  }, FAB_POST_ACTION_TIMEOUT_MS);
}

function clearFabPostState() {
  clearFabPostTimeout();
  fabPostHighlightId = null;
  fabPostPresetId = null;
  fabPostFolderId = null;
  fabPointerPaused = false;
  fabKeyboardPaused = false;
  syncHighlightFabState();
}

function setFabBusy(isBusy) {
  fabOperationInFlight = isBusy;
  if (highlightFab) highlightFab.setAttribute('aria-busy', String(isBusy));
  highlightFabButtons.forEach(button => {
    if (button) button.disabled = isBusy;
  });
}

function syncHighlightFabState() {
  highlightFabButtons.forEach(button => {
    if (!button) return;
    const isActivePreset = Boolean(
      fabPostHighlightId
      && button.dataset.fabKind === 'preset'
      && button.dataset.presetId === fabPostPresetId
    );
    button.classList.toggle('is-active-preset', isActivePreset);
    if (button.dataset.actionId === 'favorite') {
      button.classList.toggle(
        'is-favorited',
        Boolean(highlightFab?.classList.contains('is-confirming-favorite'))
      );
      button.title = fabPostHighlightId
        ? 'Add this highlight to favorites'
        : 'Highlight with the default tag and add to favorites';
      button.setAttribute('aria-label', button.title);
    }
    if (button.dataset.actionId === 'folder') {
      const hasFolder = Boolean(fabPostHighlightId && fabPostFolderId);
      button.classList.toggle('has-folder', hasFolder);
      button.title = fabPostHighlightId
        ? (hasFolder ? 'Change folder' : 'Add this highlight to a folder')
        : 'Highlight first';
      button.setAttribute('aria-label', button.title);
    }
  });
}

function ensureHighlightFabStatus() {
  if (highlightFabStatus) return highlightFabStatus;
  highlightFabStatus = document.createElement('div');
  highlightFabStatus.className = 'text-highlighter-fab-status';
  highlightFabStatus.setAttribute('role', 'status');
  highlightFabStatus.setAttribute('aria-live', 'polite');
  document.body.appendChild(highlightFabStatus);
  return highlightFabStatus;
}

function hideHighlightFabStatus() {
  if (highlightFabStatusTimer !== null) {
    clearTimeout(highlightFabStatusTimer);
    highlightFabStatusTimer = null;
  }
  if (highlightFabStatus) highlightFabStatus.classList.remove('is-visible');
}

function showHighlightFabStatus(message, kind = 'default') {
  const status = ensureHighlightFabStatus();
  if (highlightFab) {
    status.style.left = highlightFab.style.left;
    status.style.top = highlightFab.style.top;
  }
  status.textContent = message;
  status.dataset.kind = kind;
  status.classList.add('is-visible');
  if (highlightFabStatusTimer !== null) clearTimeout(highlightFabStatusTimer);
  highlightFabStatusTimer = setTimeout(() => {
    status.classList.remove('is-visible');
    highlightFabStatusTimer = null;
  }, 1600);
}

function createFolderIconElement() {
  const namespace = 'http://www.w3.org/2000/svg';
  const icon = document.createElementNS(namespace, 'svg');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(namespace, 'path');
  path.setAttribute('d', 'M3 6.5A2.5 2.5 0 0 1 5.5 4H10l2 2h6.5A2.5 2.5 0 0 1 21 8.5v9A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5z');
  icon.appendChild(path);
  return icon;
}

function closeHighlightFabFolderPopover({ restartTimeout = true } = {}) {
  highlightFabFolderRequestVersion++;
  const hadPendingRequest = highlightFabFolderRequestPending;
  highlightFabFolderRequestPending = false;
  if (!highlightFabFolderPopover && !hadPendingRequest) return;
  highlightFabFolderPopover?.remove();
  highlightFabFolderPopover = null;
  fabPointerPaused = false;
  fabKeyboardPaused = false;
  if (restartTimeout) scheduleFabPostTimeout();
}

function positionHighlightFabFolderPopover(popover, anchor) {
  const rect = anchor.getBoundingClientRect();
  const width = popover.offsetWidth || 244;
  const height = popover.offsetHeight || 240;
  const viewportPadding = 10;
  const gap = 7;
  const left = Math.min(
    Math.max(rect.right + window.scrollX - width, window.scrollX + viewportPadding),
    window.scrollX + window.innerWidth - width - viewportPadding
  );
  const below = rect.bottom + window.scrollY + gap;
  const above = rect.top + window.scrollY - height - gap;
  const useAbove = rect.bottom + gap + height > window.innerHeight - viewportPadding
    && above >= window.scrollY + viewportPadding;
  popover.style.left = `${Math.round(left)}px`;
  popover.style.top = `${Math.round(useAbove ? above : below)}px`;
  popover.classList.toggle('opens-up', useAbove);
}

function patchStoredHighlightFolder(highlightId, requestedFolderId, createName = '') {
  const key = getStorageKey();
  return new Promise(resolve => {
    if (!highlightId || !isExtensionContextValid()) {
      resolve(null);
      return;
    }
    chrome.storage.local.get([key, FOLDERS_KEY], result => {
      if (chrome.runtime.lastError) {
        resolve(null);
        return;
      }
      const highlights = Array.isArray(result[key]) ? result[key] : [];
      const highlightIndex = highlights.findIndex(highlight => highlight?.id === highlightId);
      if (highlightIndex < 0) {
        resolve(null);
        return;
      }
      let folders = normalizeFolders(result[FOLDERS_KEY]);
      const normalizedCreateName = normalizeFolderName(createName);
      let folder = requestedFolderId ? folders.find(item => item.id === requestedFolderId) : null;
      if (normalizedCreateName) {
        folder = folders.find(item => item.name.toLocaleLowerCase() === normalizedCreateName.toLocaleLowerCase()) || null;
        if (!folder) {
          const now = Date.now();
          folder = { id: generateFolderId(), name: normalizedCreateName, createdAt: now, lastUsedAt: now };
          folders = [...folders, folder];
        }
      }
      if (!folder) {
        resolve(null);
        return;
      }
      const usedAt = Date.now();
      folders = folders.map(item => item.id === folder.id ? { ...item, lastUsedAt: usedAt } : item);
      folder = folders.find(item => item.id === folder.id);
      const nextHighlight = { ...highlights[highlightIndex], folderId: folder.id };
      const nextHighlights = highlights.slice();
      nextHighlights[highlightIndex] = nextHighlight;
      chrome.storage.local.set({ [key]: nextHighlights, [FOLDERS_KEY]: folders }, () => {
        resolve(chrome.runtime.lastError ? null : { highlight: nextHighlight, folder });
      });
    });
  });
}

function createContentFolderPickerOption(folder, currentFolderId) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'text-highlighter-folder-option';
  button.classList.toggle('is-current', folder.id === currentFolderId);
  button.setAttribute('role', 'option');
  button.setAttribute('aria-selected', String(folder.id === currentFolderId));
  button.appendChild(createFolderIconElement());
  const label = document.createElement('span');
  label.textContent = folder.name;
  button.appendChild(label);
  if (folder.id === currentFolderId) {
    const check = document.createElement('span');
    check.className = 'text-highlighter-folder-check';
    check.textContent = '✓';
    check.setAttribute('aria-hidden', 'true');
    button.appendChild(check);
  }
  button.addEventListener('mousedown', event => {
    event.preventDefault();
    event.stopPropagation();
  });
  button.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    assignFabHighlightToFolder(folder.id);
  });
  return button;
}

function renderContentFolderPickerResults(list, query, folders, currentFolderId) {
  list.innerHTML = '';
  const normalizedQuery = normalizeFolderName(query);
  const visible = normalizedQuery
    ? folders.filter(folder => folder.name.toLocaleLowerCase().includes(normalizedQuery.toLocaleLowerCase()))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
    : folders.slice().sort((a, b) => b.lastUsedAt - a.lastUsedAt).slice(0, RECENT_FOLDER_LIMIT);
  const heading = document.createElement('div');
  heading.className = 'text-highlighter-folder-heading';
  heading.textContent = normalizedQuery ? 'Results' : 'Recent folders';
  list.appendChild(heading);
  visible.forEach(folder => list.appendChild(createContentFolderPickerOption(folder, currentFolderId)));
  const exact = folders.some(folder => folder.name.toLocaleLowerCase() === normalizedQuery.toLocaleLowerCase());
  if (normalizedQuery && !exact) {
    const create = document.createElement('button');
    create.type = 'button';
    create.className = 'text-highlighter-folder-option is-create';
    create.textContent = `Create “${normalizedQuery}”`;
    create.addEventListener('mousedown', event => {
      event.preventDefault();
      event.stopPropagation();
    });
    create.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      assignFabHighlightToFolder(null, normalizedQuery);
    });
    list.appendChild(create);
  } else if (visible.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'text-highlighter-folder-empty';
    empty.textContent = 'No folders yet. Search to create one.';
    list.appendChild(empty);
  }
}

function openHighlightFabFolderPopover(anchor) {
  if (!fabPostHighlightId || !anchor) {
    showHighlightFabStatus('Highlight first', 'folder');
    return;
  }
  if (highlightFabFolderPopover || highlightFabFolderRequestPending) {
    closeHighlightFabFolderPopover();
    return;
  }
  clearFabPostTimeout();
  fabPointerPaused = true;
  fabKeyboardPaused = true;
  const requestVersion = ++highlightFabFolderRequestVersion;
  highlightFabFolderRequestPending = true;
  chrome.storage.local.get(FOLDERS_KEY, result => {
    if (requestVersion !== highlightFabFolderRequestVersion) return;
    highlightFabFolderRequestPending = false;
    if (chrome.runtime.lastError || !fabPostHighlightId || !anchor.isConnected) {
      fabPointerPaused = false;
      fabKeyboardPaused = false;
      scheduleFabPostTimeout();
      return;
    }
    const folders = normalizeFolders(result[FOLDERS_KEY]);
    const popover = document.createElement('div');
    popover.className = 'text-highlighter-folder-picker';
    popover.classList.toggle('is-dark-page', getPageTheme() === 'dark');
    popover.setAttribute('role', 'dialog');
    popover.setAttribute('aria-label', 'Choose folder');
    const search = document.createElement('input');
    search.type = 'search';
    search.placeholder = 'Search folders…';
    search.maxLength = MAX_FOLDER_NAME_LENGTH;
    search.setAttribute('aria-label', 'Search or create folders');
    search.addEventListener('mousedown', event => event.stopPropagation());
    const list = document.createElement('div');
    list.className = 'text-highlighter-folder-list';
    list.setAttribute('role', 'listbox');
    renderContentFolderPickerResults(list, '', folders, fabPostFolderId);
    search.addEventListener('input', () => renderContentFolderPickerResults(list, search.value, folders, fabPostFolderId));
    popover.append(search, list);
    popover.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeHighlightFabFolderPopover();
        anchor.focus({ preventScroll: true });
        return;
      }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      const buttons = Array.from(popover.querySelectorAll('button:not(:disabled)'));
      if (buttons.length === 0) return;
      event.preventDefault();
      const currentIndex = buttons.indexOf(document.activeElement);
      let nextIndex = 0;
      if (event.key === 'End') nextIndex = buttons.length - 1;
      else if (event.key === 'ArrowDown') nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % buttons.length;
      else if (event.key === 'ArrowUp') nextIndex = currentIndex < 0 ? buttons.length - 1 : (currentIndex - 1 + buttons.length) % buttons.length;
      buttons[nextIndex].focus({ preventScroll: true });
    });
    popover.addEventListener('pointerenter', () => clearFabPostTimeout());
    popover.addEventListener('focusin', () => clearFabPostTimeout());
    document.body.appendChild(popover);
    highlightFabFolderPopover = popover;
    positionHighlightFabFolderPopover(popover, anchor);
    requestAnimationFrame(() => {
      if (highlightFabFolderPopover !== popover) return;
      popover.classList.add('is-open');
      search.focus({ preventScroll: true });
    });
  });
}

function assignFabHighlightToFolder(folderId, createName = '') {
  const highlightId = fabPostHighlightId;
  closeHighlightFabFolderPopover({ restartTimeout: false });
  runFabOperation(async interactionVersion => {
    const updated = await patchStoredHighlightFolder(highlightId, folderId, createName);
    if (interactionVersion !== fabInteractionVersion) return;
    if (!updated) {
      hideHighlightFab();
      return;
    }
    fabPostFolderId = updated.folder.id;
    syncHighlightFabState();
    showHighlightFabStatus(`Added to ${updated.folder.name}`, 'folder');
    scheduleFabPostTimeout();
  });
}

function handleFabFolderAction(anchor) {
  if (!fabPostHighlightId) {
    showHighlightFabStatus('Highlight first', 'folder');
    return;
  }
  openHighlightFabFolderPopover(anchor);
}

function persistLastUsedPresetId(presetId) {
  if (!presetId || !isExtensionContextValid()) return;
  try {
    chrome.storage.local.set({ lastUsedPresetId: presetId });
  } catch {
    // ignore
  }
}

function runFabOperation(operation) {
  if (fabOperationInFlight) return;
  const interactionVersion = fabInteractionVersion;
  clearFabPostTimeout();
  setFabBusy(true);
  const execution = fabOperationChain.then(() => operation(interactionVersion));
  fabOperationChain = execution.catch(() => {
    if (interactionVersion === fabInteractionVersion) hideHighlightFab();
    return null;
  });
  fabOperationChain.then(() => setFabBusy(false));
}

function confirmFavoriteAndClose() {
  if (highlightFab) highlightFab.classList.add('is-confirming-favorite');
  syncHighlightFabState();
  showHighlightFabStatus('Added to Favorites', 'favorite');
  hideHighlightFab({ fade: true });
}

function handleFabPresetAction(presetId) {
  runFabOperation(async (interactionVersion) => {
    if (fabPostHighlightId) {
      const updated = await updateHighlightPreset(fabPostHighlightId, presetId);
      if (interactionVersion !== fabInteractionVersion) return;
      if (!updated) {
        hideHighlightFab();
        return;
      }
      fabPostPresetId = updated.presetId;
      persistLastUsedPresetId(updated.presetId);
      syncHighlightFabState();
      scheduleFabPostTimeout();
      return;
    }

    const created = await highlightSelection(presetId);
    if (interactionVersion !== fabInteractionVersion) return;
    if (!created) {
      hideHighlightFab();
      return;
    }
    persistLastUsedPresetId(created.presetId);
    if (!hasPostHighlightFabAction()) {
      hideHighlightFab();
      return;
    }

    fabPostHighlightId = created.highlightId;
    fabPostPresetId = created.presetId;
    syncHighlightFabState();
    scheduleFabPostTimeout();
  });
}

function handleFabFavoriteAction() {
  runFabOperation(async (interactionVersion) => {
    if (fabPostHighlightId) {
      const updated = await patchStoredHighlight(fabPostHighlightId, { favorited: true });
      if (interactionVersion !== fabInteractionVersion) return;
      if (!updated) {
        hideHighlightFab();
        return;
      }
      confirmFavoriteAndClose();
      return;
    }

    const defaultPreset = getPresetById('preset1');
    const created = await highlightSelection(defaultPreset.id, { favorited: true });
    if (interactionVersion !== fabInteractionVersion) return;
    if (!created) {
      hideHighlightFab();
      return;
    }
    persistLastUsedPresetId(created.presetId);
    confirmFavoriteAndClose();
  });
}

function rebuildHighlightFab() {
  if (!highlightFab) return;
  closeHighlightFabFolderPopover({ restartTimeout: false });
  hideHighlightFab();
  highlightFab.innerHTML = '';
  highlightFabButtons = [];
  buildFabButtonsInto(highlightFab);
  applyCustomColors();
  syncHighlightFabState();
  setFabBusy(fabOperationInFlight);
}

function buildFabButtonsInto(container) {
  const layout = fabLayoutV1 || defaultFabLayoutV1();
  const presets = getPresets();

  container.style.display = 'grid';
  container.style.gridTemplateColumns = `repeat(${layout.cols}, 18px)`;
  container.style.gridAutoRows = '18px';
  container.style.gap = '0';
  container.style.alignItems = 'center';
  container.style.justifyContent = 'center';

  const appendSpacer = () => {
    const spacer = document.createElement('div');
    spacer.style.width = '18px';
    spacer.style.height = '18px';
    container.appendChild(spacer);
  };

  const makePlaceholderBtn = (slotId) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'text-highlighter-fab-action';
    btn.dataset.fabKind = 'placeholder';
    btn.dataset.actionId = slotId;
    btn.title = slotId;
    btn.style.border = '1px solid rgba(0,0,0,0.12)';
    btn.style.padding = '0';
    btn.style.margin = '0';
    btn.style.width = '18px';
    btn.style.height = '18px';
    btn.style.borderRadius = '999px';
    btn.style.cursor = 'pointer';
    btn.style.background = 'rgba(255,255,255,0.85)';
    btn.style.color = '#333';
    btn.style.fontSize = '11px';
    btn.style.lineHeight = '18px';
    btn.textContent = '⋯';
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Placeholder action (no-op for now)
      hideHighlightFab();
    });
    return btn;
  };

  const makeFavoriteBtn = () => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'text-highlighter-fab-action text-highlighter-fab-favorite';
    btn.dataset.fabKind = 'action';
    btn.dataset.actionId = 'favorite';
    btn.style.padding = '0';
    btn.style.margin = '0';
    btn.style.width = '18px';
    btn.style.height = '18px';
    btn.style.borderRadius = '999px';
    btn.style.cursor = 'pointer';
    const svgNamespace = 'http://www.w3.org/2000/svg';
    const icon = document.createElementNS(svgNamespace, 'svg');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(svgNamespace, 'path');
    path.setAttribute('d', 'm12 3 2.78 5.63 6.22.9-4.5 4.39 1.06 6.2L12 17.2l-5.56 2.92 1.06-6.2L3 9.53l6.22-.9L12 3Z');
    icon.appendChild(path);
    btn.appendChild(icon);
    btn.addEventListener('mousedown', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      handleFabFavoriteAction();
    });
    return btn;
  };

  const makeFolderBtn = () => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'text-highlighter-fab-action text-highlighter-fab-folder';
    btn.dataset.fabKind = 'action';
    btn.dataset.actionId = 'folder';
    btn.style.padding = '0';
    btn.style.margin = '0';
    btn.style.width = '18px';
    btn.style.height = '18px';
    btn.style.borderRadius = '999px';
    btn.style.cursor = 'pointer';
    btn.appendChild(createFolderIconElement());
    btn.addEventListener('mousedown', event => {
      event.preventDefault();
      event.stopPropagation();
    });
    btn.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      handleFabFolderAction(btn);
    });
    return btn;
  };

  const makeCloseBtn = () => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'text-highlighter-fab-action text-highlighter-fab-close';
    btn.dataset.fabKind = 'action';
    btn.dataset.actionId = 'close';
    btn.style.padding = '0';
    btn.style.margin = '0';
    btn.style.width = '18px';
    btn.style.height = '18px';
    btn.style.borderRadius = '999px';
    btn.style.cursor = 'pointer';
    btn.title = 'Close FAB, keep text selected';
    btn.setAttribute('aria-label', btn.title);
    const svgNamespace = 'http://www.w3.org/2000/svg';
    const icon = document.createElementNS(svgNamespace, 'svg');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(svgNamespace, 'path');
    path.setAttribute('d', 'M6 6l12 12M18 6 6 18');
    icon.appendChild(path);
    btn.appendChild(icon);
    btn.addEventListener('mousedown', event => {
      event.preventDefault();
      event.stopPropagation();
    });
    btn.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      hideHighlightFab();
    });
    return btn;
  };

  layout.slots.forEach((slotId) => {
    if (!slotId) {
      appendSpacer();
      return;
    }

    const preset = presets.find(p => p && p.id === slotId);
    if (preset) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'text-highlighter-fab-color';
      btn.dataset.fabKind = 'preset';
      btn.dataset.presetId = preset && preset.id ? preset.id : '';
      btn.title = (preset && preset.name) ? preset.name : '';
      btn.style.border = 'none';
      btn.style.padding = '0';
      btn.style.margin = '0';
      btn.style.width = '18px';
      btn.style.height = '18px';
      btn.style.borderRadius = '999px';
      btn.style.cursor = 'pointer';

      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
      });

      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        handleFabPresetAction(preset.id);
      });

      container.appendChild(btn);
      highlightFabButtons.push(btn);
      return;
    }

    if (slotId === 'favorite') {
      const favoriteBtn = makeFavoriteBtn();
      container.appendChild(favoriteBtn);
      highlightFabButtons.push(favoriteBtn);
      return;
    }

    if (slotId === 'folder') {
      const folderBtn = makeFolderBtn();
      container.appendChild(folderBtn);
      highlightFabButtons.push(folderBtn);
      return;
    }

    if (slotId === 'close') {
      const closeBtn = makeCloseBtn();
      container.appendChild(closeBtn);
      highlightFabButtons.push(closeBtn);
      return;
    }

    if (FAB_ACTION_IDS.has(slotId)) {
      const actionBtn = makePlaceholderBtn(slotId);
      container.appendChild(actionBtn);
      highlightFabButtons.push(actionBtn);
      return;
    }

    appendSpacer();
  });
}

function createHighlightFab() {
  if (highlightFab) return highlightFab;

  highlightFab = document.createElement('div');
  highlightFab.className = 'text-highlighter-fab';
  // Layout: grid controlled by fabLayoutV1 (2×4)
  highlightFab.style.display = 'none';
  document.body.appendChild(highlightFab);

  buildFabButtonsInto(highlightFab);

  // Prevent mousedown on the container from clearing selection
  highlightFab.addEventListener('mousedown', (e) => {
    fabLastInputWasKeyboard = false;
    if (highlightFabFolderPopover && !e.target.closest('.text-highlighter-fab-folder')) {
      closeHighlightFabFolderPopover({ restartTimeout: false });
    }
    e.preventDefault();
    e.stopPropagation();
  });

  highlightFab.addEventListener('pointerenter', (event) => {
    if (event.pointerType && event.pointerType !== 'mouse') return;
    fabPointerPaused = true;
    clearFabPostTimeout();
  });

  highlightFab.addEventListener('pointerleave', (event) => {
    if (event.pointerType && event.pointerType !== 'mouse') return;
    fabPointerPaused = false;
    scheduleFabPostTimeout();
  });

  highlightFab.addEventListener('keydown', () => {
    fabLastInputWasKeyboard = true;
    if (highlightFab?.contains(document.activeElement)) {
      fabKeyboardPaused = true;
      clearFabPostTimeout();
    }
  });

  highlightFab.addEventListener('focusin', () => {
    if (!fabLastInputWasKeyboard) return;
    fabKeyboardPaused = true;
    clearFabPostTimeout();
  });

  highlightFab.addEventListener('focusout', () => {
    setTimeout(() => {
      if (highlightFab?.contains(document.activeElement)) return;
      fabKeyboardPaused = false;
      fabLastInputWasKeyboard = false;
      scheduleFabPostTimeout();
    }, 0);
  });

  // Apply initial colors
  applyCustomColors();
  syncHighlightFabState();

  return highlightFab;
}

async function showHighlightFab(x, y) {
  await loadUserSettings();
  if (!userSettings.showFab) return;
  if (!highlightFab) createHighlightFab();

  fabInteractionVersion++;
  clearFabPostState();
  hideHighlightFabStatus();
  if (fabHideTimeout !== null) {
    clearTimeout(fabHideTimeout);
    fabHideTimeout = null;
  }
  highlightFab.classList.remove('is-expiring', 'is-confirming-favorite');
  highlightFab.style.pointerEvents = '';

  // Update palette colors for current theme
  applyCustomColors();
  syncHighlightFabState();

  highlightFab.style.left = x + 'px';
  highlightFab.style.top = y + 'px';
  highlightFab.style.display = 'grid';
}

function hideHighlightFab({ fade = false } = {}) {
  fabInteractionVersion++;
  closeHighlightFabFolderPopover({ restartTimeout: false });
  clearFabPostState();
  if (!highlightFab) return;

  if (fabHideTimeout !== null) {
    clearTimeout(fabHideTimeout);
    fabHideTimeout = null;
  }

  const finishHide = () => {
    if (!highlightFab) return;
    highlightFab.style.display = 'none';
    highlightFab.style.pointerEvents = '';
    highlightFab.classList.remove('is-expiring', 'is-confirming-favorite');
    syncHighlightFabState();
  };

  if (
    fade
    && highlightFab.style.display !== 'none'
    && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ) {
    highlightFab.style.pointerEvents = 'none';
    highlightFab.classList.add('is-expiring');
    fabHideTimeout = setTimeout(() => {
      fabHideTimeout = null;
      finishHide();
    }, FAB_FADE_OUT_MS);
    return;
  }

  finishHide();
}

// Show FAB when text is selected
document.addEventListener('mouseup', (e) => {
  // Ignore if clicking on the FAB itself
  if ((highlightFab && highlightFab.contains(e.target)) || highlightFabFolderPopover?.contains(e.target)) {
    return;
  }
  
  // Small delay to let selection finalize
  setTimeout(() => {
    const selection = window.getSelection();
    
    if (!selection || selection.isCollapsed || !selection.toString().trim()) {
      hideHighlightFab();
      return;
    }
    
    // Check if selection is already highlighted
    const range = selection.getRangeAt(0);
    const ancestor = range.commonAncestorContainer;
    if (ancestor.nodeType === Node.ELEMENT_NODE && ancestor.classList?.contains('text-highlighter-mark')) {
      hideHighlightFab();
      return;
    }
    if (ancestor.parentNode?.classList?.contains('text-highlighter-mark')) {
      hideHighlightFab();
      return;
    }
    
    // Get position to the right of selection
    const rect = range.getBoundingClientRect();
    const x = rect.right + window.scrollX + 8;
    const y = rect.top + window.scrollY + (rect.height / 2) - 12; // Center vertically
    
    showHighlightFab(x, y);
  }, 10);
});

// Hide FAB when clicking elsewhere
document.addEventListener('mousedown', (e) => {
  if (highlightFab && !highlightFab.contains(e.target) && !highlightFabFolderPopover?.contains(e.target)) {
    hideHighlightFab();
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && highlightFab && highlightFab.style.display !== 'none') {
    event.preventDefault();
    hideHighlightFab();
  }
});

// Hide FAB on scroll to avoid orphan button
document.addEventListener('scroll', event => {
  if (highlightFabFolderPopover?.contains(event.target)) return;
  hideHighlightFab();
}, true);

// ============================================
// Message listener and initialization
// ============================================

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.action) {
    case 'highlight':
      highlightSelection();
      hideHighlightFab();
      break;
    case 'removeSelected':
      removeSelectedHighlight();
      break;
    case 'clearAll':
      clearAllHighlights();
      break;
  }
});

// Re-read settings when tab becomes visible (catches changes made on options page)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    loadUserSettings().then(() => {
      updateFabVisibility();
      applyCustomColors();
    });
  } else {
    hideHighlightFab();
  }
});

// Load settings then restore highlights when page loads
async function init() {
  await loadUserSettings();
  await loadFabLayoutV1();
  restoreHighlights();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
