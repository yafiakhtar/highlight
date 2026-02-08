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

// Load saved FAB preference
chrome.storage.local.get('highlightSettings', (data) => {
  const settings = data.highlightSettings || {};
  if (settings.showFab === false) {
    fabToggleBtn.classList.add('fab-disabled');
    fabToggleBtn.title = 'Enable FAB';
  }
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
