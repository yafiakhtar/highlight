// ---- Theme (sync with popup via popupTheme) ----
chrome.storage.local.get('popupTheme', (data) => {
  if (data.popupTheme === 'dark') {
    document.body.classList.add('dark');
  } else {
    document.body.classList.remove('dark');
  }
  rerenderFabBuilder();
});

document.getElementById('optionsThemeToggle').addEventListener('click', () => {
  document.body.classList.toggle('dark');
  const isDark = document.body.classList.contains('dark');
  chrome.storage.local.set({ popupTheme: isDark ? 'dark' : 'light' });
  if (pendingSettings) {
    syncAppearanceFromPresets(pendingSettings.presets || DEFAULTS.presets);
  }
  // Refresh every FAB builder surface for this theme.
  rerenderFabBuilder();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  const hasFabLayoutChange = Object.prototype.hasOwnProperty.call(changes, FAB_LAYOUT_KEY);
  if (changes.popupTheme) {
    const theme = changes.popupTheme.newValue;
    if (theme === 'dark') {
      document.body.classList.add('dark');
    } else {
      document.body.classList.remove('dark');
    }
    rerenderFabBuilder();
    if (isLibraryTabActive()) refreshLibrary();
  }
  if (changes.highlightSettings) {
    const s = changes.highlightSettings.newValue;
    if (s) {
      const settingsSignature = getHighlightSettingsSignature(s);
      if (selfPersistedSettingsSignatures.has(settingsSignature)) {
        selfPersistedSettingsSignatures.delete(settingsSignature);
        reconcileCurrentFabLayout(!hasFabLayoutChange);
        syncAppearanceFromPresets(pendingSettings?.presets || s.presets);
        rerenderFabBuilder();
        if (isLibraryTabActive()) refreshLibrary();
        return;
      }
      setPending(s);
      syncLightColor(pendingSettings.colorLight ?? DEFAULTS.colorLight);
      syncDarkColor(pendingSettings.colorDark ?? DEFAULTS.colorDark);
      if (pendingSettings.showFab !== undefined) showFabToggle.checked = pendingSettings.showFab;
      syncAppearanceFromPresets(pendingSettings.presets || DEFAULTS.presets);
      syncPresetsEditor(pendingSettings.presets || DEFAULTS.presets);
      repairDefaultPresetMirrorsIfNeeded(s);
      // Keep FAB builder colors in sync with preset edits
      reconcileCurrentFabLayout(!hasFabLayoutChange);
      rerenderFabBuilder();
      if (isLibraryTabActive()) {
        refreshLibrary();
      }
    }
  }
  if (hasFabLayoutChange) {
    const next = changes[FAB_LAYOUT_KEY] && changes[FAB_LAYOUT_KEY].newValue;
    const reconciled = reconcileFabLayout(next);
    fabLayoutState = reconciled.layout;
    if (reconciled.changed) persistFabLayout();
    rerenderFabBuilder();
  }
});

// ---- Main tabs and Settings section navigation ----

const SETTINGS_SECTION_VIEW_ORDER = [
  'appearance',
  'presets-tags',
  'fab',
  'shortcuts',
  'data',
  'sync'
];

let settingsScrollPosition = 0;
let settingsHasStoredScrollPosition = false;
let currentSettingsSection = 'appearance';
let settingsScrollFrame = null;

function isSettingsTabActive() {
  const panel = document.getElementById('tab-settings');
  return !!(panel && panel.classList.contains('active'));
}

function getSettingsSection(viewName) {
  return document.querySelector(`#tab-settings .settings-view[data-view="${viewName}"]`);
}

function setActiveSettingsSidebarItem(viewName) {
  const sidebar = document.getElementById('sidebar-settings');
  if (!sidebar || !SETTINGS_SECTION_VIEW_ORDER.includes(viewName)) return;
  currentSettingsSection = viewName;
  sidebar.querySelectorAll('.sidebar-item').forEach(item => {
    const isActive = item.dataset.view === viewName;
    item.classList.toggle('active', isActive);
    if (isActive) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  });
}

function updateSettingsScrollSpy() {
  settingsScrollFrame = null;
  if (!isSettingsTabActive()) return;

  const sections = SETTINGS_SECTION_VIEW_ORDER
    .map(viewName => ({ viewName, element: getSettingsSection(viewName) }))
    .filter(item => item.element);
  if (sections.length === 0) return;

  const readingLine = Math.min(180, window.innerHeight * 0.25);
  let activeViewName = sections[0].viewName;
  sections.forEach(item => {
    if (item.element.getBoundingClientRect().top <= readingLine) {
      activeViewName = item.viewName;
    }
  });

  const documentBottom = document.documentElement.scrollHeight;
  if (Math.ceil(window.scrollY + window.innerHeight) >= documentBottom - 2) {
    activeViewName = sections[sections.length - 1].viewName;
  }
  if (activeViewName !== currentSettingsSection) {
    setActiveSettingsSidebarItem(activeViewName);
  }
}

function scheduleSettingsScrollSpy() {
  if (settingsScrollFrame !== null) return;
  settingsScrollFrame = requestAnimationFrame(updateSettingsScrollSpy);
}

function scrollToSettingsSection(viewName, { focusHeading = false } = {}) {
  const section = getSettingsSection(viewName);
  if (!section) return;
  closeFabPopover();
  setActiveSettingsSidebarItem(viewName);
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  section.scrollIntoView({
    behavior: reduceMotion ? 'auto' : 'smooth',
    block: 'start'
  });
  if (focusHeading) {
    const heading = section.querySelector('h2');
    requestAnimationFrame(() => heading?.focus({ preventScroll: true }));
  }
}

function captureSettingsScrollPosition() {
  if (!isSettingsTabActive()) return;
  settingsScrollPosition = window.scrollY;
  settingsHasStoredScrollPosition = true;
}

function restoreSettingsScrollPosition() {
  const targetPosition = settingsHasStoredScrollPosition ? settingsScrollPosition : 0;
  requestAnimationFrame(() => {
    const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    window.scrollTo({ top: Math.min(targetPosition, maxScroll), behavior: 'auto' });
    scheduleSettingsScrollSpy();
  });
}

function activateMainTab(tabName) {
  const tabBtn = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
  const panel = document.getElementById('tab-' + tabName);
  if (!tabBtn || !panel) return;

  const currentTab = document.querySelector('.tab-btn.active')?.dataset.tab;
  closeFabPopover();
  if (currentTab === tabName) {
    if (tabName === 'settings') scheduleSettingsScrollSpy();
    else resetSidebarForTab(tabName);
    return;
  }
  if (currentTab === 'settings') captureSettingsScrollPosition();

  document.querySelectorAll('.tab-btn').forEach(button => button.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(tabPanel => tabPanel.classList.remove('active'));
  tabBtn.classList.add('active');
  panel.classList.add('active');

  if (tabName === 'settings') restoreSettingsScrollPosition();
  else resetSidebarForTab(tabName);
}

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => activateMainTab(btn.dataset.tab));
});

window.addEventListener('scroll', () => {
  if (!isSettingsTabActive()) return;
  settingsScrollPosition = window.scrollY;
  settingsHasStoredScrollPosition = true;
  scheduleSettingsScrollSpy();
}, { passive: true });

window.addEventListener('resize', () => {
  if (isSettingsTabActive()) scheduleSettingsScrollSpy();
});

// ---- Sidebar Navigation ----

function resetSidebarForTab(tabName) {
  const panel = document.getElementById('tab-' + tabName);
  if (!panel) return;
  if (tabName === 'settings') {
    scheduleSettingsScrollSpy();
    return;
  }

  const sidebar = panel.querySelector('.sidebar');
  if (!sidebar) return;

  sidebar.querySelectorAll('.sidebar-item').forEach(item => {
    item.classList.remove('active');
    item.removeAttribute('aria-current');
  });

  const firstItem = sidebar.querySelector('.sidebar-item');
  if (firstItem) {
    firstItem.classList.add('active');
    firstItem.setAttribute('aria-current', 'page');
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
      const isActive = item.dataset.view === viewName;
      item.classList.toggle('active', isActive);
      if (isActive) item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
    });
    refreshLibrary();
  } else if (tabName === 'settings') {
    scrollToSettingsSection(viewName);
  }
}

// Initialize sidebar navigation handlers
function initSidebarNavigation() {
  document.querySelectorAll('.sidebar-item').forEach(item => {
    item.addEventListener('click', () => {
      closeFabPopover();
      const panel = item.closest('.tab-panel');
      if (!panel) return;
      
      const tabName = panel.id.replace('tab-', '');
      switchSidebarView(tabName, item.dataset.view);
    });
  });
}

// ---- URL parameter handling ----
function switchToTab(tabName) {
  activateMainTab(tabName);
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
const appearanceSaveStatusEl = document.getElementById('appearanceSaveStatus');
const appearancePresetSummaryEl = document.getElementById('appearancePresetSummary');
const defaultPresetNameLightEl = document.getElementById('defaultPresetNameLight');
const defaultPresetNameDarkEl = document.getElementById('defaultPresetNameDark');
const manageTagPresetsBtn = document.getElementById('manageTagPresets');
let selectedAppearancePreviewPresetId = 'preset1';
const showFabToggle = document.getElementById('showFab');
const previewMarkLight = document.getElementById('previewMarkLight');
const previewMarkDark = document.getElementById('previewMarkDark');
const resetBtn = document.getElementById('resetBtn');
const resetConfirmDialog = document.getElementById('resetConfirmDialog');
const cancelResetBtn = document.getElementById('cancelResetBtn');
const confirmResetBtn = document.getElementById('confirmResetBtn');
const openShortcuts = document.getElementById('openShortcuts');
const shortcutDisplay = document.getElementById('shortcutDisplay');
const toast = document.getElementById('toast');

const presetsEditorRowsEl = document.getElementById('presetsEditorRows');
const addTagPresetBtn = document.getElementById('addTagPreset');
const deleteTagPresetBtn = document.getElementById('deleteTagPreset');
let presetRows = [];
let presetDeleteMode = false;
const lastChangedSideByPreset = new Map();

const autoMatchAllLightToDarkBtn = document.getElementById('autoMatchAllLightToDark');
const autoMatchAllDarkToLightBtn = document.getElementById('autoMatchAllDarkToLight');

// ============================================
// Settings → FAB builder
// ============================================

const FAB_LAYOUT_KEY = 'fabLayoutV1';
const fabBuilderEl = document.getElementById('fabBuilder');
const fabToolboxEl = document.getElementById('fabToolbox');
const fabGridEl = document.getElementById('fabGrid');
const fabPreviewEl = document.getElementById('fabPreview');
const fabRemoveZoneEl = document.getElementById('fabRemoveZone');
const fabPopoverLayerEl = document.getElementById('fabPopoverLayer');

const FAB_ACTION_DEFS = [
  { id: 'favorite', label: 'Favorite', type: 'placeholder', glyph: '⋯', paletteGlyph: '☆' },
  { id: 'comment', label: 'Comment', type: 'placeholder', glyph: '⋯', paletteGlyph: '✎' },
  { id: 'copyLink', label: 'Copy link', type: 'placeholder', glyph: '⋯', paletteGlyph: '⧉' },
  { id: 'share', label: 'Share', type: 'placeholder', glyph: '⋯', paletteGlyph: '↗' }
];

let fabLayoutState = null;
let draggedFabToolboxItem = null;
let draggedFabSlotButton = null;
let activeFabSlotIndex = null;
let currentFabPopover = null;
let currentFabPopoverAnchor = null;
let fabPopoverCleanupTimer = null;
let fabPopoverListenersInitialized = false;
let pendingFabAnimatedSlotIndexes = new Set();

function defaultFabLayout() {
  return { rows: 2, cols: 4, slots: ['preset1', 'preset2', 'preset3', 'preset4', null, null, null, null] };
}

function getFabButtonDefs() {
  const presets = pendingSettings && Array.isArray(pendingSettings.presets)
    ? normalizePresets(pendingSettings.presets)
    : DEFAULTS.presets;
  const presetDefs = presets.map((preset, presetIndex) => ({
    id: preset.id,
    label: preset.name || `Tag ${presetIndex + 1}`,
    type: 'preset',
    presetIndex
  }));
  return [...presetDefs, ...FAB_ACTION_DEFS];
}

function reconcileFabLayout(raw) {
  const base = defaultFabLayout();
  const expected = base.rows * base.cols;
  const rawSlots = raw && Array.isArray(raw.slots) ? raw.slots.slice(0, expected) : [];
  while (rawSlots.length < expected) rawSlots.push(null);

  const allowed = new Set(getFabButtonDefs().map(d => d.id));
  const presentValidIds = new Set(rawSlots.filter(id => typeof id === 'string' && allowed.has(id)));
  const slots = rawSlots.map((slotId, index) => {
    if (slotId == null) return null;
    if (typeof slotId === 'string' && allowed.has(slotId)) return slotId;

    // Repair a stale built-in slot only when its canonical preset is missing
    // everywhere else. Other unknown IDs are safer as empty slots.
    const expectedPresetId = index < 4 ? `preset${index + 1}` : null;
    if (expectedPresetId && allowed.has(expectedPresetId) && !presentValidIds.has(expectedPresetId)) {
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

function reconcileCurrentFabLayout(shouldPersist = false) {
  if (!fabLayoutState) return false;
  const reconciled = reconcileFabLayout(fabLayoutState);
  fabLayoutState = reconciled.layout;
  if (shouldPersist && reconciled.changed) {
    persistFabLayout();
  }
  return reconciled.changed;
}

function getFabButtonDef(id) {
  return getFabButtonDefs().find(d => d.id === id) || null;
}

function getPresetColorsForId(presetId) {
  const isDark = document.body.classList.contains('dark');
  const presets = pendingSettings && Array.isArray(pendingSettings.presets)
    ? normalizePresets(pendingSettings.presets)
    : DEFAULTS.presets;
  const p = presets.find(preset => preset.id === presetId) || presets[0] || {};
  return {
    light: p.colorLight || DEFAULTS.colorLight,
    dark: p.colorDark || DEFAULTS.colorDark,
    current: isDark ? (p.colorDark || DEFAULTS.colorDark) : (p.colorLight || DEFAULTS.colorLight)
  };
}

function persistFabLayout() {
  if (!fabLayoutState) return;
  chrome.storage.local.set({ [FAB_LAYOUT_KEY]: fabLayoutState });
}

function prefersReducedFabMotion() {
  return typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function syncActiveFabSlot() {
  if (!fabGridEl) return;
  Array.from(fabGridEl.children).forEach((slot, index) => {
    slot.classList.toggle('is-active', index === activeFabSlotIndex);
  });
}

function closeFabPopover({ immediate = false, restoreFocus = false } = {}) {
  if (fabPopoverCleanupTimer) {
    clearTimeout(fabPopoverCleanupTimer);
    fabPopoverCleanupTimer = null;
  }

  const popover = currentFabPopover;
  const anchor = currentFabPopoverAnchor;
  currentFabPopover = null;
  currentFabPopoverAnchor = null;
  activeFabSlotIndex = null;
  syncActiveFabSlot();

  if (anchor) anchor.setAttribute('aria-expanded', 'false');
  if (restoreFocus && anchor && typeof anchor.focus === 'function' && anchor.isConnected) {
    anchor.focus({ preventScroll: true });
  }

  if (!popover) {
    if (immediate && fabPopoverLayerEl) fabPopoverLayerEl.innerHTML = '';
    return;
  }

  const removePopover = () => {
    if (popover.parentNode) popover.parentNode.removeChild(popover);
  };

  if (immediate || prefersReducedFabMotion()) {
    removePopover();
    return;
  }

  popover.classList.remove('is-open');
  popover.classList.add('is-closing');
  popover.setAttribute('aria-hidden', 'true');
  popover.addEventListener('transitionend', removePopover, { once: true });
  fabPopoverCleanupTimer = setTimeout(removePopover, 220);
}

function positionFabPopover(popover, anchor) {
  const viewportPadding = 12;
  const anchorGap = 8;
  const anchorRect = anchor.getBoundingClientRect();
  const popoverWidth = popover.offsetWidth || 238;
  const popoverHeight = popover.offsetHeight || 260;
  const maxLeft = Math.max(viewportPadding, window.innerWidth - popoverWidth - viewportPadding);
  const left = Math.min(Math.max(anchorRect.right - popoverWidth, viewportPadding), maxLeft);
  const belowTop = anchorRect.bottom + anchorGap;
  const aboveTop = anchorRect.top - popoverHeight - anchorGap;
  const shouldOpenUp = belowTop + popoverHeight > window.innerHeight - viewportPadding
    && aboveTop >= viewportPadding;
  const maxTop = Math.max(viewportPadding, window.innerHeight - popoverHeight - viewportPadding);
  const top = shouldOpenUp ? aboveTop : Math.min(Math.max(belowTop, viewportPadding), maxTop);

  popover.style.left = `${Math.round(left)}px`;
  popover.style.top = `${Math.round(top)}px`;
  popover.classList.toggle('opens-up', shouldOpenUp);
}

function createFabPopoverOption({ label, icon, color, danger = false, onSelect }) {
  const option = document.createElement('button');
  option.type = 'button';
  option.className = 'fab-popover-option';
  if (danger) option.classList.add('is-danger');

  const visual = document.createElement('span');
  visual.className = 'fab-popover-option-icon';
  if (color) visual.style.backgroundColor = color;
  else visual.textContent = icon || '';

  const text = document.createElement('span');
  text.className = 'fab-popover-option-label';
  text.textContent = label;

  option.appendChild(visual);
  option.appendChild(text);
  option.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    onSelect();
  });
  return option;
}

function createFabPickerGroup(title, defs, badgeText = '') {
  const group = document.createElement('div');
  group.className = 'fab-popover-group';

  const heading = document.createElement('div');
  heading.className = 'fab-popover-group-title';
  const headingText = document.createElement('span');
  headingText.textContent = title;
  heading.appendChild(headingText);

  if (badgeText) {
    const badge = document.createElement('span');
    badge.textContent = badgeText;
    heading.appendChild(badge);
  }

  group.appendChild(heading);
  defs.forEach(def => {
    group.appendChild(createFabPopoverOption({
      label: def.label,
      icon: def.paletteGlyph || def.glyph,
      color: def.type === 'preset' ? getPresetColorsForId(def.id).current : '',
      onSelect: () => placeFabItemInSlot(activeFabSlotIndex, def.id)
    }));
  });
  return group;
}

function mountFabPopover(popover, anchor, slotIndex) {
  if (!fabPopoverLayerEl || !anchor) return;
  closeFabPopover({ immediate: true });
  fabPopoverLayerEl.innerHTML = '';
  fabPopoverLayerEl.appendChild(popover);
  currentFabPopover = popover;
  currentFabPopoverAnchor = anchor;
  activeFabSlotIndex = slotIndex;
  syncActiveFabSlot();
  anchor.setAttribute('aria-expanded', 'true');
  positionFabPopover(popover, anchor);

  requestAnimationFrame(() => {
    if (currentFabPopover !== popover) return;
    popover.classList.add('is-open');
    const firstOption = popover.querySelector('.fab-popover-option');
    if (firstOption) firstOption.focus({ preventScroll: true });
  });
}

function openFabPicker(slotIndex, anchor) {
  if (!fabLayoutState || slotIndex < 0 || slotIndex >= fabLayoutState.slots.length) return;
  if (currentFabPopoverAnchor === anchor && currentFabPopover?.classList.contains('fab-picker-popover')) {
    closeFabPopover();
    return;
  }
  const popover = document.createElement('div');
  popover.className = 'fab-popover fab-picker-popover';
  popover.setAttribute('role', 'dialog');
  popover.setAttribute('aria-label', `${fabLayoutState.slots[slotIndex] ? 'Replace' : 'Add to'} Slot ${slotIndex + 1}`);

  const title = document.createElement('div');
  title.className = 'fab-popover-title';
  title.textContent = `${fabLayoutState.slots[slotIndex] ? 'Replace' : 'Add to'} Slot ${slotIndex + 1}`;
  popover.appendChild(title);

  const defs = getFabButtonDefs();
  popover.appendChild(createFabPickerGroup(
    'Tag presets',
    defs.filter(def => def.type === 'preset')
  ));
  popover.appendChild(createFabPickerGroup(
    'Actions',
    defs.filter(def => def.type !== 'preset'),
    'Coming soon'
  ));

  mountFabPopover(popover, anchor, slotIndex);
}

function openFabSlotMenu(slotIndex, anchor) {
  if (!fabLayoutState || !fabLayoutState.slots[slotIndex]) return;
  if (currentFabPopoverAnchor === anchor && currentFabPopover?.classList.contains('fab-slot-menu')) {
    closeFabPopover();
    return;
  }
  const popover = document.createElement('div');
  popover.className = 'fab-popover fab-slot-menu';
  popover.setAttribute('role', 'menu');
  popover.setAttribute('aria-label', `Slot ${slotIndex + 1} options`);

  const replaceOption = createFabPopoverOption({
    label: 'Replace…',
    icon: '↻',
    onSelect: () => openFabPicker(slotIndex, anchor.closest('.fab-slot') || anchor)
  });
  replaceOption.setAttribute('role', 'menuitem');
  popover.appendChild(replaceOption);

  const removeOption = createFabPopoverOption({
    label: 'Remove',
    icon: '×',
    danger: true,
    onSelect: () => clearFabSlot(slotIndex)
  });
  removeOption.setAttribute('role', 'menuitem');
  popover.appendChild(removeOption);

  mountFabPopover(popover, anchor, slotIndex);
}

function initFabPopoverInteractions() {
  if (fabPopoverListenersInitialized) return;
  fabPopoverListenersInitialized = true;

  document.addEventListener('pointerdown', (event) => {
    if (!currentFabPopover) return;
    if (currentFabPopover.contains(event.target)) return;
    if (currentFabPopoverAnchor && currentFabPopoverAnchor.contains(event.target)) return;
    closeFabPopover();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && currentFabPopover) {
      event.preventDefault();
      closeFabPopover({ restoreFocus: true });
    }
  });
  window.addEventListener('resize', () => closeFabPopover());
  window.addEventListener('scroll', (event) => {
    if (currentFabPopover && !currentFabPopover.contains(event.target)) {
      closeFabPopover();
    }
  }, true);
}

function setFabDragMode(mode) {
  if (!fabBuilderEl) return;
  if (mode) closeFabPopover({ immediate: true });
  const isSlotDrag = mode === 'slot';
  fabBuilderEl.classList.toggle('is-dragging-slot', isSlotDrag);
  fabBuilderEl.classList.toggle('is-dragging-toolbox', mode === 'toolbox');
  if (fabRemoveZoneEl) {
    fabRemoveZoneEl.setAttribute('aria-hidden', isSlotDrag ? 'false' : 'true');
    if (!isSlotDrag) fabRemoveZoneEl.classList.remove('is-over');
  }
}

function endFabDrag() {
  if (draggedFabToolboxItem) {
    draggedFabToolboxItem.classList.remove('is-dragging');
    draggedFabToolboxItem = null;
  }
  if (draggedFabSlotButton) {
    draggedFabSlotButton.classList.remove('is-dragging');
    draggedFabSlotButton = null;
  }
  setFabDragMode(null);
}

function createFabToolboxGroup(title, defs, badgeText = '') {
  const group = document.createElement('section');
  group.className = 'fab-toolbox-group';

  const header = document.createElement('div');
  header.className = 'fab-toolbox-group-header';

  const heading = document.createElement('h4');
  heading.className = 'fab-toolbox-group-title';
  heading.textContent = title;
  header.appendChild(heading);

  if (badgeText) {
    const badge = document.createElement('span');
    badge.className = 'fab-toolbox-badge';
    badge.textContent = badgeText;
    header.appendChild(badge);
  }

  const list = document.createElement('div');
  list.className = 'fab-toolbox-list';

  defs.forEach(def => {
    const item = document.createElement('div');
    item.className = 'fab-toolbox-item';
    item.draggable = true;
    item.tabIndex = 0;
    item.dataset.fabButtonId = def.id;
    item.setAttribute('role', 'button');
    item.setAttribute('aria-label', `Drag ${def.label} into the FAB layout`);

    const swatch = document.createElement('span');
    swatch.className = 'fab-toolbox-swatch';
    if (def.type === 'preset') {
      swatch.style.backgroundColor = getPresetColorsForId(def.id).current;
    } else {
      swatch.textContent = def.paletteGlyph || def.glyph || '⋯';
    }

    const label = document.createElement('span');
    label.className = 'fab-toolbox-label';
    label.textContent = def.label;

    const grip = document.createElement('span');
    grip.className = 'fab-toolbox-grip';
    grip.textContent = '⠿';
    grip.setAttribute('aria-hidden', 'true');

    item.appendChild(swatch);
    item.appendChild(label);
    item.appendChild(grip);

    item.addEventListener('dragstart', (e) => {
      draggedFabToolboxItem = item;
      item.classList.add('is-dragging');
      setFabDragMode('toolbox');
      e.dataTransfer.effectAllowed = 'copyMove';
      e.dataTransfer.setData('text/plain', JSON.stringify({ kind: 'toolbox', id: def.id }));
    });
    item.addEventListener('dragend', endFabDrag);

    list.appendChild(item);
  });

  group.appendChild(header);
  group.appendChild(list);
  return group;
}

function renderFabToolbox() {
  if (!fabToolboxEl) return;
  fabToolboxEl.innerHTML = '';
  const defs = getFabButtonDefs();
  fabToolboxEl.appendChild(createFabToolboxGroup(
    'Tag presets',
    defs.filter(def => def.type === 'preset')
  ));
  fabToolboxEl.appendChild(createFabToolboxGroup(
    'Actions',
    defs.filter(def => def.type !== 'preset'),
    'Coming soon'
  ));
}

function appendFabEmptySlotControl(slot, slotIndex) {
  const empty = document.createElement('button');
  empty.type = 'button';
  empty.className = 'fab-slot-empty';
  empty.setAttribute('aria-haspopup', 'dialog');
  empty.setAttribute('aria-expanded', 'false');
  empty.setAttribute('aria-label', `Add action to FAB position ${slotIndex + 1}`);

  const mark = document.createElement('span');
  mark.className = 'fab-slot-empty-mark';
  mark.textContent = '+';
  mark.setAttribute('aria-hidden', 'true');

  const label = document.createElement('span');
  label.textContent = 'Add action';

  empty.appendChild(mark);
  empty.appendChild(label);
  empty.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    openFabPicker(slotIndex, empty);
  });
  slot.appendChild(empty);
}

function renderFabGrid() {
  if (!fabGridEl || !fabLayoutState) return;
  fabGridEl.innerHTML = '';
  fabGridEl.style.gridTemplateColumns = `repeat(${fabLayoutState.cols}, minmax(0, 1fr))`;

  fabLayoutState.slots.forEach((slotId, idx) => {
    const slot = document.createElement('div');
    slot.className = 'fab-slot';
    if (pendingFabAnimatedSlotIndexes.has(idx)) slot.classList.add('is-changing');
    slot.dataset.slotIndex = String(idx);
    slot.setAttribute('aria-label', `FAB position ${idx + 1}`);

    const indexLabel = document.createElement('span');
    indexLabel.className = 'fab-slot-index';
    indexLabel.textContent = String(idx + 1).padStart(2, '0');
    slot.appendChild(indexLabel);

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
      if (!def) {
        appendFabEmptySlotControl(slot, idx);
        fabGridEl.appendChild(slot);
        return;
      }
      slot.classList.add('has-item');
      const btn = document.createElement('div');
      btn.className = 'fab-slot-btn';
      btn.draggable = true;
      btn.tabIndex = 0;
      btn.dataset.fabButtonId = slotId;
      btn.title = def.label;
      btn.setAttribute('role', 'button');
      btn.setAttribute('aria-label', `${def.label}, position ${idx + 1}. Drag to reorder or remove.`);

      const visual = document.createElement('span');
      visual.className = 'fab-slot-visual';
      if (def.type === 'preset') {
        visual.style.backgroundColor = getPresetColorsForId(def.id).current;
      } else {
        visual.textContent = def.glyph || '⋯';
      }

      const label = document.createElement('span');
      label.className = 'fab-slot-label';
      label.textContent = def.label;

      const menuBtn = document.createElement('button');
      menuBtn.type = 'button';
      menuBtn.className = 'fab-slot-menu-btn';
      menuBtn.draggable = false;
      menuBtn.textContent = '⋮';
      menuBtn.title = `${def.label} options`;
      menuBtn.setAttribute('aria-label', `${def.label} options`);
      menuBtn.setAttribute('aria-haspopup', 'menu');
      menuBtn.setAttribute('aria-expanded', 'false');
      menuBtn.addEventListener('pointerdown', event => event.stopPropagation());
      menuBtn.addEventListener('mousedown', event => event.stopPropagation());
      menuBtn.addEventListener('dragstart', event => {
        event.preventDefault();
        event.stopPropagation();
      });
      menuBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        openFabSlotMenu(idx, menuBtn);
      });

      btn.appendChild(visual);
      btn.appendChild(label);
      btn.appendChild(menuBtn);

      btn.addEventListener('dragstart', (ev) => {
        draggedFabSlotButton = btn;
        btn.classList.add('is-dragging');
        setFabDragMode('slot');
        ev.dataTransfer.effectAllowed = 'move';
        ev.dataTransfer.setData('text/plain', JSON.stringify({ kind: 'slot', fromIndex: idx, id: slotId }));
      });
      btn.addEventListener('dragend', endFabDrag);

      slot.appendChild(btn);
    } else {
      appendFabEmptySlotControl(slot, idx);
    }

    fabGridEl.appendChild(slot);
  });
  syncActiveFabSlot();

  const animatedIndexes = [...pendingFabAnimatedSlotIndexes];
  pendingFabAnimatedSlotIndexes.clear();
  if (animatedIndexes.length > 0) {
    requestAnimationFrame(() => {
      animatedIndexes.forEach(index => {
        const slot = fabGridEl.children[index];
        if (slot) slot.classList.remove('is-changing');
      });
    });
  }
}

function renderFabPreview() {
  if (!fabPreviewEl || !fabLayoutState) return;
  fabPreviewEl.innerHTML = '';
  fabPreviewEl.style.gridTemplateColumns = `repeat(${fabLayoutState.cols}, 32px)`;

  const secondRowStart = fabLayoutState.cols;
  const hasSecondRow = fabLayoutState.slots
    .slice(secondRowStart, secondRowStart * 2)
    .some(Boolean);
  const visibleSlots = fabLayoutState.slots.slice(
    0,
    hasSecondRow ? secondRowStart * 2 : secondRowStart
  );

  visibleSlots.forEach((slotId) => {
    const def = slotId ? getFabButtonDef(slotId) : null;

    if (!def) {
      const spacer = document.createElement('div');
      spacer.className = 'fab-preview-spacer';
      spacer.setAttribute('aria-hidden', 'true');
      fabPreviewEl.appendChild(spacer);
      return;
    }

    const btn = document.createElement('span');
    btn.className = 'fab-preview-btn';
    btn.title = def.label;
    btn.setAttribute('role', 'img');
    btn.setAttribute('aria-label', def.label);

    if (def.type === 'preset') {
      btn.style.backgroundColor = getPresetColorsForId(def.id).current;
    } else {
      btn.textContent = def.glyph || '⋯';
    }

    fabPreviewEl.appendChild(btn);
  });
}

function rerenderFabBuilder() {
  if (!fabToolboxEl || !fabGridEl || !fabPreviewEl) return;
  closeFabPopover();
  renderFabToolbox();
  renderFabGrid();
  renderFabPreview();
}

function setFabSlot(index, idOrNull) {
  if (!fabLayoutState) return;
  fabLayoutState.slots[index] = idOrNull;
}

function commitFabLayoutChange() {
  persistFabLayout();
  rerenderFabBuilder();
}

function markFabSlotsForAnimation(...indexes) {
  if (prefersReducedFabMotion()) return;
  if (fabBuilderEl && (
    fabBuilderEl.classList.contains('is-dragging-slot')
    || fabBuilderEl.classList.contains('is-dragging-toolbox')
  )) return;
  indexes.filter(Number.isInteger).forEach(index => pendingFabAnimatedSlotIndexes.add(index));
}

function placeFabItemInSlot(targetIndex, id) {
  if (!fabLayoutState || !Number.isInteger(targetIndex)) return false;
  if (targetIndex < 0 || targetIndex >= fabLayoutState.slots.length) return false;
  if (!getFabButtonDef(id)) return false;

  const existingIndex = fabLayoutState.slots.findIndex(slotId => slotId === id);
  if (existingIndex === targetIndex) {
    closeFabPopover();
    return false;
  }

  const displacedId = fabLayoutState.slots[targetIndex] || null;
  markFabSlotsForAnimation(targetIndex, existingIndex);
  setFabSlot(targetIndex, id);
  if (existingIndex !== -1) setFabSlot(existingIndex, displacedId);
  commitFabLayoutChange();
  return true;
}

function moveFabSlot(fromIndex, targetIndex) {
  if (!fabLayoutState || !Number.isInteger(fromIndex) || !Number.isInteger(targetIndex)) return false;
  if (fromIndex < 0 || targetIndex < 0) return false;
  if (fromIndex >= fabLayoutState.slots.length || targetIndex >= fabLayoutState.slots.length) return false;
  if (fromIndex === targetIndex) return false;

  const sourceId = fabLayoutState.slots[fromIndex];
  if (!sourceId) return false;
  const displacedId = fabLayoutState.slots[targetIndex] || null;
  markFabSlotsForAnimation(fromIndex, targetIndex);
  setFabSlot(targetIndex, sourceId);
  setFabSlot(fromIndex, displacedId);
  commitFabLayoutChange();
  return true;
}

function clearFabSlot(slotIndex) {
  if (!fabLayoutState || !Number.isInteger(slotIndex)) return false;
  if (slotIndex < 0 || slotIndex >= fabLayoutState.slots.length) return false;
  if (!fabLayoutState.slots[slotIndex]) {
    closeFabPopover();
    return false;
  }

  markFabSlotsForAnimation(slotIndex);
  setFabSlot(slotIndex, null);
  commitFabLayoutChange();
  return true;
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
    moveFabSlot(payload.fromIndex, targetIndex);
  } else {
    placeFabItemInSlot(targetIndex, id);
  }

  endFabDrag();
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
    clearFabSlot(payload.fromIndex);
    endFabDrag();
  });
}

function initFabBuilder() {
  if (!fabToolboxEl || !fabGridEl || !fabPreviewEl) return;
  chrome.storage.local.get(FAB_LAYOUT_KEY, (result) => {
    const reconciled = reconcileFabLayout(result && result[FAB_LAYOUT_KEY]);
    fabLayoutState = reconciled.layout;
    if (reconciled.changed) persistFabLayout();
    rerenderFabBuilder();
  });
  initFabRemoveZone();
  initFabPopoverInteractions();
}

// ---- Color sync helpers ----

function syncLightColor(hex) {
  if (!colorLightPicker || !colorLightHex) return;
  colorLightPicker.value = hex;
  colorLightHex.value = hex.toUpperCase();
}

function syncDarkColor(hex) {
  if (!colorDarkPicker || !colorDarkHex) return;
  colorDarkPicker.value = hex;
  colorDarkHex.value = hex.toUpperCase();
}

function getDefaultPreset(presets) {
  const normalized = normalizePresets(presets);
  return normalized.find(preset => preset.id === 'preset1')
    || DEFAULTS.presets.find(preset => preset.id === 'preset1');
}

function getAppearancePreviewPreset(presets) {
  const normalized = normalizePresets(presets);
  const selectedPreset = normalized.find(preset => preset.id === selectedAppearancePreviewPresetId);
  if (selectedPreset) return selectedPreset;

  selectedAppearancePreviewPresetId = 'preset1';
  return getDefaultPreset(normalized);
}

function syncAppearancePreview(presets) {
  const previewPreset = getAppearancePreviewPreset(presets);
  if (!previewPreset) return;

  if (previewMarkLight) {
    previewMarkLight.style.backgroundColor = previewPreset.colorLight;
    previewMarkLight.style.color = '#1a1a1a';
  }
  if (previewMarkDark) {
    previewMarkDark.style.backgroundColor = previewPreset.colorDark;
    previewMarkDark.style.color = '#fff';
  }
  if (defaultPresetNameLightEl) {
    defaultPresetNameLightEl.textContent = previewPreset.name || 'Untitled';
  }
  if (defaultPresetNameDarkEl) {
    defaultPresetNameDarkEl.textContent = previewPreset.name || 'Untitled';
  }
}

function renderAppearancePresetSummary(presets) {
  if (!appearancePresetSummaryEl) return;
  const normalized = normalizePresets(presets);
  getAppearancePreviewPreset(normalized);
  appearancePresetSummaryEl.innerHTML = '';

  normalized.forEach(preset => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'appearance-palette-item';
    item.dataset.presetId = preset.id;
    item.title = `${preset.name}: ${preset.colorLight.toUpperCase()} / ${preset.colorDark.toUpperCase()}`;
    item.setAttribute('aria-label', `Preview ${preset.name || 'Untitled'} colors`);
    item.setAttribute('aria-pressed', String(preset.id === selectedAppearancePreviewPresetId));
    item.addEventListener('click', () => {
      selectedAppearancePreviewPresetId = preset.id;
      syncAppearancePreview(normalized);
      appearancePresetSummaryEl.querySelectorAll('.appearance-palette-item').forEach(button => {
        button.setAttribute('aria-pressed', String(button.dataset.presetId === preset.id));
      });
    });

    const swatch = document.createElement('span');
    swatch.className = 'appearance-palette-swatch';
    swatch.setAttribute('aria-hidden', 'true');

    const lightHalf = document.createElement('span');
    lightHalf.className = 'appearance-palette-half is-light';
    lightHalf.style.backgroundColor = preset.colorLight;
    const darkHalf = document.createElement('span');
    darkHalf.className = 'appearance-palette-half is-dark';
    darkHalf.style.backgroundColor = preset.colorDark;
    swatch.append(lightHalf, darkHalf);

    const name = document.createElement('span');
    name.className = 'appearance-palette-name';
    name.textContent = preset.name || 'Untitled';

    item.append(swatch, name);
    appearancePresetSummaryEl.appendChild(item);
  });
}

function syncAppearanceFromPresets(presets) {
  const normalized = normalizePresets(presets);
  const defaultPreset = getDefaultPreset(normalized);
  if (!defaultPreset) return;

  syncLightColor(defaultPreset.colorLight);
  syncDarkColor(defaultPreset.colorDark);
  syncAppearancePreview(normalized);
  renderAppearancePresetSummary(normalized);
}

function cloneDefaults() {
  return {
    ...DEFAULTS,
    presets: DEFAULTS.presets.map(p => ({ ...p }))
  };
}

function generatePresetId() {
  return 'tag_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
}

function normalizePresets(presets) {
  const base = DEFAULTS.presets.map(p => ({ ...p }));
  const source = Array.isArray(presets) && presets.length > 0 ? presets : base;
  const seen = new Set();
  const normalized = [];

  source.forEach((raw, idx) => {
    if (!raw || typeof raw !== 'object') return;
    const matchingDefault = base.find(def => def.id === raw.id) || base[idx] || base[0];
    let id = typeof raw.id === 'string' && raw.id.trim() !== ''
      ? raw.id.trim()
      : (idx < base.length ? base[idx].id : generatePresetId());
    if (seen.has(id)) id = generatePresetId();
    seen.add(id);
    normalized.push({
      id,
      name: typeof raw.name === 'string' ? raw.name : matchingDefault.name,
      colorLight: isValidHex(raw.colorLight) ? raw.colorLight : matchingDefault.colorLight,
      colorDark: isValidHex(raw.colorDark) ? raw.colorDark : matchingDefault.colorDark
    });
  });

  // preset1 is the permanent default and must never disappear. Other built-in
  // presets may be removed by the user and return only after a full reset.
  const defaultPreset = base.find(def => def.id === 'preset1') || base[0];
  if (!seen.has(defaultPreset.id)) normalized.push({ ...defaultPreset });

  return normalized.length > 0 ? normalized : base;
}

function setPending(next) {
  const source = next || {};
  const presets = normalizePresets(source.presets);
  const defaultPreset = getDefaultPreset(presets);
  pendingSettings = {
    ...cloneDefaults(),
    ...source,
    colorLight: defaultPreset.colorLight,
    colorDark: defaultPreset.colorDark,
    presets
  };
}

let scopedSettingsSaveTimer = null;
let scopedSettingsWriteInFlight = false;
let pendingScopedSettingsPatch = {};
const selfPersistedSettingsSignatures = new Set();
let scopedSettingsBarrierInFlight = false;
const scopedSettingsBarrierQueue = [];

function getHighlightSettingsSignature(settings) {
  const source = settings || {};
  return JSON.stringify({
    colorLight: source.colorLight || '',
    colorDark: source.colorDark || '',
    showFab: source.showFab,
    presets: normalizePresets(source.presets)
  });
}

function setAppearanceSaveStatus(status) {
  if (!appearanceSaveStatusEl) return;
  appearanceSaveStatusEl.classList.toggle('is-saving', status === 'saving');
  if (status === 'saving') appearanceSaveStatusEl.textContent = 'Saving changes…';
  else if (status === 'error') appearanceSaveStatusEl.textContent = 'Could not save';
  else appearanceSaveStatusEl.textContent = 'All changes save automatically';
}

function normalizeScopedSettingsWrite(stored, patch) {
  const next = {
    ...cloneDefaults(),
    ...(stored || {}),
    ...patch
  };
  const presets = normalizePresets(next.presets).map(preset => ({ ...preset }));
  const defaultPreset = getDefaultPreset(presets);
  next.presets = presets;
  next.colorLight = defaultPreset.colorLight;
  next.colorDark = defaultPreset.colorDark;
  return next;
}

function flushScopedSettingsPatch() {
  if (scopedSettingsWriteInFlight || scopedSettingsBarrierInFlight) return;
  if (Object.keys(pendingScopedSettingsPatch).length === 0) return;

  const patch = pendingScopedSettingsPatch;
  pendingScopedSettingsPatch = {};
  scopedSettingsWriteInFlight = true;

  chrome.storage.local.get('highlightSettings', (result) => {
    const next = normalizeScopedSettingsWrite(result.highlightSettings, patch);
    const signature = getHighlightSettingsSignature(next);
    selfPersistedSettingsSignatures.add(signature);
    chrome.storage.local.set({ highlightSettings: next }, () => {
      scopedSettingsWriteInFlight = false;
      const failed = !!(chrome.runtime && chrome.runtime.lastError);
      if (failed) selfPersistedSettingsSignatures.delete(signature);
      setAppearanceSaveStatus(failed ? 'error' : 'saved');
      pumpScopedSettingsWork();
    });
  });
}

function pumpScopedSettingsWork() {
  if (scopedSettingsWriteInFlight || scopedSettingsBarrierInFlight) return;
  if (scopedSettingsBarrierQueue.length > 0) {
    const task = scopedSettingsBarrierQueue.shift();
    scopedSettingsBarrierInFlight = true;
    task(() => {
      scopedSettingsBarrierInFlight = false;
      pumpScopedSettingsWork();
    });
    return;
  }
  flushScopedSettingsPatch();
}

function scheduleScopedSettingsPatch(patch) {
  pendingScopedSettingsPatch = {
    ...pendingScopedSettingsPatch,
    ...patch
  };
  setAppearanceSaveStatus('saving');
  if (scopedSettingsSaveTimer) clearTimeout(scopedSettingsSaveTimer);
  scopedSettingsSaveTimer = setTimeout(() => {
    scopedSettingsSaveTimer = null;
    pumpScopedSettingsWork();
  }, 120);
}

function cancelScopedSettingsAutosave() {
  if (scopedSettingsSaveTimer) {
    clearTimeout(scopedSettingsSaveTimer);
    scopedSettingsSaveTimer = null;
  }
  pendingScopedSettingsPatch = {};
}

function queueScopedSettingsBarrier(task) {
  scopedSettingsBarrierQueue.push(task);
  pumpScopedSettingsWork();
}

function schedulePresetSettingsSave() {
  if (!pendingSettings) return;
  scheduleScopedSettingsPatch({
    presets: normalizePresets(pendingSettings.presets).map(preset => ({ ...preset }))
  });
}

function repairDefaultPresetMirrorsIfNeeded(rawSettings) {
  if (!rawSettings) return;
  const defaultPreset = getDefaultPreset(rawSettings.presets);
  if (
    rawSettings.colorLight === defaultPreset.colorLight
    && rawSettings.colorDark === defaultPreset.colorDark
  ) return;
  scheduleScopedSettingsPatch({
    colorLight: defaultPreset.colorLight,
    colorDark: defaultPreset.colorDark
  });
}

function updatePendingPreset(presetId, update) {
  if (!pendingSettings) return null;
  const presets = normalizePresets(pendingSettings.presets);
  const preset = presets.find(p => p.id === presetId);
  if (!preset) return null;
  update(preset);
  pendingSettings.presets = presets;
  if (presetId === 'preset1') {
    const defaultPreset = getDefaultPreset(presets);
    pendingSettings.colorLight = defaultPreset.colorLight;
    pendingSettings.colorDark = defaultPreset.colorDark;
  }
  syncAppearanceFromPresets(presets);
  rerenderFabBuilder();
  refreshTagsLibraryIfLive();
  schedulePresetSettingsSave();
  return preset;
}

function syncPresetsEditor(presets) {
  const norm = normalizePresets(presets);
  if (!presetsEditorRowsEl) return;

  const hasDeletablePreset = norm.some(preset => preset.id !== 'preset1');
  if (!hasDeletablePreset) presetDeleteMode = false;
  presetsEditorRowsEl.classList.toggle('is-delete-mode', presetDeleteMode);
  if (deleteTagPresetBtn) {
    deleteTagPresetBtn.disabled = !hasDeletablePreset;
    deleteTagPresetBtn.setAttribute('aria-pressed', String(presetDeleteMode));
    const deleteButtonLabel = presetDeleteMode ? 'Finish deleting tags' : 'Delete tags';
    deleteTagPresetBtn.setAttribute('aria-label', deleteButtonLabel);
    deleteTagPresetBtn.title = deleteButtonLabel;
  }

  presetsEditorRowsEl.innerHTML = '';
  presetRows = norm.map((preset, idx) => {
    const grid = document.createElement('div');
    grid.className = 'presets-grid';

    const nameCol = document.createElement('div');
    nameCol.className = 'presets-col presets-col-name';
    const label = document.createElement('span');
    label.className = 'presets-row-label';
    label.textContent = String(idx + 1).padStart(2, '0');
    const name = document.createElement('input');
    name.type = 'text';
    name.className = 'text-input';
    name.maxLength = 32;
    name.placeholder = 'Tag name';
    name.value = preset.name || '';
    name.setAttribute('aria-label', `Tag ${idx + 1} name`);
    nameCol.append(label, name);

    const lightCol = document.createElement('div');
    lightCol.className = 'presets-col presets-col-light';
    const lightControl = document.createElement('div');
    lightControl.className = 'preset-color-control';
    const light = document.createElement('input');
    light.type = 'color';
    light.className = 'color-swatch';
    light.value = preset.colorLight;
    light.title = `Choose the light webpage color for ${preset.name || `Tag ${idx + 1}`}`;
    light.setAttribute('aria-label', `Light webpage color for Tag ${idx + 1}`);
    const lightHex = document.createElement('input');
    lightHex.type = 'text';
    lightHex.className = 'color-hex';
    lightHex.maxLength = 7;
    lightHex.value = preset.colorLight.toUpperCase();
    lightHex.setAttribute('aria-label', `Light webpage hex color for Tag ${idx + 1}`);
    lightControl.append(light, lightHex);
    lightCol.appendChild(lightControl);

    const darkCol = document.createElement('div');
    darkCol.className = 'presets-col presets-col-dark';
    const darkControl = document.createElement('div');
    darkControl.className = 'preset-color-control';
    const dark = document.createElement('input');
    dark.type = 'color';
    dark.className = 'color-swatch';
    dark.value = preset.colorDark;
    dark.title = `Choose the dark webpage color for ${preset.name || `Tag ${idx + 1}`}`;
    dark.setAttribute('aria-label', `Dark webpage color for Tag ${idx + 1}`);
    const darkHex = document.createElement('input');
    darkHex.type = 'text';
    darkHex.className = 'color-hex';
    darkHex.maxLength = 7;
    darkHex.value = preset.colorDark.toUpperCase();
    darkHex.setAttribute('aria-label', `Dark webpage hex color for Tag ${idx + 1}`);
    const autoMatch = document.createElement('button');
    autoMatch.type = 'button';
    autoMatch.className = 'btn btn-small preset-match-btn';
    autoMatch.textContent = 'Match Dark';
    darkControl.append(dark, darkHex);
    darkCol.append(darkControl, autoMatch);

    grid.append(nameCol, lightCol, darkCol);

    if (presetDeleteMode && preset.id !== 'preset1') {
      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'preset-delete-btn';
      deleteButton.textContent = '×';
      deleteButton.title = `Delete ${preset.name || `Tag ${idx + 1}`}`;
      deleteButton.setAttribute('aria-label', `Delete ${preset.name || `Tag ${idx + 1}`}. Highlights using it will use the default tag.`);
      deleteButton.addEventListener('click', () => removeTagPreset(preset.id));
      grid.appendChild(deleteButton);
    }

    presetsEditorRowsEl.appendChild(grid);

    const row = { presetId: preset.id, name, light, lightHex, dark, darkHex, autoMatch };
    bindPresetRow(row);
    syncPresetMatchButton(row);
    return row;
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

function autoMatchRowLightToDark(presetId) {
  if (!pendingSettings) return;
  const row = presetRows.find(item => item.presetId === presetId);
  if (!row || !row.light || !row.dark || !row.darkHex) return;
  lastChangedSideByPreset.set(presetId, 'light');
  syncPresetMatchButton(row);
  const light = row.light.value;
  if (!isValidHex(light)) return;
  const dark = deriveDarkFromLight(light);
  row.dark.value = dark;
  row.darkHex.value = dark.toUpperCase();
  updatePendingPreset(presetId, preset => {
    preset.colorDark = dark;
  });
}

function autoMatchRowDarkToLight(presetId) {
  if (!pendingSettings) return;
  const row = presetRows.find(item => item.presetId === presetId);
  if (!row || !row.light || !row.lightHex || !row.dark) return;
  lastChangedSideByPreset.set(presetId, 'dark');
  syncPresetMatchButton(row);
  const dark = row.dark.value;
  if (!isValidHex(dark)) return;
  const light = deriveLightFromDark(dark);
  row.light.value = light;
  row.lightHex.value = light.toUpperCase();
  updatePendingPreset(presetId, preset => {
    preset.colorLight = light;
  });
}

function autoMatchRow(presetId) {
  if (lastChangedSideByPreset.get(presetId) === 'dark') {
    autoMatchRowDarkToLight(presetId);
  } else {
    autoMatchRowLightToDark(presetId);
  }
}

function syncPresetMatchButton(row) {
  if (!row || !row.autoMatch) return;
  const sourceSide = lastChangedSideByPreset.get(row.presetId) === 'dark' ? 'dark' : 'light';
  const targetLabel = sourceSide === 'dark' ? 'Light' : 'Dark';
  const sourceLabel = sourceSide === 'dark' ? 'Dark' : 'Light';
  const accessibleLabel = `Match ${targetLabel.toLowerCase()} color from ${sourceLabel.toLowerCase()} color`;
  row.autoMatch.textContent = `Match ${targetLabel}`;
  row.autoMatch.title = accessibleLabel;
  row.autoMatch.setAttribute('aria-label', accessibleLabel);
}

// Validate hex color input
function isValidHex(str) {
  return /^#[0-9A-Fa-f]{6}$/.test(str);
}

// ---- Appearance color handlers ----

function updateAppearanceDefaultColors(light, dark) {
  if (!pendingSettings || !isValidHex(light) || !isValidHex(dark)) return;
  const presets = normalizePresets(pendingSettings.presets);
  const defaultPreset = presets.find(preset => preset.id === 'preset1');
  if (!defaultPreset) return;

  defaultPreset.colorLight = light;
  defaultPreset.colorDark = dark;
  pendingSettings.presets = presets;
  pendingSettings.colorLight = light;
  pendingSettings.colorDark = dark;

  syncAppearanceFromPresets(presets);
  syncPresetsEditor(presets);
  rerenderFabBuilder();
  refreshTagsLibraryIfLive();
  schedulePresetSettingsSave();
}

colorLightPicker.addEventListener('input', (e) => {
  const hex = e.target.value;
  updateAppearanceDefaultColors(hex, deriveDarkFromLight(hex));
});

colorLightHex.addEventListener('input', (e) => {
  let val = e.target.value;
  if (!val.startsWith('#')) val = '#' + val;
  if (isValidHex(val)) {
    updateAppearanceDefaultColors(val, deriveDarkFromLight(val));
  }
});

colorLightHex.addEventListener('blur', () => {
  if (!isValidHex(colorLightHex.value)) {
    syncAppearanceFromPresets(pendingSettings?.presets || DEFAULTS.presets);
  }
});

colorDarkPicker.addEventListener('input', (e) => {
  const hex = e.target.value;
  updateAppearanceDefaultColors(deriveLightFromDark(hex), hex);
});

colorDarkHex.addEventListener('input', (e) => {
  let val = e.target.value;
  if (!val.startsWith('#')) val = '#' + val;
  if (isValidHex(val)) {
    updateAppearanceDefaultColors(deriveLightFromDark(val), val);
  }
});

colorDarkHex.addEventListener('blur', () => {
  if (!isValidHex(colorDarkHex.value)) {
    syncAppearanceFromPresets(pendingSettings?.presets || DEFAULTS.presets);
  }
});

// ---- Tag Presets editor handlers ----

function bindPresetRow(row) {
  if (!row.name || !row.light || !row.dark || !row.lightHex || !row.darkHex) return;
  const presetId = row.presetId;

  row.name.addEventListener('input', (e) => {
    updatePendingPreset(presetId, preset => {
      preset.name = (e.target.value || '').toString();
    });
  });

  row.light.addEventListener('input', (e) => {
    const hex = e.target.value;
    lastChangedSideByPreset.set(presetId, 'light');
    syncPresetMatchButton(row);
    row.lightHex.value = hex.toUpperCase();
    updatePendingPreset(presetId, preset => {
      preset.colorLight = hex;
    });
  });

  row.dark.addEventListener('input', (e) => {
    const hex = e.target.value;
    lastChangedSideByPreset.set(presetId, 'dark');
    syncPresetMatchButton(row);
    row.darkHex.value = hex.toUpperCase();
    updatePendingPreset(presetId, preset => {
      preset.colorDark = hex;
    });
  });

  row.lightHex.addEventListener('input', (e) => {
    let val = e.target.value || '';
    if (!val.startsWith('#')) val = '#' + val;
    if (!isValidHex(val)) return;
    lastChangedSideByPreset.set(presetId, 'light');
    syncPresetMatchButton(row);
    row.light.value = val;
    updatePendingPreset(presetId, preset => {
      preset.colorLight = val;
    });
  });

  row.darkHex.addEventListener('input', (e) => {
    let val = e.target.value || '';
    if (!val.startsWith('#')) val = '#' + val;
    if (!isValidHex(val)) return;
    lastChangedSideByPreset.set(presetId, 'dark');
    syncPresetMatchButton(row);
    row.dark.value = val;
    updatePendingPreset(presetId, preset => {
      preset.colorDark = val;
    });
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

  row.autoMatch.addEventListener('click', () => autoMatchRow(presetId));
}

if (addTagPresetBtn) {
  addTagPresetBtn.addEventListener('click', () => {
    if (!pendingSettings) return;
    const presets = normalizePresets(pendingSettings.presets);
    const colorLight = '#E2D5FF';
    presets.push({
      id: generatePresetId(),
      name: `New Tag ${presets.length + 1}`,
      colorLight,
      colorDark: deriveDarkFromLight(colorLight)
    });
    pendingSettings.presets = presets;
    syncPresetsEditor(presets);
    const newTagNameInput = presetRows[presetRows.length - 1]?.name;
    if (newTagNameInput) {
      newTagNameInput.focus();
      newTagNameInput.select();
    }
    syncAppearanceFromPresets(presets);
    rerenderFabBuilder();
    refreshTagsLibraryIfLive();
    schedulePresetSettingsSave();
  });
}

function removeTagPreset(presetId) {
  if (!pendingSettings || presetId === 'preset1') return;
  const presets = normalizePresets(pendingSettings.presets);
  const removedPreset = presets.find(preset => preset.id === presetId);
  if (!removedPreset) return;

  const nextPresets = presets.filter(preset => preset.id !== presetId);
  pendingSettings.presets = nextPresets;
  lastChangedSideByPreset.delete(presetId);
  if (selectedAppearancePreviewPresetId === presetId) {
    selectedAppearancePreviewPresetId = 'preset1';
  }
  if (currentTagPresetId === presetId) {
    currentTagPresetId = null;
  }

  syncPresetsEditor(nextPresets);
  syncAppearanceFromPresets(nextPresets);
  reconcileCurrentFabLayout(true);
  rerenderFabBuilder();
  refreshTagsLibraryIfLive();
  schedulePresetSettingsSave();
  showToast(`${removedPreset.name || 'Tag'} deleted`);
}

if (deleteTagPresetBtn) {
  deleteTagPresetBtn.addEventListener('click', () => {
    presetDeleteMode = !presetDeleteMode;
    syncPresetsEditor(pendingSettings?.presets || DEFAULTS.presets);
  });
}

if (autoMatchAllLightToDarkBtn) {
  autoMatchAllLightToDarkBtn.addEventListener('click', () => {
    presetRows.forEach(row => autoMatchRowLightToDark(row.presetId));
  });
}

if (autoMatchAllDarkToLightBtn) {
  autoMatchAllDarkToLightBtn.addEventListener('click', () => {
    presetRows.forEach(row => autoMatchRowDarkToLight(row.presetId));
  });
}

if (manageTagPresetsBtn) {
  manageTagPresetsBtn.addEventListener('click', () => {
    scrollToSettingsSection('presets-tags', { focusHeading: true });
  });
}

// ---- Save / Load / Reset ----

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2000);
}

function loadSettings() {
  chrome.storage.local.get('highlightSettings', (result) => {
    const s = result.highlightSettings || DEFAULTS;

    setPending(s);
    showFabToggle.checked = pendingSettings.showFab !== undefined ? pendingSettings.showFab : DEFAULTS.showFab;
    syncAppearanceFromPresets(pendingSettings.presets || DEFAULTS.presets);
    syncPresetsEditor(pendingSettings.presets || DEFAULTS.presets);
    repairDefaultPresetMirrorsIfNeeded(s);

    // Init FAB builder once settings are ready (so preset colors are available)
    initFabBuilder();
  });
}

function resetSettings() {
  cancelScopedSettingsAutosave();
  selfPersistedSettingsSignatures.clear();
  const resetSettingsValue = cloneDefaults();
  const resetFabLayout = defaultFabLayout();
  setPending(resetSettingsValue);
  showFabToggle.checked = pendingSettings.showFab;
  syncAppearanceFromPresets(pendingSettings.presets || DEFAULTS.presets);
  syncPresetsEditor(pendingSettings.presets || DEFAULTS.presets);
  fabLayoutState = resetFabLayout;
  rerenderFabBuilder();

  queueScopedSettingsBarrier((done) => {
    chrome.storage.local.set({
      highlightSettings: resetSettingsValue,
      [FAB_LAYOUT_KEY]: resetFabLayout
    }, () => {
      showToast('Reset to defaults');
      setAppearanceSaveStatus('saved');
      done();
    });
  });
}

// ---- Button handlers ----

resetBtn.addEventListener('click', () => {
  if (!resetConfirmDialog || typeof resetConfirmDialog.showModal !== 'function') {
    if (window.confirm('Reset settings and remove custom tag presets? Saved highlights and Library records will remain.')) {
      resetSettings();
    }
    return;
  }
  resetConfirmDialog.showModal();
  requestAnimationFrame(() => cancelResetBtn?.focus({ preventScroll: true }));
});

cancelResetBtn?.addEventListener('click', () => {
  resetConfirmDialog?.close('cancel');
});

confirmResetBtn?.addEventListener('click', () => {
  resetConfirmDialog?.close('confirm');
  resetSettings();
});

resetConfirmDialog?.addEventListener('close', () => {
  resetBtn.focus({ preventScroll: true });
});

showFabToggle.addEventListener('change', () => {
  if (!pendingSettings) return;
  pendingSettings.showFab = showFabToggle.checked;
  scheduleScopedSettingsPatch({ showFab: pendingSettings.showFab });
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

let lastRenderedShortcut = null;
const pressedShortcutKeys = new Set();

function isMacShortcutPlatform() {
  const platform = navigator.userAgentData?.platform || navigator.platform || '';
  return /mac|iphone|ipad|ipod/i.test(platform);
}

function formatShortcutToken(token, useMacSymbols) {
  const value = token.trim();
  const normalized = value.toLowerCase();

  if (useMacSymbols) {
    const macSymbols = {
      command: '⌘',
      cmd: '⌘',
      meta: '⌘',
      shift: '⇧',
      option: '⌥',
      alt: '⌥',
      control: '⌃',
      ctrl: '⌃',
      macctrl: '⌃'
    };
    if (macSymbols[normalized]) return macSymbols[normalized];
  } else {
    const modifierLabels = {
      command: 'Meta',
      cmd: 'Meta',
      meta: 'Meta',
      shift: 'Shift',
      option: 'Alt',
      alt: 'Alt',
      control: 'Ctrl',
      ctrl: 'Ctrl',
      macctrl: 'Ctrl'
    };
    if (modifierLabels[normalized]) return modifierLabels[normalized];
  }

  return value.length === 1 ? value.toUpperCase() : value;
}

function parseShortcutTokens(shortcut) {
  const value = typeof shortcut === 'string' ? shortcut.trim() : '';
  if (!value) return [];

  const parts = value.includes('+')
    ? value.split(/\s*\+\s*/)
    : value.split(/\s+/);

  return parts.flatMap(part => {
    const symbolAndKeyTokens = part.match(/[⌘⇧⌥⌃]|[^⌘⇧⌥⌃]+/g) || [];
    return symbolAndKeyTokens.map(token => token.trim()).filter(Boolean);
  });
}

function normalizeShortcutTokenForKeyboard(token) {
  const value = typeof token === 'string' ? token.trim() : '';
  const normalized = value.toLowerCase();
  const aliases = {
    command: 'meta',
    cmd: 'meta',
    meta: 'meta',
    '⌘': 'meta',
    shift: 'shift',
    '⇧': 'shift',
    option: 'alt',
    alt: 'alt',
    '⌥': 'alt',
    control: 'control',
    ctrl: 'control',
    macctrl: 'control',
    '⌃': 'control',
    space: 'space',
    spacebar: 'space',
    esc: 'escape',
    return: 'enter'
  };
  return aliases[normalized] || normalized;
}

function normalizeKeyboardEventKey(event) {
  if (!event || typeof event.key !== 'string') return '';
  if (event.key === ' ') return 'space';
  return normalizeShortcutTokenForKeyboard(event.key);
}

function updatePressedShortcutKey(keyName, isPressed) {
  if (!shortcutDisplay || !keyName) return;
  if (isPressed) pressedShortcutKeys.add(keyName);
  else pressedShortcutKeys.delete(keyName);

  shortcutDisplay.querySelectorAll('.shortcut-key[data-shortcut-key]').forEach(keycap => {
    const pressed = pressedShortcutKeys.has(keycap.dataset.shortcutKey);
    keycap.classList.toggle('is-pressed', pressed);
  });
}

function releaseAllShortcutKeys() {
  pressedShortcutKeys.clear();
  shortcutDisplay?.querySelectorAll('.shortcut-key.is-pressed').forEach(keycap => {
    keycap.classList.remove('is-pressed');
  });
}

function renderShortcutKeys(shortcut) {
  if (!shortcutDisplay) return;
  const normalizedShortcut = typeof shortcut === 'string' ? shortcut.trim() : '';
  if (normalizedShortcut === lastRenderedShortcut) return;
  lastRenderedShortcut = normalizedShortcut;

  const tokens = parseShortcutTokens(normalizedShortcut);
  const renderedTokens = tokens.length > 0
    ? tokens.map(token => ({
      display: formatShortcutToken(token, isMacShortcutPlatform()),
      keyboardKey: normalizeShortcutTokenForKeyboard(token)
    }))
    : [{ display: 'Not set', keyboardKey: '' }];

  const fragment = document.createDocumentFragment();
  renderedTokens.forEach(({ display, keyboardKey }) => {
    const key = document.createElement('kbd');
    key.className = 'shortcut-key';
    key.textContent = display;
    if (keyboardKey) {
      key.dataset.shortcutKey = keyboardKey;
      key.classList.toggle('is-pressed', pressedShortcutKeys.has(keyboardKey));
    }
    key.setAttribute('aria-hidden', 'true');
    fragment.appendChild(key);
  });

  shortcutDisplay.classList.toggle('is-empty', tokens.length === 0);
  shortcutDisplay.setAttribute(
    'aria-label',
    normalizedShortcut ? `Keyboard shortcut: ${normalizedShortcut}` : 'Keyboard shortcut: Not set'
  );
  shortcutDisplay.replaceChildren(fragment);
}

function refreshShortcutDisplay() {
  chrome.commands.getAll((commands) => {
    const hlCmd = commands.find(c => c.name === 'highlight-selection');
    renderShortcutKeys(hlCmd?.shortcut || '');
  });
}

refreshShortcutDisplay();
window.addEventListener('focus', refreshShortcutDisplay);
window.addEventListener('keydown', (event) => {
  updatePressedShortcutKey(normalizeKeyboardEventKey(event), true);
});
window.addEventListener('keyup', (event) => {
  const keyName = normalizeKeyboardEventKey(event);
  updatePressedShortcutKey(keyName, false);
  if (keyName === 'meta') releaseAllShortcutKeys();
});
window.addEventListener('blur', releaseAllShortcutKeys);

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
      const normalizedPresetId = normalizeLibraryPresetId(one.presetId);
      if (one.presetId !== normalizedPresetId) {
        one.presetId = normalizedPresetId;
        changed = true;
      }
      if (Object.prototype.hasOwnProperty.call(one, 'color')) {
        delete one.color;
        changed = true;
      }
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
    const rawPresetId = items.find(it => typeof it.presetId === 'string' && it.presetId.trim() !== '')?.presetId
      || base.presetId
      || DEFAULTS.presets[0].id;
    const presetId = normalizeLibraryPresetId(rawPresetId);

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

let activeLibraryPresets = DEFAULTS.presets.map(p => ({ ...p }));

function normalizeLibraryPresetId(presetId) {
  const match = activeLibraryPresets.find(p => p.id === presetId);
  const defaultPreset = activeLibraryPresets.find(p => p.id === 'preset1') || DEFAULTS.presets[0];
  return match ? match.id : defaultPreset.id;
}

function setActiveLibraryPresets(settings) {
  activeLibraryPresets = getTagPresetDefinitions(settings || DEFAULTS);
}

function getLibraryPresetForHighlight(hl) {
  const presetId = getHighlightPresetId(hl);
  return activeLibraryPresets.find(p => p.id === presetId)
    || activeLibraryPresets.find(p => p.id === 'preset1')
    || DEFAULTS.presets[0];
}

function getLibraryHighlightColor(hl) {
  const preset = getLibraryPresetForHighlight(hl);
  return document.body.classList.contains('dark')
    ? (preset.colorDark || DEFAULTS.colorDark)
    : (preset.colorLight || DEFAULTS.colorLight);
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
    activeLibraryPresets = presets;
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

  presets.forEach(p => {
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
    activeLibraryPresets = presets;
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
    setActiveLibraryPresets(all.highlightSettings);
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
    setActiveLibraryPresets(all.highlightSettings);
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
  chrome.storage.local.get([RECENTLY_DELETED_KEY, 'highlightSettings'], (result) => {
    setActiveLibraryPresets(result.highlightSettings);
    const rawTrash = Array.isArray(result[RECENTLY_DELETED_KEY]) ? result[RECENTLY_DELETED_KEY] : [];
    let trashChanged = false;
    const trash = rawTrash.map(entry => {
      if (!entry || !entry.highlight) return entry;
      const normalized = normalizeStoredHighlights([entry.highlight]);
      const highlight = normalized.highlights[0];
      if (!highlight) return entry;
      if (normalized.changed) trashChanged = true;
      return normalized.changed ? { ...entry, highlight } : entry;
    });
    if (trashChanged) {
      chrome.storage.local.set({ [RECENTLY_DELETED_KEY]: trash });
    }
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
      const resolvedColor = getLibraryHighlightColor(hl);
      dot.style.backgroundColor = resolvedColor;
      dot.title = getLibraryPresetForHighlight(hl).name || resolvedColor;
      colorSlot.appendChild(dot);

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
      const resolvedColor = getLibraryHighlightColor(hl);
      dot.style.backgroundColor = resolvedColor;
      dot.title = getLibraryPresetForHighlight(hl).name || resolvedColor;
      colorSlot.appendChild(dot);

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

const urlParams = new URLSearchParams(window.location.search);
const tabParam = urlParams.get('tab');
const hasValidTabParam = ['library', 'settings', 'about'].includes(tabParam);
if (hasValidTabParam) {
  switchToTab(tabParam);
}

// Initialize sidebar state for active tab on load
const activeTab = document.querySelector('.tab-btn.active');
if (activeTab && !hasValidTabParam) {
  resetSidebarForTab(activeTab.dataset.tab);
}
refreshLibrary();
