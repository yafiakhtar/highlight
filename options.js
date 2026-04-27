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
  if (pendingSettings) {
    syncPresetSwatches(pendingSettings.presets || DEFAULTS.presets);
  }
  // Refresh FAB builder preview colors for this theme
  renderFabToolbox();
  renderFabGrid();
  renderFabPreview();
});

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
      setPending(s);
      syncLightColor(pendingSettings.colorLight ?? DEFAULTS.colorLight);
      syncDarkColor(pendingSettings.colorDark ?? DEFAULTS.colorDark);
      if (pendingSettings.showFab !== undefined) showFabToggle.checked = pendingSettings.showFab;
      syncPresetSwatches(pendingSettings.presets || DEFAULTS.presets);
      syncPresetsEditor(pendingSettings.presets || DEFAULTS.presets);
      // Keep FAB builder colors in sync with preset edits
      renderFabToolbox();
      renderFabGrid();
      renderFabPreview();
      if (isLibraryTabActive()) {
        refreshLibrary();
      }
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

let currentLibraryView = 'all';
let currentTagPresetId = null;

function isLibraryTabActive() {
  const panel = document.getElementById('tab-library');
  return !!(panel && panel.classList.contains('active'));
}

/** Re-render Library → Tags when Tag Preset labels/colors change (uses pendingSettings). */
function refreshTagsLibraryIfLive() {
  if (isLibraryTabActive() && currentLibraryView === 'tags') {
    refreshLibrary();
  }
}

function switchSidebarView(tabName, viewName) {
  const panel = document.getElementById('tab-' + tabName);
  if (!panel) return;
  
  if (tabName === 'library') {
    currentLibraryView = viewName;
    if (viewName !== 'tags') {
      currentTagPresetId = null;
    }
    const sidebar = panel.querySelector('.sidebar');
    sidebar.querySelectorAll('.sidebar-item').forEach(item => {
      item.classList.toggle('active', item.dataset.view === viewName);
    });
    refreshLibrary();
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

let pendingSettings = null;

// DOM elements
const colorLightPicker = document.getElementById('colorLight');
const colorLightHex = document.getElementById('colorLightHex');
const colorDarkPicker = document.getElementById('colorDark');
const colorDarkHex = document.getElementById('colorDarkHex');
const fabPresetSwatches = [
  document.getElementById('fabPreset1'),
  document.getElementById('fabPreset2'),
  document.getElementById('fabPreset3'),
  document.getElementById('fabPreset4')
];
const showFabToggle = document.getElementById('showFab');
const previewMarkLight = document.getElementById('previewMarkLight');
const previewMarkDark = document.getElementById('previewMarkDark');
const saveBtn = document.getElementById('saveBtn');
const resetBtn = document.getElementById('resetBtn');
const openShortcuts = document.getElementById('openShortcuts');
const toast = document.getElementById('toast');

const presetRows = [1, 2, 3, 4].map(i => ({
  name: document.getElementById(`presetName${i}`),
  light: document.getElementById(`presetLight${i}`),
  lightHex: document.getElementById(`presetLightHex${i}`),
  dark: document.getElementById(`presetDark${i}`),
  darkHex: document.getElementById(`presetDarkHex${i}`)
}));

const lastChangedSideByRow = [null, null, null, null];

const autoMatchAllLightToDarkBtn = document.getElementById('autoMatchAllLightToDark');
const autoMatchAllDarkToLightBtn = document.getElementById('autoMatchAllDarkToLight');
const autoMatchRowButtons = [1, 2, 3, 4].map(i => document.getElementById(`autoMatchPreset${i}`));

// ============================================
// Settings → FAB builder
// ============================================

const FAB_LAYOUT_KEY = 'fabLayoutV1';
const fabToolboxEl = document.getElementById('fabToolbox');
const fabGridEl = document.getElementById('fabGrid');
const fabPreviewEl = document.getElementById('fabPreview');
const fabRemoveZoneEl = document.getElementById('fabRemoveZone');

const FAB_BUTTON_DEFS = [
  { id: 'preset1', label: 'Preset 1', type: 'preset', presetIndex: 0 },
  { id: 'preset2', label: 'Preset 2', type: 'preset', presetIndex: 1 },
  { id: 'preset3', label: 'Preset 3', type: 'preset', presetIndex: 2 },
  { id: 'preset4', label: 'Preset 4', type: 'preset', presetIndex: 3 },
  { id: 'favorite', label: 'Favorite', type: 'placeholder', glyph: '★' },
  { id: 'comment', label: 'Comment', type: 'placeholder', glyph: '💬' },
  { id: 'copyLink', label: 'Copy link', type: 'placeholder', glyph: '⧉' },
  { id: 'share', label: 'Share', type: 'placeholder', glyph: '↗' }
];

let fabLayoutState = null;

function defaultFabLayout() {
  return { rows: 2, cols: 4, slots: ['preset1', 'preset2', 'preset3', 'preset4', null, null, null, null] };
}

function normalizeFabLayout(raw) {
  const base = defaultFabLayout();
  if (!raw || typeof raw !== 'object') return base;
  const rows = raw.rows === 2 ? 2 : 2;
  const cols = raw.cols === 4 ? 4 : 4;
  const expected = rows * cols;
  const slots = Array.isArray(raw.slots) ? raw.slots.slice(0, expected) : [];
  while (slots.length < expected) slots.push(null);

  // Only keep known button IDs; everything else becomes null.
  const allowed = new Set(FAB_BUTTON_DEFS.map(d => d.id));
  for (let i = 0; i < slots.length; i++) {
    if (slots[i] == null) continue;
    if (!allowed.has(slots[i])) slots[i] = null;
  }
  return { rows, cols, slots };
}

function getFabButtonDef(id) {
  return FAB_BUTTON_DEFS.find(d => d.id === id) || null;
}

function getPresetColorsForIndex(idx) {
  const isDark = document.body.classList.contains('dark');
  const presets = pendingSettings && Array.isArray(pendingSettings.presets)
    ? normalizePresets(pendingSettings.presets)
    : DEFAULTS.presets;
  const p = presets[idx] || presets[0] || {};
  return {
    light: p.colorLight || DEFAULTS.colorLight,
    dark: p.colorDark || DEFAULTS.colorDark,
    current: isDark ? (p.colorDark || DEFAULTS.colorDark) : (p.colorLight || DEFAULTS.colorLight)
  };
}

function showFabPreviewToast(message) {
  showToast(message);
}

function persistFabLayout() {
  if (!fabLayoutState) return;
  chrome.storage.local.set({ [FAB_LAYOUT_KEY]: fabLayoutState });
}

function renderFabToolbox() {
  if (!fabToolboxEl) return;
  fabToolboxEl.innerHTML = '';
  FAB_BUTTON_DEFS.forEach(def => {
    const chip = document.createElement('div');
    chip.className = 'fab-toolbox-item';
    chip.draggable = true;
    chip.dataset.fabButtonId = def.id;

    const swatch = document.createElement('span');
    swatch.className = 'fab-toolbox-swatch';
    if (def.type === 'preset') {
      swatch.style.backgroundColor = getPresetColorsForIndex(def.presetIndex).current;
    } else {
      swatch.style.backgroundColor = 'transparent';
      swatch.style.borderStyle = 'solid';
    }

    const label = document.createElement('span');
    label.textContent = def.label;

    chip.appendChild(swatch);
    chip.appendChild(label);

    chip.addEventListener('dragstart', (e) => {
      e.dataTransfer.effectAllowed = 'copyMove';
      e.dataTransfer.setData('text/plain', JSON.stringify({ kind: 'toolbox', id: def.id }));
    });

    fabToolboxEl.appendChild(chip);
  });
}

function renderFabGrid() {
  if (!fabGridEl || !fabLayoutState) return;
  fabGridEl.innerHTML = '';
  fabGridEl.style.gridTemplateColumns = `repeat(${fabLayoutState.cols}, minmax(0, 1fr))`;

  fabLayoutState.slots.forEach((slotId, idx) => {
    const slot = document.createElement('div');
    slot.className = 'fab-slot';
    slot.dataset.slotIndex = String(idx);

    const setOver = (on) => slot.classList.toggle('is-over', on);

    slot.addEventListener('dragover', (e) => {
      e.preventDefault();
      setOver(true);
      e.dataTransfer.dropEffect = 'move';
    });
    slot.addEventListener('dragleave', () => setOver(false));
    slot.addEventListener('drop', (e) => {
      e.preventDefault();
      setOver(false);
      handleFabDropToSlot(idx, e);
    });

    if (slotId) {
      const def = getFabButtonDef(slotId);
      const btn = document.createElement('div');
      btn.className = 'fab-slot-btn';
      btn.draggable = true;
      btn.dataset.fabButtonId = slotId;
      btn.title = def ? def.label : slotId;

      if (def && def.type === 'preset') {
        btn.style.backgroundColor = getPresetColorsForIndex(def.presetIndex).current;
      } else {
        btn.textContent = def && def.glyph ? def.glyph : '⋯';
      }

      btn.addEventListener('dragstart', (ev) => {
        ev.dataTransfer.effectAllowed = 'move';
        ev.dataTransfer.setData('text/plain', JSON.stringify({ kind: 'slot', fromIndex: idx, id: slotId }));
      });

      slot.appendChild(btn);
    } else {
      slot.textContent = 'Empty';
    }

    fabGridEl.appendChild(slot);
  });
}

function renderFabPreview() {
  if (!fabPreviewEl || !fabLayoutState) return;
  fabPreviewEl.innerHTML = '';
  fabPreviewEl.style.gridTemplateColumns = `repeat(${fabLayoutState.cols}, 32px)`;

  fabLayoutState.slots.forEach((slotId) => {
    if (!slotId) {
      const spacer = document.createElement('div');
      spacer.style.width = '32px';
      spacer.style.height = '32px';
      fabPreviewEl.appendChild(spacer);
      return;
    }

    const def = getFabButtonDef(slotId);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'fab-preview-btn';
    btn.title = def ? def.label : slotId;

    if (def && def.type === 'preset') {
      btn.style.backgroundColor = getPresetColorsForIndex(def.presetIndex).current;
      btn.addEventListener('click', () => showFabPreviewToast(`Preview: ${def.label}`));
    } else {
      btn.textContent = def && def.glyph ? def.glyph : '⋯';
      btn.addEventListener('click', () => showFabPreviewToast(`Preview: ${def ? def.label : 'Action'}`));
    }

    fabPreviewEl.appendChild(btn);
  });
}

function rerenderFabBuilder() {
  if (!fabToolboxEl || !fabGridEl || !fabPreviewEl) return;
  renderFabToolbox();
  renderFabGrid();
  renderFabPreview();
}

function setFabSlot(index, idOrNull) {
  if (!fabLayoutState) return;
  fabLayoutState.slots[index] = idOrNull;
}

function handleFabDropToSlot(targetIndex, e) {
  if (!fabLayoutState) return;
  let payload = null;
  try {
    payload = JSON.parse(e.dataTransfer.getData('text/plain') || 'null');
  } catch {
    payload = null;
  }
  if (!payload || !payload.id) return;
  const id = payload.id;

  if (payload.kind === 'slot' && typeof payload.fromIndex === 'number') {
    const from = payload.fromIndex;
    if (from === targetIndex) return;
    // swap/move
    const tmp = fabLayoutState.slots[targetIndex];
    setFabSlot(targetIndex, id);
    setFabSlot(from, tmp || null);
  } else {
    // toolbox copy into slot (but if it already exists elsewhere, we move it)
    const existingIdx = fabLayoutState.slots.findIndex(x => x === id);
    if (existingIdx !== -1) {
      const tmp = fabLayoutState.slots[targetIndex];
      setFabSlot(targetIndex, id);
      setFabSlot(existingIdx, tmp || null);
    } else {
      setFabSlot(targetIndex, id);
    }
  }

  persistFabLayout();
  rerenderFabBuilder();
}

function initFabRemoveZone() {
  if (!fabRemoveZoneEl) return;
  const setOver = (on) => fabRemoveZoneEl.classList.toggle('is-over', on);

  fabRemoveZoneEl.addEventListener('dragover', (e) => {
    e.preventDefault();
    setOver(true);
    e.dataTransfer.dropEffect = 'move';
  });
  fabRemoveZoneEl.addEventListener('dragleave', () => setOver(false));
  fabRemoveZoneEl.addEventListener('drop', (e) => {
    e.preventDefault();
    setOver(false);
    if (!fabLayoutState) return;
    let payload = null;
    try {
      payload = JSON.parse(e.dataTransfer.getData('text/plain') || 'null');
    } catch {
      payload = null;
    }
    if (!payload || payload.kind !== 'slot' || typeof payload.fromIndex !== 'number') return;
    setFabSlot(payload.fromIndex, null);
    persistFabLayout();
    rerenderFabBuilder();
  });
}

function initFabBuilder() {
  if (!fabToolboxEl || !fabGridEl || !fabPreviewEl) return;
  chrome.storage.local.get(FAB_LAYOUT_KEY, (result) => {
    fabLayoutState = normalizeFabLayout(result && result[FAB_LAYOUT_KEY]);
    // Persist defaults if missing
    if (!result || !result[FAB_LAYOUT_KEY]) {
      persistFabLayout();
    }
    rerenderFabBuilder();
  });
  initFabRemoveZone();
}

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

// Sync FAB preset swatches for the current theme
function syncPresetSwatches(presets) {
  if (!Array.isArray(presets) || presets.length === 0) return;
  const isDark = document.body.classList.contains('dark');
  fabPresetSwatches.forEach((swatch, index) => {
    if (!swatch) return;
    const preset = presets[index] || presets[0];
    const color = isDark ? (preset.colorDark || DEFAULTS.colorDark) : (preset.colorLight || DEFAULTS.colorLight);
    swatch.value = color;
  });
}

function cloneDefaults() {
  return {
    ...DEFAULTS,
    presets: DEFAULTS.presets.map(p => ({ ...p }))
  };
}

function normalizePresets(presets) {
  const base = DEFAULTS.presets.map(p => ({ ...p }));
  if (!Array.isArray(presets)) return base;
  return base.map((def, idx) => {
    const p = presets[idx] || {};
    return {
      ...def,
      ...p
    };
  });
}

function setPending(next) {
  const source = next || {};
  pendingSettings = {
    ...cloneDefaults(),
    ...source,
    presets: normalizePresets(source.presets)
  };
}

function syncPresetsEditor(presets) {
  const norm = normalizePresets(presets);
  presetRows.forEach((row, idx) => {
    const p = norm[idx] || norm[0];
    if (row.name) row.name.value = (p.name || '').toString();
    if (row.light) row.light.value = p.colorLight || DEFAULTS.colorLight;
    if (row.lightHex) row.lightHex.value = (p.colorLight || DEFAULTS.colorLight).toUpperCase();
    if (row.dark) row.dark.value = p.colorDark || DEFAULTS.colorDark;
    if (row.darkHex) row.darkHex.value = (p.colorDark || DEFAULTS.colorDark).toUpperCase();
  });
}

// Hex <-> HSL for cross-derivation (h 0-360, s/l 0-100)
function hexToHSL(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) / 255;
  const g = ((n >> 8) & 0xff) / 255;
  const b = (n & 0xff) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h, s;
  const l = (max + min) / 2;
  if (max === min) {
    h = 0;
    s = 0;
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (r >= g && r >= b) {
      h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    } else if (g >= b) {
      h = ((b - r) / d + 2) / 6;
    } else {
      h = ((r - g) / d + 4) / 6;
    }
  }
  return { h: h * 360, s: s * 100, l: l * 100 };
}

function hslToHex(h, s, l) {
  h = h / 360;
  s = s / 100;
  l = l / 100;
  let r, g, b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  const toHex = x => {
    const n = Math.round(Math.max(0, Math.min(1, x)) * 255);
    return n.toString(16).padStart(2, '0');
  };
  return '#' + toHex(r) + toHex(g) + toHex(b);
}

function deriveDarkFromLight(hex) {
  const { h } = hexToHSL(hex);
  return hslToHex(h, 45, 48);
}

function deriveLightFromDark(hex) {
  const { h } = hexToHSL(hex);
  return hslToHex(h, 52, 85);
}

function autoMatchRowLightToDark(index) {
  if (!pendingSettings) return;
  const row = presetRows[index];
  if (!row || !row.light || !row.dark || !row.darkHex) return;
  const light = row.light.value;
  if (!isValidHex(light)) return;
  const dark = deriveDarkFromLight(light);
  row.dark.value = dark;
  row.darkHex.value = dark.toUpperCase();
  const presets = normalizePresets(pendingSettings.presets);
  const p = presets[index] || presets[0];
  p.colorDark = dark;
  pendingSettings.presets = presets;
  syncPresetSwatches(pendingSettings.presets);
  refreshTagsLibraryIfLive();
}

function autoMatchRowDarkToLight(index) {
  if (!pendingSettings) return;
  const row = presetRows[index];
  if (!row || !row.light || !row.lightHex || !row.dark) return;
  const dark = row.dark.value;
  if (!isValidHex(dark)) return;
  const light = deriveLightFromDark(dark);
  row.light.value = light;
  row.lightHex.value = light.toUpperCase();
  const presets = normalizePresets(pendingSettings.presets);
  const p = presets[index] || presets[0];
  p.colorLight = light;
  pendingSettings.presets = presets;
  syncPresetSwatches(pendingSettings.presets);
  refreshTagsLibraryIfLive();
}

function autoMatchRow(index) {
  if (lastChangedSideByRow[index] === 'dark') {
    autoMatchRowDarkToLight(index);
  } else {
    autoMatchRowLightToDark(index);
  }
}

// Validate hex color input
function isValidHex(str) {
  return /^#[0-9A-Fa-f]{6}$/.test(str);
}

// ---- Event listeners for color inputs ----
let skipCrossUpdate = false;

colorLightPicker.addEventListener('input', (e) => {
  if (skipCrossUpdate) { skipCrossUpdate = false; return; }
  const hex = e.target.value;
  syncLightColor(hex);
  skipCrossUpdate = true;
  syncDarkColor(deriveDarkFromLight(hex));
  setTimeout(() => { skipCrossUpdate = false; }, 0);
  if (pendingSettings) {
    pendingSettings.colorLight = colorLightPicker.value;
    pendingSettings.colorDark = colorDarkPicker.value;
  }
});

colorLightHex.addEventListener('input', (e) => {
  if (skipCrossUpdate) { skipCrossUpdate = false; return; }
  let val = e.target.value;
  if (!val.startsWith('#')) val = '#' + val;
  if (isValidHex(val)) {
    syncLightColor(val);
    skipCrossUpdate = true;
    syncDarkColor(deriveDarkFromLight(val));
    setTimeout(() => { skipCrossUpdate = false; }, 0);
    if (pendingSettings) {
      pendingSettings.colorLight = colorLightPicker.value;
      pendingSettings.colorDark = colorDarkPicker.value;
    }
  }
});

colorLightHex.addEventListener('blur', (e) => {
  let val = e.target.value;
  if (!val.startsWith('#')) val = '#' + val;
  if (!isValidHex(val)) {
    syncLightColor(colorLightPicker.value);
    skipCrossUpdate = true;
    syncDarkColor(deriveDarkFromLight(colorLightPicker.value));
    setTimeout(() => { skipCrossUpdate = false; }, 0);
    if (pendingSettings) {
      pendingSettings.colorLight = colorLightPicker.value;
      pendingSettings.colorDark = colorDarkPicker.value;
    }
  }
});

colorDarkPicker.addEventListener('input', (e) => {
  if (skipCrossUpdate) { skipCrossUpdate = false; return; }
  const hex = e.target.value;
  syncDarkColor(hex);
  skipCrossUpdate = true;
  syncLightColor(deriveLightFromDark(hex));
  setTimeout(() => { skipCrossUpdate = false; }, 0);
  if (pendingSettings) {
    pendingSettings.colorLight = colorLightPicker.value;
    pendingSettings.colorDark = colorDarkPicker.value;
  }
});

colorDarkHex.addEventListener('input', (e) => {
  if (skipCrossUpdate) { skipCrossUpdate = false; return; }
  let val = e.target.value;
  if (!val.startsWith('#')) val = '#' + val;
  if (isValidHex(val)) {
    syncDarkColor(val);
    skipCrossUpdate = true;
    syncLightColor(deriveLightFromDark(val));
    setTimeout(() => { skipCrossUpdate = false; }, 0);
    if (pendingSettings) {
      pendingSettings.colorLight = colorLightPicker.value;
      pendingSettings.colorDark = colorDarkPicker.value;
    }
  }
});

colorDarkHex.addEventListener('blur', (e) => {
  let val = e.target.value;
  if (!val.startsWith('#')) val = '#' + val;
  if (!isValidHex(val)) {
    syncDarkColor(colorDarkPicker.value);
    skipCrossUpdate = true;
    syncLightColor(deriveLightFromDark(colorDarkPicker.value));
    setTimeout(() => { skipCrossUpdate = false; }, 0);
    if (pendingSettings) {
      pendingSettings.colorLight = colorLightPicker.value;
      pendingSettings.colorDark = colorDarkPicker.value;
    }
  }
});

// ---- FAB preset swatch handlers ----

fabPresetSwatches.forEach((swatch, index) => {
  if (!swatch) return;
  swatch.addEventListener('input', (e) => {
    const newColor = e.target.value;
    if (!pendingSettings) return;
    const presets = normalizePresets(pendingSettings.presets);
    const preset = presets[index] || presets[0];
    const isDark = document.body.classList.contains('dark');
    if (isDark) preset.colorDark = newColor;
    else preset.colorLight = newColor;
    pendingSettings.presets = presets;
    syncPresetsEditor(pendingSettings.presets);
    refreshTagsLibraryIfLive();
  });
});

// ---- Tag Presets editor handlers ----

presetRows.forEach((row, index) => {
  if (!row.name || !row.light || !row.dark || !row.lightHex || !row.darkHex) return;

  row.name.addEventListener('input', (e) => {
    if (!pendingSettings) return;
    const presets = normalizePresets(pendingSettings.presets);
    const p = presets[index] || presets[0];
    p.name = (e.target.value || '').toString();
    pendingSettings.presets = presets;
    syncPresetSwatches(pendingSettings.presets);
    refreshTagsLibraryIfLive();
  });

  row.light.addEventListener('input', (e) => {
    if (!pendingSettings) return;
    const hex = e.target.value;
    lastChangedSideByRow[index] = 'light';
    row.lightHex.value = hex.toUpperCase();
    const presets = normalizePresets(pendingSettings.presets);
    const p = presets[index] || presets[0];
    p.colorLight = hex;
    pendingSettings.presets = presets;
    syncPresetSwatches(pendingSettings.presets);
    refreshTagsLibraryIfLive();
  });

  row.dark.addEventListener('input', (e) => {
    if (!pendingSettings) return;
    const hex = e.target.value;
    lastChangedSideByRow[index] = 'dark';
    row.darkHex.value = hex.toUpperCase();
    const presets = normalizePresets(pendingSettings.presets);
    const p = presets[index] || presets[0];
    p.colorDark = hex;
    pendingSettings.presets = presets;
    syncPresetSwatches(pendingSettings.presets);
    refreshTagsLibraryIfLive();
  });

  row.lightHex.addEventListener('input', (e) => {
    if (!pendingSettings) return;
    let val = e.target.value || '';
    if (!val.startsWith('#')) val = '#' + val;
    if (!isValidHex(val)) return;
    lastChangedSideByRow[index] = 'light';
    row.light.value = val;
    const presets = normalizePresets(pendingSettings.presets);
    const p = presets[index] || presets[0];
    p.colorLight = val;
    pendingSettings.presets = presets;
    syncPresetSwatches(pendingSettings.presets);
    refreshTagsLibraryIfLive();
  });

  row.darkHex.addEventListener('input', (e) => {
    if (!pendingSettings) return;
    let val = e.target.value || '';
    if (!val.startsWith('#')) val = '#' + val;
    if (!isValidHex(val)) return;
    lastChangedSideByRow[index] = 'dark';
    row.dark.value = val;
    const presets = normalizePresets(pendingSettings.presets);
    const p = presets[index] || presets[0];
    p.colorDark = val;
    pendingSettings.presets = presets;
    syncPresetSwatches(pendingSettings.presets);
    refreshTagsLibraryIfLive();
  });

  row.lightHex.addEventListener('blur', () => {
    if (!isValidHex(row.lightHex.value)) {
      row.lightHex.value = row.light.value.toUpperCase();
    }
  });

  row.darkHex.addEventListener('blur', () => {
    if (!isValidHex(row.darkHex.value)) {
      row.darkHex.value = row.dark.value.toUpperCase();
    }
  });
});

autoMatchRowButtons.forEach((btn, index) => {
  if (!btn) return;
  btn.addEventListener('click', () => {
    autoMatchRow(index);
  });
});

if (autoMatchAllLightToDarkBtn) {
  autoMatchAllLightToDarkBtn.addEventListener('click', () => {
    for (let i = 0; i < presetRows.length; i++) {
      autoMatchRowLightToDark(i);
    }
  });
}

if (autoMatchAllDarkToLightBtn) {
  autoMatchAllDarkToLightBtn.addEventListener('click', () => {
    for (let i = 0; i < presetRows.length; i++) {
      autoMatchRowDarkToLight(i);
    }
  });
}

// ---- Save / Load / Reset ----

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2000);
}

function saveSettings() {
  if (!pendingSettings) return;
  chrome.storage.local.set({ highlightSettings: pendingSettings }, () => {
    showToast('Settings saved');
  });
}

function loadSettings() {
  chrome.storage.local.get('highlightSettings', (result) => {
    const s = result.highlightSettings || DEFAULTS;

    setPending(s);
    syncLightColor(pendingSettings.colorLight || DEFAULTS.colorLight);
    syncDarkColor(pendingSettings.colorDark || DEFAULTS.colorDark);
    showFabToggle.checked = pendingSettings.showFab !== undefined ? pendingSettings.showFab : DEFAULTS.showFab;
    syncPresetSwatches(pendingSettings.presets || DEFAULTS.presets);
    syncPresetsEditor(pendingSettings.presets || DEFAULTS.presets);

    // Init FAB builder once settings are ready (so preset colors are available)
    initFabBuilder();
  });
}

function resetSettings() {
  syncLightColor(DEFAULTS.colorLight);
  syncDarkColor(DEFAULTS.colorDark);
  showFabToggle.checked = DEFAULTS.showFab;
  setPending(DEFAULTS);
  syncPresetSwatches(pendingSettings.presets || DEFAULTS.presets);
  syncPresetsEditor(pendingSettings.presets || DEFAULTS.presets);

  chrome.storage.local.set({ highlightSettings: DEFAULTS }, () => {
    showToast('Reset to defaults');
  });
}

// ---- Button handlers ----

saveBtn.addEventListener('click', saveSettings);
resetBtn.addEventListener('click', resetSettings);

showFabToggle.addEventListener('change', () => {
  if (!pendingSettings) return;
  pendingSettings.showFab = showFabToggle.checked;
});

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
const librarySearchInput = document.getElementById('librarySearch');

let libraryQuery = '';
let librarySearchDebounce = null;

const RECENTLY_DELETED_KEY = 'recentlyDeletedHighlights';

function generateTrashId() {
  return 'tr_' + Date.now() + '_' + Math.random().toString(36).substring(2, 11);
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

function normalizeQuery(q) {
  const clean = collapseWhitespace((q || '').toString().toLowerCase());
  if (!clean) return [];
  return clean.split(' ').filter(Boolean);
}

function matchesTokens(haystack, tokens) {
  if (!tokens || tokens.length === 0) return true;
  const h = (haystack || '').toString().toLowerCase();
  return tokens.every(t => h.includes(t));
}

function pageMatchesQuery(pageTitle, pageUrl, tokens) {
  return matchesTokens(pageTitle || '', tokens) || matchesTokens(pageUrl || '', tokens);
}

function highlightMatchesQuery(hlText, tokens) {
  return matchesTokens(hlText || '', tokens);
}

function filterPagesByQuery(pages, tokens, { includeAllIfPageMatches } = { includeAllIfPageMatches: true }) {
  if (!tokens || tokens.length === 0) {
    return { pages, totalCount: pages.reduce((sum, p) => sum + (p.highlights?.length || 0), 0) };
  }

  const filteredPages = [];
  let totalCount = 0;

  for (const page of pages) {
    const pageMatch = pageMatchesQuery(page.title, page.url, tokens);
    if (pageMatch && includeAllIfPageMatches) {
      filteredPages.push(page);
      totalCount += page.highlights.length;
      continue;
    }

    const filteredHighlights = page.highlights.filter(hl => highlightMatchesQuery(hl.text, tokens));
    if (filteredHighlights.length === 0) continue;

    filteredPages.push({ ...page, highlights: filteredHighlights });
    totalCount += filteredHighlights.length;
  }

  return { pages: filteredPages, totalCount };
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
      const one = { ...items[0] };
      const collapsed = collapseWhitespace((one.parts || []).map(p => (p && p.text) || '').join(' '));
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

function refreshLibrary() {
  if (currentLibraryView === 'recently-deleted') {
    loadRecentlyDeleted();
  } else if (currentLibraryView === 'tags') {
    loadTagsView();
  } else if (currentLibraryView === 'favorites') {
    loadFavoriteHighlights();
  } else {
    loadAllHighlights();
  }
}

if (librarySearchInput) {
  librarySearchInput.addEventListener('input', (e) => {
    libraryQuery = (e.target && e.target.value) ? e.target.value : '';
    if (librarySearchDebounce) clearTimeout(librarySearchDebounce);
    librarySearchDebounce = setTimeout(() => {
      refreshLibrary();
    }, 120);
  });
}

function getHighlightPresetId(hl) {
  if (hl && typeof hl.presetId === 'string' && hl.presetId.trim() !== '') return hl.presetId;
  // Back-compat: highlights created before presetId existed
  return 'preset1';
}

function loadTagsView() {
  if (currentTagPresetId) {
    loadTagHighlights(currentTagPresetId);
  } else {
    loadTagFolders();
  }
}

/** Tag folder titles/colors follow staged Tag Presets (pendingSettings), not only storage. */
function getTagPresetDefinitions(storageHighlightSettings) {
  if (pendingSettings && Array.isArray(pendingSettings.presets)) {
    return normalizePresets(pendingSettings.presets);
  }
  const s = storageHighlightSettings || DEFAULTS;
  return normalizePresets(s.presets);
}

function loadTagFolders() {
  chrome.storage.local.get(null, (all) => {
    const settings = all.highlightSettings || DEFAULTS;
    const presets = getTagPresetDefinitions(settings);
    const storageFixups = {};
    const tokens = normalizeQuery(libraryQuery);

    const counts = {};
    let total = 0;
    const tagHasMatch = {};

    for (const storageKey of Object.keys(all)) {
      if (!storageKey.startsWith('highlights_')) continue;
      const raw = all[storageKey];
      if (!Array.isArray(raw) || raw.length === 0) continue;

      const normalized = normalizeStoredHighlights(raw);
      const highlights = normalized.highlights;
      if (!Array.isArray(highlights) || highlights.length === 0) continue;
      if (normalized.changed) {
        storageFixups[storageKey] = highlights;
      }

      const url = storageKey.substring('highlights_'.length);
      const meta = (all.highlightIndex && all.highlightIndex[url]) || {};
      const pageTitle = meta.title || url;
      const pageMatch = tokens.length > 0 ? pageMatchesQuery(pageTitle, url, tokens) : false;

      for (const hl of highlights) {
        const pid = getHighlightPresetId(hl);
        const hlMatch = tokens.length > 0 ? highlightMatchesQuery(hl.text, tokens) : true;
        const isMatch = tokens.length === 0 ? true : (pageMatch || hlMatch);
        if (!isMatch) continue;

        counts[pid] = (counts[pid] || 0) + 1;
        total++;
        tagHasMatch[pid] = true;
      }
    }

    if (Object.keys(storageFixups).length > 0) {
      chrome.storage.local.set(storageFixups);
    }

    highlightCount.textContent = total > 0 ? `${total} saved` : '';
    if (tokens.length > 0 && total === 0) {
      highlightCount.textContent = '';
      highlightsContainer.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-title">No results</div>
          Try a different keyword.
        </div>
      `;
      return;
    }

    const filteredPresets = tokens.length === 0
      ? presets
      : presets.filter(p => matchesTokens(p.name || '', tokens) || tagHasMatch[p.id]);

    renderTagFolders(filteredPresets, counts);
  });
}

function renderTagFolders(presets, counts) {
  highlightsContainer.innerHTML = '';

  const wrap = document.createElement('div');
  wrap.className = 'tag-folders';

  presets.slice(0, 4).forEach(p => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tag-folder';
    btn.addEventListener('click', () => {
      currentTagPresetId = p.id;
      loadTagsView();
    });

    const dot = document.createElement('span');
    dot.className = 'tag-dot';
    const isDark = document.body.classList.contains('dark');
    dot.style.backgroundColor = isDark ? (p.colorDark || DEFAULTS.colorDark) : (p.colorLight || DEFAULTS.colorLight);

    const name = document.createElement('span');
    name.className = 'tag-name';
    name.textContent = p.name || 'Untitled';

    const count = document.createElement('span');
    count.className = 'tag-count';
    count.textContent = (counts[p.id] || 0).toString();

    btn.appendChild(dot);
    btn.appendChild(name);
    btn.appendChild(count);
    wrap.appendChild(btn);
  });

  highlightsContainer.appendChild(wrap);
}

function loadTagHighlights(presetId) {
  chrome.storage.local.get(null, (all) => {
    const settings = all.highlightSettings || DEFAULTS;
    const presets = getTagPresetDefinitions(settings);
    const preset = presets.find(p => p.id === presetId) || presets[0];
    const storageFixups = {};
    const tokens = normalizeQuery(libraryQuery);

    const index = all.highlightIndex || {};
    const pages = [];
    let totalCount = 0;

    for (const storageKey of Object.keys(all)) {
      if (!storageKey.startsWith('highlights_')) continue;

      const url = storageKey.substring('highlights_'.length);
      const raw = all[storageKey];
      if (!Array.isArray(raw) || raw.length === 0) continue;

      const normalized = normalizeStoredHighlights(raw);
      const highlights = normalized.highlights;
      if (!Array.isArray(highlights) || highlights.length === 0) continue;
      if (normalized.changed) {
        storageFixups[storageKey] = highlights;
      }

      const inTag = highlights.filter(h => getHighlightPresetId(h) === presetId);
      if (inTag.length === 0) continue;

      const meta = index[url] || {};
      const pageTitle = meta.title || url;
      const pageMatch = tokens.length > 0 ? pageMatchesQuery(pageTitle, url, tokens) : false;
      const filtered = tokens.length === 0
        ? inTag
        : (pageMatch ? inTag : inTag.filter(h => highlightMatchesQuery(h.text, tokens)));
      if (filtered.length === 0) continue;

      totalCount += filtered.length;
      pages.push({
        url,
        title: pageTitle,
        lastUpdated: meta.lastUpdated || Date.now(),
        highlights: filtered.slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
      });
    }

    if (pages.length === 0) {
      highlightCount.textContent = '';
      highlightsContainer.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-title">${tokens.length > 0 ? 'No results' : `No highlights in ${preset.name || 'this tag'}`}</div>
          ${tokens.length > 0 ? 'Try a different keyword.' : 'Highlights you create with this preset will appear here.'}
        </div>
      `;
      const toolbar = createTagsToolbar(preset);
      highlightsContainer.prepend(toolbar);
      return;
    }

    if (Object.keys(storageFixups).length > 0) {
      chrome.storage.local.set(storageFixups);
    }

    pages.sort((a, b) => (b.lastUpdated || 0) - (a.lastUpdated || 0));
    renderHighlights(pages, totalCount, { countLabel: 'saved' });
    highlightsContainer.prepend(createTagsToolbar(preset));
  });
}

function createTagsToolbar(preset) {
  const toolbar = document.createElement('div');
  toolbar.className = 'tags-toolbar';

  const backBtn = document.createElement('button');
  backBtn.type = 'button';
  backBtn.className = 'page-clear-btn';
  backBtn.textContent = 'Back';
  backBtn.addEventListener('click', () => {
    currentTagPresetId = null;
    loadTagsView();
  });

  const title = document.createElement('div');
  title.className = 'tags-toolbar-title';
  title.textContent = `Tags / ${preset && preset.name ? preset.name : 'Tag'}`;

  toolbar.appendChild(backBtn);
  toolbar.appendChild(title);
  return toolbar;
}

// Load all highlights from storage and render them
function loadAllHighlights() {
  chrome.storage.local.get(null, (all) => {
    const index = all.highlightIndex || {};
    const indexNeedsUpdate = {};
    const storageFixups = {};

    // Scan ALL keys for highlights_* data — don't rely only on the index
    const pages = [];
    let totalCount = 0;

    for (const storageKey of Object.keys(all)) {
      if (!storageKey.startsWith('highlights_')) continue;

      const url = storageKey.substring('highlights_'.length);
      const raw = all[storageKey];
      if (!Array.isArray(raw) || raw.length === 0) continue;

      const normalized = normalizeStoredHighlights(raw);
      const highlights = normalized.highlights;
      if (!Array.isArray(highlights) || highlights.length === 0) continue;
      if (normalized.changed) {
        storageFixups[storageKey] = highlights;
      }

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

    if (Object.keys(storageFixups).length > 0) {
      chrome.storage.local.set(storageFixups);
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

    const tokens = normalizeQuery(libraryQuery);
    const filtered = filterPagesByQuery(pages, tokens, { includeAllIfPageMatches: true });
    if (tokens.length > 0 && filtered.pages.length === 0) {
      highlightCount.textContent = '';
      highlightsContainer.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-title">No results</div>
          Try a different keyword.
        </div>
      `;
      return;
    }

    renderHighlights(filtered.pages, filtered.totalCount, { countLabel: 'saved' });
  });
}

function loadFavoriteHighlights() {
  chrome.storage.local.get(null, (all) => {
    const index = all.highlightIndex || {};
    const pages = [];
    let totalCount = 0;
    const storageFixups = {};

    for (const storageKey of Object.keys(all)) {
      if (!storageKey.startsWith('highlights_')) continue;

      const url = storageKey.substring('highlights_'.length);
      const raw = all[storageKey];
      if (!Array.isArray(raw) || raw.length === 0) continue;

      const normalized = normalizeStoredHighlights(raw);
      const highlights = normalized.highlights;
      if (!Array.isArray(highlights) || highlights.length === 0) continue;
      if (normalized.changed) {
        storageFixups[storageKey] = highlights;
      }

      const favs = highlights.filter(h => h && h.favorited === true);
      if (favs.length === 0) continue;

      const meta = index[url] || {};
      totalCount += favs.length;
      pages.push({
        url,
        title: meta.title || url,
        lastUpdated: meta.lastUpdated || Date.now(),
        highlights: favs.slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
      });
    }

    if (Object.keys(storageFixups).length > 0) {
      chrome.storage.local.set(storageFixups);
    }

    const tokens = normalizeQuery(libraryQuery);
    const filtered = filterPagesByQuery(pages, tokens, { includeAllIfPageMatches: true });

    if (filtered.pages.length === 0) {
      if (tokens.length > 0) {
        highlightCount.textContent = '';
        highlightsContainer.innerHTML = `
          <div class="empty-state">
            <div class="empty-state-title">No results</div>
            Try a different keyword.
          </div>
        `;
        return;
      }
      renderEmptyFavorites();
      return;
    }

    filtered.pages.sort((a, b) => (b.lastUpdated || 0) - (a.lastUpdated || 0));
    renderHighlights(filtered.pages, filtered.totalCount, { countLabel: 'favorited' });
  });
}

function renderEmptyFavorites() {
  highlightCount.textContent = '';
  highlightsContainer.innerHTML = `
    <div class="empty-state">
      <div class="empty-state-title">No favorites yet</div>
      Star highlights from the All view to see them here.
    </div>
  `;
}

function loadRecentlyDeleted() {
  chrome.storage.local.get(RECENTLY_DELETED_KEY, (result) => {
    const trash = Array.isArray(result[RECENTLY_DELETED_KEY]) ? result[RECENTLY_DELETED_KEY] : [];
    const tokens = normalizeQuery(libraryQuery);
    const filteredTrash = tokens.length === 0
      ? trash
      : trash.filter(entry => {
          const hlText = entry && entry.highlight ? entry.highlight.text : '';
          return matchesTokens(hlText, tokens)
            || matchesTokens(entry.pageTitle || '', tokens)
            || matchesTokens(entry.pageUrl || '', tokens);
        });

    const sorted = filteredTrash.slice().sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0));

    if (sorted.length === 0) {
      if (tokens.length > 0) {
        highlightCount.textContent = '';
        highlightsContainer.innerHTML = `
          <div class="empty-state">
            <div class="empty-state-title">No results</div>
            Try a different keyword.
          </div>
        `;
      } else {
        renderEmptyTrash();
      }
      return;
    }

    const byUrl = new Map();
    for (const entry of sorted) {
      const url = entry.pageUrl;
      if (!byUrl.has(url)) {
        byUrl.set(url, {
          url,
          title: entry.pageTitle || url,
          entries: []
        });
      }
      byUrl.get(url).entries.push(entry);
    }

    const pages = Array.from(byUrl.values()).sort((a, b) => {
      const maxA = Math.max(...a.entries.map(e => e.deletedAt || 0));
      const maxB = Math.max(...b.entries.map(e => e.deletedAt || 0));
      return maxB - maxA;
    });

    renderRecentlyDeleted(pages, sorted.length);
  });
}

function renderEmptyTrash() {
  highlightCount.textContent = '';
  highlightsContainer.innerHTML = `
    <div class="empty-state">
      <div class="empty-state-title">Nothing in Recently Deleted</div>
      Deleted highlights will appear here. You can restore them or remove them forever.
    </div>
  `;
}

function renderRecentlyDeleted(pages, totalTrashCount) {
  highlightCount.textContent = totalTrashCount + ' deleted';

  const toolbar = document.createElement('div');
  toolbar.className = 'page-header trash-toolbar';
  toolbar.style.marginBottom = '16px';
  const emptyTrashBtn = document.createElement('button');
  emptyTrashBtn.type = 'button';
  emptyTrashBtn.className = 'page-clear-btn';
  emptyTrashBtn.textContent = 'Empty Recently Deleted';
  emptyTrashBtn.addEventListener('click', emptyRecentlyDeleted);
  toolbar.appendChild(emptyTrashBtn);
  highlightsContainer.innerHTML = '';
  highlightsContainer.appendChild(toolbar);

  pages.forEach(page => {
    const group = document.createElement('div');
    group.className = 'page-group';

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
    header.appendChild(info);
    group.appendChild(header);

    const list = document.createElement('ul');
    list.className = 'snippet-list';

    page.entries.forEach(entry => {
      const hl = entry.highlight;
      if (!hl) return;

      const item = document.createElement('li');
      item.className = 'snippet-item';

      const text = document.createElement('span');
      text.className = 'snippet-text';
      text.textContent = hl.text || '';

      const colorSlot = document.createElement('span');
      colorSlot.className = 'snippet-color-slot';
      const dot = document.createElement('span');
      dot.className = 'snippet-color-dot';
      if (typeof hl.color === 'string' && hl.color.trim() !== '') {
        dot.style.backgroundColor = hl.color;
        dot.title = hl.color;
        colorSlot.appendChild(dot);
      } else {
        colorSlot.style.display = 'none';
      }

      const trashBtns = document.createElement('div');
      trashBtns.className = 'snippet-trash-actions';

      const restoreBtn = document.createElement('button');
      restoreBtn.type = 'button';
      restoreBtn.className = 'page-clear-btn';
      restoreBtn.textContent = 'Restore';
      restoreBtn.title = 'Restore highlight';
      restoreBtn.addEventListener('click', () => restoreFromTrash(entry.trashId));

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'snippet-delete';
      delBtn.innerHTML = '&#215;';
      delBtn.title = 'Delete forever';
      delBtn.addEventListener('click', () => deleteForeverFromTrash(entry.trashId));

      trashBtns.appendChild(restoreBtn);
      trashBtns.appendChild(delBtn);

      const rowActions = document.createElement('div');
      rowActions.className = 'snippet-item-actions';
      rowActions.appendChild(colorSlot);
      rowActions.appendChild(trashBtns);

      item.appendChild(text);
      item.appendChild(rowActions);
      list.appendChild(item);
    });

    group.appendChild(list);
    highlightsContainer.appendChild(group);
  });
}

function emptyRecentlyDeleted() {
  chrome.storage.local.set({ [RECENTLY_DELETED_KEY]: [] }, () => {
    refreshLibrary();
  });
}

function restoreFromTrash(trashId) {
  chrome.storage.local.get([RECENTLY_DELETED_KEY, 'highlightIndex'], (result) => {
    const trash = Array.isArray(result[RECENTLY_DELETED_KEY]) ? result[RECENTLY_DELETED_KEY] : [];
    const entry = trash.find(t => t.trashId === trashId);
    if (!entry || !entry.highlight) return;

    const key = 'highlights_' + entry.pageUrl;
    chrome.storage.local.get(key, (r2) => {
      let highlights = r2[key] || [];
      const newTrash = trash.filter(t => t.trashId !== trashId);
      if (highlights.some(h => h.id === entry.highlight.id)) {
        chrome.storage.local.set({ [RECENTLY_DELETED_KEY]: newTrash }, refreshLibrary);
        return;
      }
      highlights = highlights.concat([entry.highlight]);
      const index = result.highlightIndex || {};
      index[entry.pageUrl] = {
        title: entry.pageTitle || entry.pageUrl,
        lastUpdated: Date.now()
      };
      chrome.storage.local.set({
        [key]: highlights,
        highlightIndex: index,
        [RECENTLY_DELETED_KEY]: newTrash
      }, refreshLibrary);
    });
  });
}

function deleteForeverFromTrash(trashId) {
  chrome.storage.local.get(RECENTLY_DELETED_KEY, (result) => {
    const trash = Array.isArray(result[RECENTLY_DELETED_KEY]) ? result[RECENTLY_DELETED_KEY] : [];
    const newTrash = trash.filter(t => t.trashId !== trashId);
    chrome.storage.local.set({ [RECENTLY_DELETED_KEY]: newTrash }, refreshLibrary);
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

function createStarButton(pageUrl, hl) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'snippet-star' + (hl.favorited === true ? ' is-favorited' : '');
  const favorited = hl.favorited === true;
  btn.title = favorited ? 'Remove from favorites' : 'Add to favorites';
  btn.setAttribute('aria-label', btn.title);
  btn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>';
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleFavorite(pageUrl, hl.id);
  });
  return btn;
}

function toggleFavorite(url, highlightId) {
  const key = 'highlights_' + url;
  chrome.storage.local.get(key, (result) => {
    const highlights = result[key] || [];
    let changed = false;
    const next = highlights.map(h => {
      if (h.id !== highlightId) return h;
      changed = true;
      const copy = { ...h };
      if (copy.favorited === true) {
        delete copy.favorited;
      } else {
        copy.favorited = true;
      }
      return copy;
    });
    if (!changed) return;
    chrome.storage.local.set({ [key]: next }, refreshLibrary);
  });
}

// Render all page groups
function renderHighlights(pages, totalCount, options = {}) {
  const countWord = options.countLabel === 'favorited' ? 'favorited' : 'saved';
  highlightCount.textContent = totalCount + ' ' + countWord;
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

      const colorSlot = document.createElement('span');
      colorSlot.className = 'snippet-color-slot';
      const dot = document.createElement('span');
      dot.className = 'snippet-color-dot';
      if (typeof hl.color === 'string' && hl.color.trim() !== '') {
        dot.style.backgroundColor = hl.color;
        dot.title = hl.color;
        colorSlot.appendChild(dot);
      } else {
        colorSlot.style.display = 'none';
      }

      const star = createStarButton(page.url, hl);

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'snippet-delete';
      del.innerHTML = '&#215;';
      del.title = 'Delete highlight';
      del.addEventListener('click', () => deleteHighlight(page.url, hl.id));

      const rowActions = document.createElement('div');
      rowActions.className = 'snippet-item-actions';
      rowActions.appendChild(colorSlot);
      rowActions.appendChild(star);
      rowActions.appendChild(del);

      item.appendChild(text);
      item.appendChild(rowActions);
      list.appendChild(item);
    });

    group.appendChild(list);
    highlightsContainer.appendChild(group);
  });
}

// Delete a single highlight by ID (soft-delete into Recently Deleted)
function deleteHighlight(url, highlightId) {
  const key = 'highlights_' + url;

  chrome.storage.local.get([key, 'highlightIndex', RECENTLY_DELETED_KEY], (result) => {
    let highlights = result[key] || [];
    const removed = highlights.find(h => h.id === highlightId);
    if (!removed) {
      refreshLibrary();
      return;
    }

    const index = result.highlightIndex || {};
    const pageTitle = (index[url] && index[url].title) || url;
    const trash = Array.isArray(result[RECENTLY_DELETED_KEY]) ? result[RECENTLY_DELETED_KEY] : [];
    trash.unshift({
      trashId: generateTrashId(),
      pageUrl: url,
      pageTitle,
      deletedAt: Date.now(),
      highlight: { ...removed }
    });

    highlights = highlights.filter(h => h.id !== highlightId);

    if (highlights.length > 0) {
      chrome.storage.local.set({ [key]: highlights, [RECENTLY_DELETED_KEY]: trash }, refreshLibrary);
    } else {
      delete index[url];
      chrome.storage.local.remove(key, () => {
        chrome.storage.local.set({ highlightIndex: index, [RECENTLY_DELETED_KEY]: trash }, refreshLibrary);
      });
    }
  });
}

// Delete all highlights for a page (soft-delete into Recently Deleted)
function deletePageHighlights(url) {
  const key = 'highlights_' + url;

  chrome.storage.local.get([key, 'highlightIndex', RECENTLY_DELETED_KEY], (result) => {
    const highlights = result[key] || [];
    if (highlights.length === 0) {
      refreshLibrary();
      return;
    }

    const index = result.highlightIndex || {};
    const pageTitle = (index[url] && index[url].title) || url;
    const trash = Array.isArray(result[RECENTLY_DELETED_KEY]) ? result[RECENTLY_DELETED_KEY] : [];
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

    delete index[url];
    chrome.storage.local.remove(key, () => {
      chrome.storage.local.set({ highlightIndex: index, [RECENTLY_DELETED_KEY]: trash }, refreshLibrary);
    });
  });
}

function isLibraryTabActive() {
  const panel = document.getElementById('tab-library');
  return panel && panel.classList.contains('active');
}

// Live-update when highlights or trash change from another tab
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;

  const hasHighlightChange = Object.keys(changes).some(
    k => k === 'highlightIndex' || k.startsWith('highlights_')
  );
  const hasTrashChange = Object.prototype.hasOwnProperty.call(changes, RECENTLY_DELETED_KEY);

  if ((hasHighlightChange || hasTrashChange) && isLibraryTabActive()) {
    refreshLibrary();
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
initSidebarNavigation();
loadSidebarCollapsedState();
initSidebarCollapseToggle();
initSearchCollapsedBtn();

// Initialize sidebar state for active tab on load
const activeTab = document.querySelector('.tab-btn.active');
if (activeTab) {
  resetSidebarForTab(activeTab.dataset.tab);
}
refreshLibrary();
