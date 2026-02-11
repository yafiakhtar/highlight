// Platform detection: show ⌘ on Mac, Ctrl on others
const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);
document.getElementById('modifierKey').textContent = isMac ? '⌘' : 'Ctrl';

// Theme: load saved preference
chrome.storage.local.get('popupTheme', (data) => {
  if (data.popupTheme === 'dark') {
    document.body.classList.add('dark');
  }
});

// Theme toggle
document.getElementById('theme').addEventListener('click', () => {
  document.body.classList.toggle('dark');
  const isDark = document.body.classList.contains('dark');
  chrome.storage.local.set({ popupTheme: isDark ? 'dark' : 'light' });
});

// Live sync when theme or highlight settings change
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  if (changes.popupTheme) {
    const theme = changes.popupTheme.newValue;
    if (theme === 'dark') {
      document.body.classList.add('dark');
    } else {
      document.body.classList.remove('dark');
    }
  }
  if (changes.highlightSettings) {
    const s = changes.highlightSettings.newValue;
    if (s) {
      fabToggleBtn.classList.toggle('fab-disabled', s.showFab === false);
      fabToggleBtn.title = s.showFab === false ? 'Enable FAB' : 'Disable FAB';
      applyFabColors(s.colorLight, s.colorDark);
    }
  }
});

// Trash button: clear highlights for current page
document.getElementById('trash').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    chrome.tabs.sendMessage(tab.id, { action: 'clearAll' });
    window.close();
  }
});

// Home button: open options page
document.getElementById('home').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('options.html') });
});

// Settings button: open options page with settings tab
document.getElementById('settings').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('options.html?tab=settings') });
});

// FAB toggle button: enable/disable the floating action button
const fabToggleBtn = document.getElementById('fab-toggle');

const FAB_COLOR_LIGHT_DEFAULT = '#FFEA99';
const FAB_COLOR_DARK_DEFAULT = '#7C6129';

function applyFabColors(colorLight, colorDark) {
  const lightEl = document.getElementById('fab-color-light');
  const darkEl = document.getElementById('fab-color-dark');
  if (lightEl) lightEl.setAttribute('fill', colorLight || FAB_COLOR_LIGHT_DEFAULT);
  if (darkEl) darkEl.setAttribute('fill', colorDark || FAB_COLOR_DARK_DEFAULT);
}

// Load saved FAB preference and split colours
chrome.storage.local.get('highlightSettings', (data) => {
  const settings = data.highlightSettings || {};
  if (settings.showFab === false) {
    fabToggleBtn.classList.add('fab-disabled');
    fabToggleBtn.title = 'Enable FAB';
  }
  applyFabColors(settings.colorLight, settings.colorDark);
});

fabToggleBtn.addEventListener('click', () => {
  chrome.storage.local.get('highlightSettings', (data) => {
    const settings = data.highlightSettings || {};
    const newFabState = settings.showFab !== false ? false : true;
    
    settings.showFab = newFabState;
    chrome.storage.local.set({ highlightSettings: settings });
    
    if (newFabState) {
      fabToggleBtn.classList.remove('fab-disabled');
      fabToggleBtn.title = 'Disable FAB';
    } else {
      fabToggleBtn.classList.add('fab-disabled');
      fabToggleBtn.title = 'Enable FAB';
    }
  });
});

// --- Drag and drop reordering ---
const toolbar = document.getElementById('toolbar');
let draggedBtn = null;

function getButtons() {
  return Array.from(toolbar.querySelectorAll('.toolbar-btn'));
}

function saveOrder() {
  const order = getButtons().map(btn => btn.id);
  chrome.storage.local.set({ popupButtonOrder: order });
}

function restoreOrder(order) {
  order.forEach(id => {
    const btn = document.getElementById(id);
    if (btn) toolbar.appendChild(btn);
  });
}

// Merge in FAB button if missing (from older saves)
function mergeNewButtons(order) {
  const defaultOrder = ['trash', 'theme', 'settings', 'fab-toggle', 'home'];
  const hasAllButtons = defaultOrder.every(id => order.includes(id));
  if (!hasAllButtons) {
    const missingButtons = defaultOrder.filter(id => !order.includes(id));
    order = [...order, ...missingButtons];
    chrome.storage.local.set({ popupButtonOrder: order });
  }
  return order;
}

// Load saved order on startup
chrome.storage.local.get('popupButtonOrder', (data) => {
  let order = data.popupButtonOrder;
  if (order && Array.isArray(order)) {
    order = mergeNewButtons(order);
    restoreOrder(order);
  }
});

// Drag events (delegated to toolbar)
toolbar.addEventListener('dragstart', (e) => {
  const btn = e.target.closest('.toolbar-btn');
  if (!btn) return;
  draggedBtn = btn;
  btn.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
});

toolbar.addEventListener('dragover', (e) => {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const btn = e.target.closest('.toolbar-btn');
  if (btn && btn !== draggedBtn) {
    btn.classList.add('drag-over');
  }
});

toolbar.addEventListener('dragleave', (e) => {
  const btn = e.target.closest('.toolbar-btn');
  if (btn) btn.classList.remove('drag-over');
});

toolbar.addEventListener('drop', (e) => {
  e.preventDefault();
  const targetBtn = e.target.closest('.toolbar-btn');
  if (!targetBtn || !draggedBtn || targetBtn === draggedBtn) return;

  const buttons = getButtons();
  const draggedIdx = buttons.indexOf(draggedBtn);
  const targetIdx = buttons.indexOf(targetBtn);

  if (draggedIdx < targetIdx) {
    toolbar.insertBefore(draggedBtn, targetBtn.nextSibling);
  } else {
    toolbar.insertBefore(draggedBtn, targetBtn);
  }

  targetBtn.classList.remove('drag-over');
  saveOrder();
});

toolbar.addEventListener('dragend', () => {
  if (draggedBtn) {
    draggedBtn.classList.remove('dragging');
    draggedBtn = null;
  }
  getButtons().forEach(btn => btn.classList.remove('drag-over'));
});
