// Platform detection: show ⌘ on Mac, Ctrl on others
const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);
document.getElementById('modifierKey').textContent = isMac ? '⌘' : 'Ctrl';

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

// Load saved order on startup
chrome.storage.local.get('popupButtonOrder', (data) => {
  if (data.popupButtonOrder && Array.isArray(data.popupButtonOrder)) {
    restoreOrder(data.popupButtonOrder);
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
