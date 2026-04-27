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

function defaultFabLayoutV1() {
  return { rows: 2, cols: 4, slots: ['preset1', 'preset2', 'preset3', 'preset4', null, null, null, null] };
}

function normalizeFabLayoutV1(raw) {
  const base = defaultFabLayoutV1();
  if (!raw || typeof raw !== 'object') return base;
  const rows = raw.rows === 2 ? 2 : 2;
  const cols = raw.cols === 4 ? 4 : 4;
  const expected = rows * cols;
  const slots = Array.isArray(raw.slots) ? raw.slots.slice(0, expected) : [];
  while (slots.length < expected) slots.push(null);
  return { rows, cols, slots };
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
        fabLayoutV1 = normalizeFabLayoutV1(result && result[FAB_LAYOUT_KEY]);
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

  // Settings changed (colors, FAB toggle)
  if (changes.highlightSettings) {
    const newVal = changes.highlightSettings.newValue;
    userSettings = { ...DEFAULT_SETTINGS, ...newVal };
    applyCustomColors();
    updateFabVisibility();
  }

  if (Object.prototype.hasOwnProperty.call(changes, FAB_LAYOUT_KEY)) {
    const next = changes[FAB_LAYOUT_KEY] && changes[FAB_LAYOUT_KEY].newValue;
    fabLayoutV1 = normalizeFabLayoutV1(next);
    rebuildHighlightFab();
  }

  // Highlight data for this page changed (e.g. deleted from options page)
  const key = getStorageKey();
  if (changes[key]) {
    const newHighlights = changes[key].newValue;
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
      document.querySelectorAll('.text-highlighter-mark').forEach(mark => {
        if (!activeIds.has(mark.dataset.highlightId)) {
          const parent = mark.parentNode;
          while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
          parent.removeChild(mark);
          parent.normalize();
        }
      });
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
  // Only update FAB palette colors; existing marks keep their stored colors
  if (!highlightFab || !Array.isArray(highlightFabButtons) || highlightFabButtons.length === 0) return;
  const theme = getPageTheme();
  const isDark = theme === 'dark';
  const presets = Array.isArray(userSettings.presets) && userSettings.presets.length
    ? userSettings.presets
    : DEFAULT_SETTINGS.presets;

  highlightFabButtons.forEach((btn, index) => {
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
    highlightFab.style.display = 'none';
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
    const color = items.find(it => typeof it.color === 'string' && it.color.trim() !== '')?.color
      || base.color
      || null;
    const presetId = items.find(it => typeof it.presetId === 'string' && it.presetId.trim() !== '')?.presetId
      || base.presetId
      || null;

    const firstPart = parts[0] || { xpath: base.xpath || '', offset: base.offset || 0 };

    const out = {
      ...base,
      id,
      presetId,
      text: combinedText,
      xpath: firstPart.xpath,
      offset: firstPart.offset,
      color,
      createdAt,
      parts
    };

    if (favorited) out.favorited = true;
    else delete out.favorited;

    merged.push(out);
  }

  return { highlights: merged, changed };
}

// Save highlights to storage and update the global index
function saveHighlights() {
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
    const presetId = first.dataset.presetId || null;
    const color = first.style.backgroundColor || null;

    // Keep xpath/offset for older readers; points at first part.
    const firstPart = parts[0] || { xpath: '', offset: 0, text: '' };

    highlights.push({
      id,
      presetId,
      text: combinedText,
      xpath: firstPart.xpath,
      offset: firstPart.offset,
      color,
      parts
    });
  }

  // Read existing data to preserve createdAt timestamps, then write
  if (!isExtensionContextValid()) return;
  try {
    chrome.storage.local.get([key, 'highlightIndex'], (result) => {
      if (chrome.runtime.lastError) return;
    // Preserve existing createdAt timestamps and favorited flag
    const oldHighlights = result[key] || [];
    const oldTimestamps = {};
    const oldFavorited = {};
    oldHighlights.forEach(h => {
      oldTimestamps[h.id] = h.createdAt;
      if (h.favorited === true) oldFavorited[h.id] = true;
    });

    highlights.forEach(h => {
      h.createdAt = oldTimestamps[h.id] || Date.now();
      if (oldFavorited[h.id]) h.favorited = true;
    });

    const index = result.highlightIndex || {};

    if (highlights.length > 0) {
      index[url] = {
        title: document.title || url,
        lastUpdated: Date.now()
      };
      chrome.storage.local.set({ [key]: highlights, highlightIndex: index });
    } else {
      // No highlights left — clean up
      delete index[url];
      chrome.storage.local.remove(key);
      chrome.storage.local.set({ highlightIndex: index });
    }
    });
  } catch {
    // ignore
  }
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

// Highlight the current selection
async function highlightSelection(presetIndex = 0) {
  await loadUserSettings();
  const selection = window.getSelection();
  
  if (!selection || selection.isCollapsed || !selection.toString().trim()) {
    return;
  }
  
  const range = selection.getRangeAt(0);
  
  // Check if selection is already highlighted
  const ancestor = range.commonAncestorContainer;
  if (ancestor.nodeType === Node.ELEMENT_NODE && ancestor.classList?.contains('text-highlighter-mark')) {
    return;
  }
  if (ancestor.parentNode?.classList?.contains('text-highlighter-mark')) {
    return;
  }
  
  const highlightId = generateId();
  const theme = getPageTheme();
  const themeClass = theme === 'dark' ? 'hl-dark' : 'hl-light';
  const presets = Array.isArray(userSettings.presets) && userSettings.presets.length
    ? userSettings.presets
    : DEFAULT_SETTINGS.presets;
  const preset = presets[presetIndex] || presets[0];
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
    saveHighlights();
  } catch (e) {
    // surroundContents fails if selection crosses element boundaries
    // Wrap each text node individually to preserve DOM structure
    try {
      const textNodes = getTextNodesInRange(range);
      
      if (textNodes.length === 0) {
        return;
      }
      
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
        } catch (err) {
          // Skip nodes that can't be wrapped
        }
      });
      
      selection.removeAllRanges();
      saveHighlights();
    } catch (e2) {
      console.error('Could not highlight selection:', e2);
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
    const fallbackColor = theme === 'dark' ? userSettings.colorDark : userSettings.colorLight;
    let needsColorBackfill = false;

    highlights.forEach(highlight => {
      try {
        if (document.querySelector(`.text-highlighter-mark[data-highlight-id="${highlight.id}"]`)) {
          return;
        }
        const parts = Array.isArray(highlight.parts) && highlight.parts.length > 0
          ? highlight.parts
          : [{ xpath: highlight.xpath, offset: highlight.offset, text: highlight.text }];

        const hasStoredColor = typeof highlight.color === 'string' && highlight.color.trim() !== '';
        const appliedColor = hasStoredColor ? highlight.color : fallbackColor;
        if (!hasStoredColor) needsColorBackfill = true;

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
                if (typeof highlight.presetId === 'string' && highlight.presetId.trim() !== '') {
                  mark.dataset.presetId = highlight.presetId;
                }
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

    // Self-heal: if any restored highlight lacked a stored color, persist the
    // colors currently on the DOM marks so future reloads remain stable.
    if (needsColorBackfill) {
      saveHighlights();
    }
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

function rebuildHighlightFab() {
  if (!highlightFab) return;
  highlightFab.innerHTML = '';
  highlightFabButtons = [];
  buildFabButtonsInto(highlightFab);
  applyCustomColors();
}

function buildFabButtonsInto(container) {
  const layout = fabLayoutV1 || defaultFabLayoutV1();
  const presets = Array.isArray(userSettings.presets) && userSettings.presets.length
    ? userSettings.presets
    : DEFAULT_SETTINGS.presets;

  container.style.display = 'grid';
  container.style.gridTemplateColumns = `repeat(${layout.cols}, 18px)`;
  container.style.gridAutoRows = '18px';
  container.style.gap = '8px';
  container.style.alignItems = 'center';
  container.style.justifyContent = 'center';

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

  layout.slots.forEach((slotId) => {
    if (!slotId) {
      const spacer = document.createElement('div');
      spacer.style.width = '18px';
      spacer.style.height = '18px';
      container.appendChild(spacer);
      return;
    }

    if (slotId.startsWith('preset')) {
      const preset = presets.find(p => p && p.id === slotId) || presets[0];
      const presetIndex = presets.indexOf(preset);
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
        // Track last-used preset for popup icon consistency
        try {
          if (isExtensionContextValid() && preset && typeof preset.id === 'string' && preset.id.trim() !== '') {
            chrome.storage.local.set({ lastUsedPresetId: preset.id });
          }
        } catch {
          // ignore
        }
        highlightSelection(presetIndex >= 0 ? presetIndex : 0);
        hideHighlightFab();
      });

      container.appendChild(btn);
      highlightFabButtons.push(btn);
      return;
    }

    const actionBtn = makePlaceholderBtn(slotId);
    container.appendChild(actionBtn);
    highlightFabButtons.push(actionBtn);
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
    e.preventDefault();
    e.stopPropagation();
  });

  // Apply initial colors
  applyCustomColors();

  return highlightFab;
}

async function showHighlightFab(x, y) {
  await loadUserSettings();
  if (!userSettings.showFab) return;
  if (!highlightFab) createHighlightFab();

  // Update palette colors for current theme
  applyCustomColors();

  highlightFab.style.left = x + 'px';
  highlightFab.style.top = y + 'px';
  highlightFab.style.display = 'block';
}

function hideHighlightFab() {
  if (highlightFab) {
    highlightFab.style.display = 'none';
  }
}

// Show FAB when text is selected
document.addEventListener('mouseup', (e) => {
  // Ignore if clicking on the FAB itself
  if (highlightFab && highlightFab.contains(e.target)) {
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
  if (highlightFab && !highlightFab.contains(e.target)) {
    hideHighlightFab();
  }
});

// Hide FAB on scroll to avoid orphan button
document.addEventListener('scroll', () => {
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