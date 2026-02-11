// Default settings
const DEFAULT_SETTINGS = {
  colorLight: '#FFEA99',
  colorDark: '#7C6129',
  showFab: true
};

let userSettings = { ...DEFAULT_SETTINGS };

// Load user settings from storage
function loadUserSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get('highlightSettings', (result) => {
      if (result.highlightSettings) {
        userSettings = { ...DEFAULT_SETTINGS, ...result.highlightSettings };
      }
      resolve(userSettings);
    });
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
    }
  }
});

// Apply custom highlight colors to existing marks
function applyCustomColors() {
  document.querySelectorAll('.text-highlighter-mark.hl-light').forEach(mark => {
    mark.style.backgroundColor = userSettings.colorLight;
  });
  document.querySelectorAll('.text-highlighter-mark.hl-dark').forEach(mark => {
    mark.style.backgroundColor = userSettings.colorDark;
  });
  // Update FAB colors too
  if (highlightFab) {
    if (highlightFab.classList.contains('fab-light')) {
      highlightFab.style.backgroundColor = userSettings.colorLight;
    } else if (highlightFab.classList.contains('fab-dark')) {
      highlightFab.style.backgroundColor = userSettings.colorDark;
    }
  }
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

// Generate unique ID for highlights
function generateId() {
  return 'hl_' + Date.now() + '_' + Math.random().toString(36).substring(2, 11);
}

// Save highlights to storage and update the global index
function saveHighlights() {
  const key = getStorageKey();
  const url = window.location.href;

  // Gather current highlights from the DOM first (synchronous)
  const highlights = [];
  document.querySelectorAll('.text-highlighter-mark').forEach(mark => {
    const id = mark.dataset.highlightId;
    highlights.push({
      id,
      text: mark.textContent,
      xpath: getXPath(mark.parentNode),
      offset: getTextOffset(mark)
    });
  });

  // Read existing data to preserve createdAt timestamps, then write
  chrome.storage.local.get([key, 'highlightIndex'], (result) => {
    // Preserve existing createdAt timestamps
    const oldHighlights = result[key] || [];
    const oldTimestamps = {};
    oldHighlights.forEach(h => { oldTimestamps[h.id] = h.createdAt; });

    highlights.forEach(h => {
      h.createdAt = oldTimestamps[h.id] || Date.now();
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
async function highlightSelection() {
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
  
  try {
    const mark = document.createElement('mark');
    mark.className = 'text-highlighter-mark ' + themeClass;
    mark.dataset.highlightId = highlightId;
    mark.style.backgroundColor = theme === 'dark' ? userSettings.colorDark : userSettings.colorLight;
    
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
        mark.style.backgroundColor = theme === 'dark' ? userSettings.colorDark : userSettings.colorLight;
        
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
  
  // Find all marks with the same highlight ID (for multi-part highlights)
  const allParts = document.querySelectorAll(`.text-highlighter-mark[data-highlight-id="${highlightId}"]`);
  
  allParts.forEach(part => {
    const parent = part.parentNode;
    while (part.firstChild) {
      parent.insertBefore(part.firstChild, part);
    }
    parent.removeChild(part);
    parent.normalize(); // Merge adjacent text nodes
  });
  
  saveHighlights();
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
  document.querySelectorAll('.text-highlighter-mark').forEach(mark => {
    const parent = mark.parentNode;
    while (mark.firstChild) {
      parent.insertBefore(mark.firstChild, mark);
    }
    parent.removeChild(mark);
    parent.normalize();
  });
  
  const key = getStorageKey();
  const url = window.location.href;
  chrome.storage.local.remove(key);

  // Remove this page from the global index
  chrome.storage.local.get('highlightIndex', (result) => {
    const index = result.highlightIndex || {};
    delete index[url];
    chrome.storage.local.set({ highlightIndex: index });
  });
}

// Restore highlights from storage
function restoreHighlights() {
  const key = getStorageKey();
  
  chrome.storage.local.get(key, (result) => {
    const highlights = result[key];
    if (!highlights || !highlights.length) return;
    
    const theme = getPageTheme();
    const themeClass = theme === 'dark' ? 'hl-dark' : 'hl-light';
    
    highlights.forEach(highlight => {
      try {
        // Find the element using XPath
        const xpathResult = document.evaluate(
          highlight.xpath,
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
          if (currentOffset + nodeLength > highlight.offset) {
            const localOffset = highlight.offset - currentOffset;
            const text = node.textContent;
            
            // Search slightly before expected offset to tolerate minor DOM changes
            const idx = text.indexOf(highlight.text, localOffset > 0 ? localOffset - 5 : 0);
            if (idx !== -1) {
              const range = document.createRange();
              range.setStart(node, idx);
              range.setEnd(node, idx + highlight.text.length);
              
              const mark = document.createElement('mark');
              mark.className = 'text-highlighter-mark ' + themeClass;
              mark.dataset.highlightId = highlight.id;
              mark.style.backgroundColor = theme === 'dark' ? userSettings.colorDark : userSettings.colorLight;
              
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
      } catch (e) {
        // Ignore errors during restore
      }
    });
  });
}

// ============================================
// Floating Action Button (FAB) for highlighting
// ============================================

// Create the FAB element once
let highlightFab = null;

function createHighlightFab() {
  if (highlightFab) return highlightFab;
  
  highlightFab = document.createElement('div');
  highlightFab.className = 'text-highlighter-fab';
  highlightFab.title = 'Highlight selection';
  document.body.appendChild(highlightFab);
  
  // Click handler - highlight and hide
  highlightFab.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    highlightSelection();
    hideHighlightFab();
  });
  
  // Prevent mousedown from clearing selection
  highlightFab.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  
  return highlightFab;
}

async function showHighlightFab(x, y) {
  await loadUserSettings();
  if (!userSettings.showFab) return;
  if (!highlightFab) createHighlightFab();
  
  // Apply theme-appropriate color
  const theme = getPageTheme();
  highlightFab.classList.remove('fab-light', 'fab-dark');
  highlightFab.classList.add(theme === 'dark' ? 'fab-dark' : 'fab-light');
  highlightFab.style.backgroundColor = theme === 'dark' ? userSettings.colorDark : userSettings.colorLight;
  
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
  restoreHighlights();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}