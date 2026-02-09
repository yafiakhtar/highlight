// ---- Theme (sync with popup via popupTheme) ----
chrome.storage.local.get('popupTheme', (data) => {
  if (data.popupTheme === 'dark') {
    document.body.classList.add('dark');
  } else {
    document.body.classList.remove('dark');
  }
});

document.getElementById('optionsThemeToggle').addEventListener('click', () => {
  document.body.classList.toggle('dark');
  const isDark = document.body.classList.contains('dark');
  chrome.storage.local.set({ popupTheme: isDark ? 'dark' : 'light' });
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes.popupTheme) {
    const theme = changes.popupTheme.newValue;
    if (theme === 'dark') {
      document.body.classList.add('dark');
    } else {
      document.body.classList.remove('dark');
    }
  }
});

// ---- Tab switching ----
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    const panel = document.getElementById('tab-' + btn.dataset.tab);
    panel.classList.add('active');
    
    // Reset sidebar to default item when switching tabs
    resetSidebarForTab(btn.dataset.tab);
  });
});

// ---- Sidebar Navigation ----

function resetSidebarForTab(tabName) {
  const panel = document.getElementById('tab-' + tabName);
  if (!panel) return;
  
  const sidebar = panel.querySelector('.sidebar');
  if (!sidebar) return;
  
  // Remove active state from all sidebar items in this tab
  sidebar.querySelectorAll('.sidebar-item').forEach(item => {
    item.classList.remove('active');
  });
  
  // Set first sidebar item as active
  const firstItem = sidebar.querySelector('.sidebar-item');
  if (firstItem) {
    firstItem.classList.add('active');
    switchSidebarView(tabName, firstItem.dataset.view);
  }
}

function switchSidebarView(tabName, viewName) {
  const panel = document.getElementById('tab-' + tabName);
  if (!panel) return;
  
  if (tabName === 'library') {
    // Library tab: all views show the same content for now (Phase 1)
    // In future phases, this will filter highlights
    // For now, just update active state
    const sidebar = panel.querySelector('.sidebar');
    sidebar.querySelectorAll('.sidebar-item').forEach(item => {
      item.classList.toggle('active', item.dataset.view === viewName);
    });
  } else if (tabName === 'settings') {
    // Settings tab: show/hide corresponding settings view
    panel.querySelectorAll('.settings-view').forEach(view => {
      view.classList.toggle('active', view.dataset.view === viewName);
    });
    
    // Update sidebar active state
    const sidebar = panel.querySelector('.sidebar');
    sidebar.querySelectorAll('.sidebar-item').forEach(item => {
      item.classList.toggle('active', item.dataset.view === viewName);
    });
  }
}

// Initialize sidebar navigation handlers
function initSidebarNavigation() {
  document.querySelectorAll('.sidebar-item').forEach(item => {
    item.addEventListener('click', () => {
      const panel = item.closest('.tab-panel');
      if (!panel) return;
      
      const tabName = panel.id.replace('tab-', '');
      switchSidebarView(tabName, item.dataset.view);
    });
  });
}

// ---- URL parameter handling ----
function switchToTab(tabName) {
  const tabBtn = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
  if (tabBtn) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    tabBtn.classList.add('active');
    const panel = document.getElementById('tab-' + tabName);
    panel.classList.add('active');
    
    // Reset sidebar to default item when switching tabs
    resetSidebarForTab(tabName);
  }
}

// Check for tab parameter in URL on load
const urlParams = new URLSearchParams(window.location.search);
const tabParam = urlParams.get('tab');
if (tabParam) {
  switchToTab(tabParam);
}

// Default settings
const DEFAULTS = {
  colorLight: '#FFEA99',
  colorDark: '#7C6129',
  showFab: true
};

// DOM elements
const colorLightPicker = document.getElementById('colorLight');
const colorLightHex = document.getElementById('colorLightHex');
const colorDarkPicker = document.getElementById('colorDark');
const colorDarkHex = document.getElementById('colorDarkHex');
const showFabToggle = document.getElementById('showFab');
const previewMarkLight = document.getElementById('previewMarkLight');
const previewMarkDark = document.getElementById('previewMarkDark');
const saveBtn = document.getElementById('saveBtn');
const resetBtn = document.getElementById('resetBtn');
const openShortcuts = document.getElementById('openShortcuts');
const toast = document.getElementById('toast');

// ---- Color sync helpers ----

function syncLightColor(hex) {
  colorLightPicker.value = hex;
  colorLightHex.value = hex.toUpperCase();
  previewMarkLight.style.backgroundColor = hex;
  previewMarkLight.style.color = '#1a1a1a';
}

function syncDarkColor(hex) {
  colorDarkPicker.value = hex;
  colorDarkHex.value = hex.toUpperCase();
  previewMarkDark.style.backgroundColor = hex;
  previewMarkDark.style.color = '#fff';
}

// Validate hex color input
function isValidHex(str) {
  return /^#[0-9A-Fa-f]{6}$/.test(str);
}

// ---- Event listeners for color inputs ----

colorLightPicker.addEventListener('input', (e) => {
  syncLightColor(e.target.value);
});

colorLightHex.addEventListener('input', (e) => {
  let val = e.target.value;
  if (!val.startsWith('#')) val = '#' + val;
  if (isValidHex(val)) {
    syncLightColor(val);
  }
});

colorLightHex.addEventListener('blur', (e) => {
  let val = e.target.value;
  if (!val.startsWith('#')) val = '#' + val;
  if (!isValidHex(val)) {
    syncLightColor(colorLightPicker.value);
  }
});

colorDarkPicker.addEventListener('input', (e) => {
  syncDarkColor(e.target.value);
});

colorDarkHex.addEventListener('input', (e) => {
  let val = e.target.value;
  if (!val.startsWith('#')) val = '#' + val;
  if (isValidHex(val)) {
    syncDarkColor(val);
  }
});

colorDarkHex.addEventListener('blur', (e) => {
  let val = e.target.value;
  if (!val.startsWith('#')) val = '#' + val;
  if (!isValidHex(val)) {
    syncDarkColor(colorDarkPicker.value);
  }
});

// ---- Save / Load / Reset ----

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2000);
}

function saveSettings() {
  const settings = {
    colorLight: colorLightPicker.value,
    colorDark: colorDarkPicker.value,
    showFab: showFabToggle.checked
  };

  chrome.storage.local.set({ highlightSettings: settings }, () => {
    showToast('Settings saved');
  });
}

function loadSettings() {
  chrome.storage.local.get('highlightSettings', (result) => {
    const s = result.highlightSettings || DEFAULTS;

    syncLightColor(s.colorLight || DEFAULTS.colorLight);
    syncDarkColor(s.colorDark || DEFAULTS.colorDark);
    showFabToggle.checked = s.showFab !== undefined ? s.showFab : DEFAULTS.showFab;
  });
}

function resetSettings() {
  syncLightColor(DEFAULTS.colorLight);
  syncDarkColor(DEFAULTS.colorDark);
  showFabToggle.checked = DEFAULTS.showFab;

  chrome.storage.local.set({ highlightSettings: DEFAULTS }, () => {
    showToast('Reset to defaults');
  });
}

// ---- Button handlers ----

saveBtn.addEventListener('click', saveSettings);
resetBtn.addEventListener('click', resetSettings);

// Auto-save when the FAB toggle changes (toggles should be instant)
showFabToggle.addEventListener('change', saveSettings);

openShortcuts.addEventListener('click', () => {
  // chrome:// URLs can't be opened directly; copy the URL for the user instead
  try {
    chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
  } catch {
    // Fallback: open the general extensions page
    chrome.tabs.create({ url: 'https://support.google.com/chrome_webstore/answer/2664769' });
  }
});

// ---- Detect shortcut ----

chrome.commands.getAll((commands) => {
  const hlCmd = commands.find(c => c.name === 'highlight-selection');
  if (hlCmd && hlCmd.shortcut) {
    document.getElementById('shortcutDisplay').textContent = hlCmd.shortcut;
  }
});

// ============================================
// Highlights list
// ============================================

const highlightsContainer = document.getElementById('highlightsContainer');
const highlightCount = document.getElementById('highlightCount');

// Load all highlights from storage and render them
function loadAllHighlights() {
  chrome.storage.local.get(null, (all) => {
    const index = all.highlightIndex || {};
    const indexNeedsUpdate = {};

    // Scan ALL keys for highlights_* data — don't rely only on the index
    const pages = [];
    let totalCount = 0;

    for (const storageKey of Object.keys(all)) {
      if (!storageKey.startsWith('highlights_')) continue;

      const url = storageKey.substring('highlights_'.length);
      const highlights = all[storageKey];
      if (!Array.isArray(highlights) || highlights.length === 0) continue;

      // Use index metadata if available, otherwise build it
      const meta = index[url] || {};
      const title = meta.title || url;
      const lastUpdated = meta.lastUpdated || Date.now();

      // If this URL is missing from the index, flag it for repair
      if (!index[url]) {
        indexNeedsUpdate[url] = { title: url, lastUpdated };
      }

      totalCount += highlights.length;
      pages.push({
        url,
        title,
        lastUpdated,
        highlights: highlights.slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
      });
    }

    // Repair: write missing entries back to the index
    if (Object.keys(indexNeedsUpdate).length > 0) {
      const repairedIndex = { ...index, ...indexNeedsUpdate };
      chrome.storage.local.set({ highlightIndex: repairedIndex });
    }

    if (pages.length === 0) {
      renderEmpty();
      return;
    }

    // Sort pages by lastUpdated (most recent first)
    pages.sort((a, b) => (b.lastUpdated || 0) - (a.lastUpdated || 0));

    renderHighlights(pages, totalCount);
  });
}

// Render the empty state
function renderEmpty() {
  highlightCount.textContent = '';
  highlightsContainer.innerHTML = `
    <div class="empty-state">
      <div class="empty-state-title">No highlights yet</div>
      Highlight text on any webpage and it will appear here.
    </div>
  `;
}

// Render all page groups
function renderHighlights(pages, totalCount) {
  highlightCount.textContent = totalCount + ' saved';
  highlightsContainer.innerHTML = '';

  pages.forEach(page => {
    const group = document.createElement('div');
    group.className = 'page-group';

    // Header: title + clear button
    const header = document.createElement('div');
    header.className = 'page-header';

    const info = document.createElement('div');
    info.className = 'page-info';

    const titleLink = document.createElement('a');
    titleLink.className = 'page-title';
    titleLink.href = page.url;
    titleLink.target = '_blank';
    titleLink.rel = 'noopener';
    titleLink.textContent = page.title;
    titleLink.title = page.title;

    const urlText = document.createElement('span');
    urlText.className = 'page-url';
    urlText.textContent = page.url;

    info.appendChild(titleLink);
    info.appendChild(urlText);

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'page-clear-btn';
    clearBtn.textContent = 'Clear all';
    clearBtn.addEventListener('click', () => deletePageHighlights(page.url));

    header.appendChild(info);
    header.appendChild(clearBtn);
    group.appendChild(header);

    // Snippet list
    const list = document.createElement('ul');
    list.className = 'snippet-list';

    page.highlights.forEach(hl => {
      const item = document.createElement('li');
      item.className = 'snippet-item';

      const text = document.createElement('span');
      text.className = 'snippet-text';
      text.textContent = hl.text;

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'snippet-delete';
      del.innerHTML = '&#215;';
      del.title = 'Delete highlight';
      del.addEventListener('click', () => deleteHighlight(page.url, hl.id));

      item.appendChild(text);
      item.appendChild(del);
      list.appendChild(item);
    });

    group.appendChild(list);
    highlightsContainer.appendChild(group);
  });
}

// Delete a single highlight by ID
function deleteHighlight(url, highlightId) {
  const key = 'highlights_' + url;

  chrome.storage.local.get([key, 'highlightIndex'], (result) => {
    let highlights = result[key] || [];
    highlights = highlights.filter(h => h.id !== highlightId);

    if (highlights.length > 0) {
      chrome.storage.local.set({ [key]: highlights }, () => {
        loadAllHighlights();
      });
    } else {
      // Last highlight removed — clean up the page entry
      const index = result.highlightIndex || {};
      delete index[url];
      chrome.storage.local.remove(key, () => {
        chrome.storage.local.set({ highlightIndex: index }, () => {
          loadAllHighlights();
        });
      });
    }
  });
}

// Delete all highlights for a page
function deletePageHighlights(url) {
  const key = 'highlights_' + url;

  chrome.storage.local.get('highlightIndex', (result) => {
    const index = result.highlightIndex || {};
    delete index[url];

    chrome.storage.local.remove(key, () => {
      chrome.storage.local.set({ highlightIndex: index }, () => {
        loadAllHighlights();
      });
    });
  });
}

// Live-update when highlights change from another tab
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;

  // Re-render if any highlight data changed
  const hasHighlightChange = Object.keys(changes).some(
    k => k === 'highlightIndex' || k.startsWith('highlights_')
  );

  if (hasHighlightChange) {
    loadAllHighlights();
  }
});

// ---- Sidebar collapse (icon-only) ----

const SIDEBAR_COLLAPSED_KEY = 'optionsSidebarCollapsed';

function getAllSidebars() {
  return document.querySelectorAll('.sidebar');
}

function setSidebarCollapsed(collapsed) {
  getAllSidebars().forEach(sidebar => {
    sidebar.classList.toggle('collapsed', collapsed);
  });
  document.querySelectorAll('.sidebar-toggle').forEach(btn => {
    btn.title = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
  });
}

function getSidebarCollapsed() {
  const sidebar = document.querySelector('.sidebar');
  return sidebar ? sidebar.classList.contains('collapsed') : false;
}

function loadSidebarCollapsedState() {
  chrome.storage.local.get(SIDEBAR_COLLAPSED_KEY, (result) => {
    const collapsed = result[SIDEBAR_COLLAPSED_KEY] === true;
    setSidebarCollapsed(collapsed);
  });
}

function saveSidebarCollapsedState(collapsed) {
  chrome.storage.local.set({ [SIDEBAR_COLLAPSED_KEY]: collapsed });
}

function initSidebarCollapseToggle() {
  document.querySelectorAll('.sidebar-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const collapsed = !getSidebarCollapsed();
      setSidebarCollapsed(collapsed);
      saveSidebarCollapsedState(collapsed);
    });
  });
}

function initSearchCollapsedBtn() {
  document.querySelectorAll('.search-bar-collapsed-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      setSidebarCollapsed(false);
      saveSidebarCollapsedState(false);
      const sidebar = btn.closest('.sidebar');
      const input = sidebar ? sidebar.querySelector('.search-bar-wrap input') : null;
      if (input) {
        input.focus();
      }
    });
  });
}

// ---- Init ----
loadSettings();
loadAllHighlights();
initSidebarNavigation();
loadSidebarCollapsedState();
initSidebarCollapseToggle();
initSearchCollapsedBtn();

// Initialize sidebar state for active tab on load
const activeTab = document.querySelector('.tab-btn.active');
if (activeTab) {
  resetSidebarForTab(activeTab.dataset.tab);
}
