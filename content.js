// Get storage key for current URL
function getStorageKey() {
  return 'highlights_' + window.location.href;
}

// Generate unique ID for highlights
function generateId() {
  return 'hl_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// Save highlights to storage
function saveHighlights() {
  const highlights = [];
  document.querySelectorAll('.text-highlighter-mark').forEach(mark => {
    highlights.push({
      id: mark.dataset.highlightId,
      text: mark.textContent,
      xpath: getXPath(mark.parentNode),
      offset: getTextOffset(mark)
    });
  });
  
  const key = getStorageKey();
  chrome.storage.local.set({ [key]: highlights });
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
    if (child.nodeType === Node.TEXT_NODE) {
      offset += child.textContent.length;
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      offset += child.textContent.length;
    }
  }
  
  return offset;
}

// Highlight the current selection
function highlightSelection() {
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
  
  try {
    const mark = document.createElement('mark');
    mark.className = 'text-highlighter-mark';
    mark.dataset.highlightId = highlightId;
    
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
      
      textNodes.forEach((nodeInfo, index) => {
        const { node, start, end } = nodeInfo;
        const text = node.textContent;
        
        // Create a range for just this portion of text
        const nodeRange = document.createRange();
        nodeRange.setStart(node, start);
        nodeRange.setEnd(node, end);
        
        const mark = document.createElement('mark');
        mark.className = 'text-highlighter-mark';
        mark.dataset.highlightId = highlightId;
        mark.dataset.highlightPart = index;
        
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
  chrome.storage.local.remove(key);
}

// Restore highlights from storage
function restoreHighlights() {
  const key = getStorageKey();
  
  chrome.storage.local.get(key, (result) => {
    const highlights = result[key];
    if (!highlights || !highlights.length) return;
    
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
            
            // Find the highlight text in this node
            const idx = text.indexOf(highlight.text, localOffset > 0 ? localOffset - 5 : 0);
            if (idx !== -1) {
              const range = document.createRange();
              range.setStart(node, idx);
              range.setEnd(node, idx + highlight.text.length);
              
              const mark = document.createElement('mark');
              mark.className = 'text-highlighter-mark';
              mark.dataset.highlightId = highlight.id;
              
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

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.action) {
    case 'highlight':
      highlightSelection();
      break;
    case 'removeSelected':
      removeSelectedHighlight();
      break;
    case 'clearAll':
      clearAllHighlights();
      break;
  }
});

// Restore highlights when page loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', restoreHighlights);
} else {
  restoreHighlights();
}
