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
  chrome.storage.local.set({ popupTheme: isDark ? 'dark' : 'light' }, () => {
    if (!chrome.runtime.lastError) return;
    document.body.classList.toggle('dark', !isDark);
    showToast('Could not save theme');
    rerenderFabBuilder();
  });
  if (pendingSettings) {
    syncAppearanceFromPresets(pendingSettings.presets || DEFAULTS.presets);
  }
  // Refresh every FAB builder surface for this theme.
  rerenderFabBuilder();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  if (backupReplacementPending) return;
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
      } else {
        // Color history is invalid only when the preset IDs or colors it targets changed.
        const presetStateChanged = !presetColorSnapshotsMatch(
          getPresetColorSnapshot(pendingSettings?.presets),
          getPresetColorSnapshot(s.presets)
        );
        if (presetStateChanged) clearPresetColorHistory();
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
  'data'
];

let settingsScrollPosition = 0;
let settingsHasStoredScrollPosition = false;
let currentSettingsSection = 'appearance';
let settingsScrollFrame = null;
let settingsStickyHeaderOffset = 112;
let settingsHeaderResizeObserver = null;
let navbarResizeObserver = null;

function updateGlobalNavbarMetrics() {
  const navbar = document.querySelector('header.navbar');
  if (!navbar) return 0;
  const navbarHeight = Math.ceil(navbar.getBoundingClientRect().height);
  if (navbarHeight > 0) {
    document.documentElement.style.setProperty('--global-navbar-height', `${navbarHeight}px`);
  }
  return navbarHeight;
}

function initGlobalNavbarMetrics() {
  updateGlobalNavbarMetrics();
  const navbar = document.querySelector('header.navbar');
  if (!navbar || typeof ResizeObserver !== 'function') return;
  navbarResizeObserver = new ResizeObserver(() => {
    updateGlobalNavbarMetrics();
    updateSettingsStickyHeaderMetrics();
    if (isSettingsTabActive()) scheduleSettingsScrollSpy();
  });
  navbarResizeObserver.observe(navbar);
}

function isSettingsTabActive() {
  const panel = document.getElementById('tab-settings');
  return !!(panel && panel.classList.contains('active'));
}

function getSettingsSection(viewName) {
  return document.querySelector(`#tab-settings .settings-view[data-view="${viewName}"]`);
}

function updateSettingsStickyHeaderMetrics() {
  const header = document.querySelector('#tab-settings .settings-page-intro');
  const content = document.querySelector('#tab-settings .content-area');
  if (!header || !content) return settingsStickyHeaderOffset;
  const navbarHeight = updateGlobalNavbarMetrics();
  if (navbarHeight > 0) {
    settingsStickyHeaderOffset = navbarHeight + 16;
    content.style.setProperty('--settings-sticky-header-offset', `${settingsStickyHeaderOffset}px`);
  }
  return settingsStickyHeaderOffset;
}

function getSettingsScrollReadingLine() {
  const navbar = document.querySelector('header.navbar');
  if (!navbar) return settingsStickyHeaderOffset;
  const navbarBottom = navbar.getBoundingClientRect().bottom;
  return Math.max(24, Math.min(window.innerHeight - 24, navbarBottom + 16));
}

function initSettingsStickyHeaderMetrics() {
  updateSettingsStickyHeaderMetrics();
  const header = document.querySelector('#tab-settings .settings-page-intro');
  if (!header || typeof ResizeObserver !== 'function') return;
  settingsHeaderResizeObserver = new ResizeObserver(() => {
    updateSettingsStickyHeaderMetrics();
    if (isSettingsTabActive()) scheduleSettingsScrollSpy();
  });
  settingsHeaderResizeObserver.observe(header);
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

  updateSettingsStickyHeaderMetrics();
  const readingLine = getSettingsScrollReadingLine();
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
  updateSettingsStickyHeaderMetrics();
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const sectionTop = window.scrollY + section.getBoundingClientRect().top;
  window.scrollTo({
    top: Math.max(0, sectionTop - settingsStickyHeaderOffset),
    behavior: reduceMotion ? 'auto' : 'smooth',
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
    updateSettingsStickyHeaderMetrics();
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
  closeLibraryTagPopover();
  closeLibraryFolderPopover();
  closeLibraryCommentPopover();
  closeMobileLibrarySearch();
  if (currentTab === tabName) {
    if (tabName === 'settings') scheduleSettingsScrollSpy();
    else if (tabName === 'guide') window.scrollTo({ top: 0, behavior: 'auto' });
    else resetSidebarForTab(tabName);
    return;
  }
  if (currentTab === 'library') beginLibraryLoad();
  if (currentTab === 'settings') captureSettingsScrollPosition();

  document.querySelectorAll('.tab-btn').forEach(button => {
    button.classList.remove('active');
    button.removeAttribute('aria-current');
  });
  document.querySelectorAll('.tab-panel').forEach(tabPanel => tabPanel.classList.remove('active'));
  tabBtn.classList.add('active');
  tabBtn.setAttribute('aria-current', 'page');
  panel.classList.add('active');

  if (tabName === 'settings') restoreSettingsScrollPosition();
  else resetSidebarForTab(tabName);
  if (tabName === 'guide' || currentTab === 'guide') {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }
}

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => activateMainTab(btn.dataset.tab));
});

document.querySelectorAll('.guide-action').forEach(button => {
  button.addEventListener('click', () => {
    const target = button.dataset.guideTarget;
    const viewName = button.dataset.guideView;
    if (target === 'library') {
      activateMainTab('library');
      if (viewName) switchSidebarView('library', viewName);
      window.scrollTo({ top: 0, behavior: 'auto' });
      requestAnimationFrame(() => {
        document.getElementById('libraryViewHeading')?.focus({ preventScroll: true });
      });
      return;
    }
    if (target === 'settings' && SETTINGS_SECTION_VIEW_ORDER.includes(viewName)) {
      activateMainTab('settings');
      requestAnimationFrame(() => {
        requestAnimationFrame(() => scrollToSettingsSection(viewName, { focusHeading: true }));
      });
    }
  });
});

window.addEventListener('scroll', () => {
  if (!isSettingsTabActive()) return;
  settingsScrollPosition = window.scrollY;
  settingsHasStoredScrollPosition = true;
  scheduleSettingsScrollSpy();
}, { passive: true });

window.addEventListener('resize', () => {
  closeMobileLibrarySearch();
  setFoldersExpanded(foldersExpandedPreference);
  updateSettingsStickyHeaderMetrics();
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
let foldersExpandedPreference = false;

const LIBRARY_VIEW_META = {
  all: {
    title: 'All Highlights',
    description: 'Every saved highlight, grouped by webpage.'
  },
  favorites: {
    title: 'Favorites',
    description: 'Highlights you have starred for quick access.'
  },
  tags: {
    title: 'Tags',
    description: 'Browse your saved highlights by tag.'
  },
  comments: {
    title: 'Notes',
    description: 'Review highlights with notes you have added.'
  },
  folders: {
    title: 'Folders',
    description: 'Create folders and organize highlights into one place. Use the edit icon to rename a folder.'
  },
  'recently-deleted': {
    title: 'Recently Deleted',
    description: 'Restore deleted highlights or remove them permanently.'
  }
};

function syncLibraryViewHeader(viewName = currentLibraryView) {
  const meta = LIBRARY_VIEW_META[viewName] || LIBRARY_VIEW_META.all;
  const heading = document.getElementById('libraryViewHeading');
  const description = document.getElementById('libraryViewDescription');
  if (heading) heading.textContent = meta.title;
  if (description) description.textContent = meta.description;
}

function isMobileLibraryLayout() {
  return typeof window.matchMedia === 'function'
    && window.matchMedia('(max-width: 768px)').matches;
}

function setMobileLibrarySearchOpen(isOpen, { focusInput = false } = {}) {
  const sidebar = document.getElementById('sidebar-library');
  if (!sidebar) return;
  const shouldOpen = Boolean(isOpen && isMobileLibraryLayout());
  const toggle = sidebar.querySelector('.search-bar-collapsed-btn');
  const input = document.getElementById('librarySearch');
  sidebar.classList.toggle('is-mobile-search-open', shouldOpen);
  if (toggle) toggle.setAttribute('aria-expanded', String(shouldOpen));
  if (shouldOpen && focusInput) {
    requestAnimationFrame(() => input?.focus({ preventScroll: true }));
  }
}

function closeMobileLibrarySearch() {
  setMobileLibrarySearchOpen(false);
}

function setFoldersExpanded(expanded, { persist = false } = {}) {
  const nav = document.getElementById('libraryFoldersNav');
  const toggle = document.getElementById('libraryFoldersToggle');
  const children = document.getElementById('libraryFolderChildren');
  if (!nav || !toggle || !children) return;
  foldersExpandedPreference = Boolean(expanded);
  const canExpand = !isMobileLibraryLayout()
    && !document.getElementById('sidebar-library')?.classList.contains('collapsed');
  const isExpanded = Boolean(expanded && canExpand);
  nav.classList.toggle('is-expanded', isExpanded);
  toggle.setAttribute('aria-expanded', String(isExpanded));
  toggle.setAttribute('aria-label', isExpanded ? 'Collapse folders' : 'Expand folders');
  toggle.title = isExpanded ? 'Collapse folders' : 'Expand folders';
  children.hidden = !isExpanded;
  if (persist) {
    chrome.storage.local.set({ [FOLDERS_EXPANDED_KEY]: foldersExpandedPreference }, () => {
      if (chrome.runtime.lastError) showToast('Could not save folder navigation');
    });
  }
}

function renderLibraryFolderChildren(folders = activeLibraryFolders) {
  const children = document.getElementById('libraryFolderChildren');
  if (!children) return;
  const parentItem = document.querySelector('#sidebar-library .sidebar-item[data-view="folders"]');
  if (parentItem) {
    const isFoldersView = currentLibraryView === 'folders';
    parentItem.classList.toggle('active', isFoldersView);
    if (isFoldersView && !currentFolderId) parentItem.setAttribute('aria-current', 'page');
    else parentItem.removeAttribute('aria-current');
  }
  children.innerHTML = '';
  sortFoldersByName(folders).forEach(folder => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'library-folder-child';
    button.classList.toggle('active', currentLibraryView === 'folders' && currentFolderId === folder.id);
    if (currentLibraryView === 'folders' && currentFolderId === folder.id) {
      button.setAttribute('aria-current', 'page');
    }
    button.title = folder.name;

    const label = document.createElement('span');
    label.className = 'library-folder-child-label';
    label.textContent = folder.name;
    button.appendChild(label);
    button.addEventListener('click', () => {
      currentLibraryView = 'folders';
      currentFolderId = folder.id;
      syncLibraryViewHeader('folders');
      document.querySelectorAll('#sidebar-library .sidebar-item').forEach(item => {
        const isActive = item.dataset.view === 'folders';
        item.classList.toggle('active', isActive);
        item.removeAttribute('aria-current');
      });
      renderLibraryFolderChildren();
      refreshLibrary();
    });
    children.appendChild(button);
  });
}

function initLibraryFoldersNavigation() {
  const toggle = document.getElementById('libraryFoldersToggle');
  if (toggle) {
    toggle.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      const expanded = toggle.getAttribute('aria-expanded') !== 'true';
      setFoldersExpanded(expanded, { persist: true });
    });
  }
  chrome.storage.local.get(FOLDERS_EXPANDED_KEY, result => {
    setFoldersExpanded(result[FOLDERS_EXPANDED_KEY] === true);
  });
}

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
    closeMobileLibrarySearch();
    currentLibraryView = viewName;
    if (viewName !== 'tags') {
      currentTagPresetId = null;
    }
    currentFolderId = null;
    syncLibraryViewHeader(viewName);
    const sidebar = panel.querySelector('.sidebar');
    sidebar.querySelectorAll('.sidebar-item').forEach(item => {
      const isActive = item.dataset.view === viewName;
      item.classList.toggle('active', isActive);
      if (isActive) item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
    });
    renderLibraryFolderChildren();
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
const exportBackupBtn = document.getElementById('exportBackupBtn');
const importBackupBtn = document.getElementById('importBackupBtn');
const importBackupInput = document.getElementById('importBackupInput');
const backupImportDialog = document.getElementById('backupImportDialog');
const backupImportCreated = document.getElementById('backupImportCreated');
const backupImportVersion = document.getElementById('backupImportVersion');
const backupImportSummary = document.getElementById('backupImportSummary');
const backupImportError = document.getElementById('backupImportError');
const cancelBackupImportBtn = document.getElementById('cancelBackupImportBtn');
const confirmBackupImportBtn = document.getElementById('confirmBackupImportBtn');
const openShortcuts = document.getElementById('openShortcuts');
const shortcutDisplay = document.getElementById('shortcutDisplay');
const toast = document.getElementById('toast');

const presetsEditorRowsEl = document.getElementById('presetsEditorRows');
const addTagPresetBtn = document.getElementById('addTagPreset');
const deleteTagPresetBtn = document.getElementById('deleteTagPreset');
const undoPresetColorsBtn = document.getElementById('undoPresetColors');
const redoPresetColorsBtn = document.getElementById('redoPresetColors');
let presetRows = [];
let presetDeleteMode = false;
const lastChangedSideByPreset = new Map();
const PRESET_COLOR_HISTORY_LIMIT = 50;
let presetColorUndoStack = [];
let presetColorRedoStack = [];

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
  { id: 'favorite', label: 'Favorite', type: 'action', glyph: '☆', paletteGlyph: '☆' },
  { id: 'folder', label: 'Folder', type: 'action', glyph: '', paletteGlyph: '', icon: 'folder' },
  { id: 'close', label: 'Close', type: 'action', glyph: '', paletteGlyph: '', icon: 'close' },
  { id: 'comment', label: 'Note', type: 'action', glyph: '', paletteGlyph: '', icon: 'comment' }
];
const RETIRED_FAB_ACTION_IDS = new Set(['copyLink', 'share']);

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
    type: 'preset'
  }));
  return [...presetDefs, ...FAB_ACTION_DEFS];
}

function reconcileFabLayout(raw) {
  const base = defaultFabLayout();
  const expected = base.rows * base.cols;
  const rawSlots = raw == null
    ? base.slots.slice()
    : (Array.isArray(raw.slots) ? raw.slots.slice(0, expected) : []);
  while (rawSlots.length < expected) rawSlots.push(null);

  const allowed = new Set(getFabButtonDefs().map(d => d.id));
  const presentValidIds = new Set(rawSlots.filter(id => typeof id === 'string' && allowed.has(id)));
  const slots = rawSlots.map((slotId, index) => {
    if (slotId == null) return null;
    if (typeof slotId === 'string' && allowed.has(slotId)) return slotId;
    if (RETIRED_FAB_ACTION_IDS.has(slotId)) return null;

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
  const p = presets.find(preset => preset.id === presetId) || getDefaultPreset(presets) || {};
  return {
    light: p.colorLight || DEFAULTS.colorLight,
    dark: p.colorDark || DEFAULTS.colorDark,
    current: isDark ? (p.colorDark || DEFAULTS.colorDark) : (p.colorLight || DEFAULTS.colorLight)
  };
}

function persistFabLayout() {
  if (!fabLayoutState) return;
  setAppearanceSaveStatus('saving');
  chrome.storage.local.set({ [FAB_LAYOUT_KEY]: fabLayoutState }, () => {
    setAppearanceSaveStatus(chrome.runtime.lastError ? 'error' : 'saved');
  });
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

function createFabPopoverOption({ label, icon, iconName, color, danger = false, onSelect }) {
  const option = document.createElement('button');
  option.type = 'button';
  option.className = 'fab-popover-option';
  if (danger) option.classList.add('is-danger');

  const visual = document.createElement('span');
  visual.className = 'fab-popover-option-icon';
  if (color) visual.style.backgroundColor = color;
  else if (iconName) visual.innerHTML = libraryIconMarkup(iconName);
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

function createFabPickerGroup(title, defs) {
  const group = document.createElement('div');
  group.className = 'fab-popover-group';

  const heading = document.createElement('div');
  heading.className = 'fab-popover-group-title';
  const headingText = document.createElement('span');
  headingText.textContent = title;
  heading.appendChild(headingText);

  group.appendChild(heading);
  defs.forEach(def => {
    const option = createFabPopoverOption({
      label: def.label,
      icon: def.paletteGlyph || def.glyph,
      iconName: def.icon,
      color: def.type === 'preset' ? getPresetColorsForId(def.id).current : '',
      onSelect: () => placeFabItemInSlot(activeFabSlotIndex, def.id)
    });
    option.dataset.fabButtonId = def.id;
    group.appendChild(option);
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
    defs.filter(def => def.type === 'action')
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

function createFabToolboxGroup(title, defs) {
  const group = document.createElement('section');
  group.className = 'fab-toolbox-group';

  const header = document.createElement('div');
  header.className = 'fab-toolbox-group-header';

  const heading = document.createElement('h4');
  heading.className = 'fab-toolbox-group-title';
  heading.textContent = title;
  header.appendChild(heading);

  const list = document.createElement('div');
  list.className = 'fab-toolbox-list';

  defs.forEach(def => {
    const item = document.createElement('div');
    item.className = 'fab-toolbox-item';
    item.draggable = true;
    item.dataset.fabButtonId = def.id;
    item.setAttribute('aria-label', `Drag ${def.label} into the FAB layout with a pointer`);

    const swatch = document.createElement('span');
    swatch.className = 'fab-toolbox-swatch';
    if (def.type === 'preset') {
      swatch.style.backgroundColor = getPresetColorsForId(def.id).current;
    } else if (def.icon) {
      swatch.innerHTML = libraryIconMarkup(def.icon);
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
    defs.filter(def => def.type === 'action')
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
      btn.dataset.fabButtonId = slotId;
      btn.title = def.label;

      const visual = document.createElement('span');
      visual.className = 'fab-slot-visual';
      if (def.type === 'preset') {
        visual.style.backgroundColor = getPresetColorsForId(def.id).current;
      } else if (def.icon) {
        visual.innerHTML = libraryIconMarkup(def.icon);
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
    btn.dataset.fabButtonId = slotId;
    btn.title = def.label;
    btn.setAttribute('role', 'img');
    btn.setAttribute('aria-label', def.label);

    if (def.type === 'preset') {
      btn.style.backgroundColor = getPresetColorsForId(def.id).current;
    } else if (def.icon) {
      btn.innerHTML = libraryIconMarkup(def.icon);
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
  const defaultPreset = base.find(def => def.id === 'preset1');

  source.forEach((raw, idx) => {
    if (!raw || typeof raw !== 'object') return;
    const rawId = typeof raw.id === 'string' ? raw.id.trim() : '';
    const matchingDefault = base.find(def => def.id === rawId) || base[idx] || defaultPreset;
    const id = rawId || (idx < base.length ? matchingDefault.id : '');
    if (!id || seen.has(id)) return;
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
    if (chrome.runtime.lastError) {
      scopedSettingsWriteInFlight = false;
      setAppearanceSaveStatus('error');
      pumpScopedSettingsWork();
      return;
    }
    const next = normalizeScopedSettingsWrite(result.highlightSettings, patch);
    const signature = getHighlightSettingsSignature(next);
    // A no-op produces no onChanged event, so never create a marker that cannot be consumed.
    if (signature === getHighlightSettingsSignature(result.highlightSettings)) {
      scopedSettingsWriteInFlight = false;
      setAppearanceSaveStatus('saved');
      pumpScopedSettingsWork();
      return;
    }
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

function getPresetColorSnapshot(presets = pendingSettings?.presets) {
  return normalizePresets(presets).map(preset => ({
    id: preset.id,
    colorLight: preset.colorLight,
    colorDark: preset.colorDark
  }));
}

function presetColorSnapshotsMatch(first, second) {
  return JSON.stringify(first) === JSON.stringify(second);
}

function syncPresetColorHistoryControls() {
  if (undoPresetColorsBtn) undoPresetColorsBtn.disabled = presetColorUndoStack.length === 0;
  if (redoPresetColorsBtn) redoPresetColorsBtn.disabled = presetColorRedoStack.length === 0;
}

function clearPresetColorHistory() {
  presetColorUndoStack = [];
  presetColorRedoStack = [];
  syncPresetColorHistoryControls();
}

function recordPresetColorMutation(mutation) {
  if (!pendingSettings || typeof mutation !== 'function') return;
  const before = getPresetColorSnapshot();
  mutation();
  const after = getPresetColorSnapshot();
  if (presetColorSnapshotsMatch(before, after)) return;
  presetColorUndoStack.push({ before, after });
  if (presetColorUndoStack.length > PRESET_COLOR_HISTORY_LIMIT) presetColorUndoStack.shift();
  presetColorRedoStack = [];
  syncPresetColorHistoryControls();
}

function applyPresetColorSnapshot(snapshot) {
  if (!pendingSettings || !Array.isArray(snapshot)) return false;
  const colorsById = new Map(snapshot.map(item => [item.id, item]));
  const presets = normalizePresets(pendingSettings.presets);
  let changed = false;
  presets.forEach(preset => {
    const colors = colorsById.get(preset.id);
    if (!colors || !isValidHex(colors.colorLight) || !isValidHex(colors.colorDark)) return;
    if (preset.colorLight !== colors.colorLight || preset.colorDark !== colors.colorDark) changed = true;
    preset.colorLight = colors.colorLight;
    preset.colorDark = colors.colorDark;
  });
  if (!changed) return false;

  pendingSettings.presets = presets;
  const defaultPreset = getDefaultPreset(presets);
  pendingSettings.colorLight = defaultPreset.colorLight;
  pendingSettings.colorDark = defaultPreset.colorDark;
  syncAppearanceFromPresets(presets);
  syncPresetsEditor(presets);
  rerenderFabBuilder();
  refreshTagsLibraryIfLive();
  schedulePresetSettingsSave();
  return true;
}

function undoPresetColorChange() {
  const entry = presetColorUndoStack.pop();
  if (!entry) return;
  if (applyPresetColorSnapshot(entry.before)) presetColorRedoStack.push(entry);
  syncPresetColorHistoryControls();
}

function redoPresetColorChange() {
  const entry = presetColorRedoStack.pop();
  if (!entry) return;
  if (applyPresetColorSnapshot(entry.after)) {
    presetColorUndoStack.push(entry);
    if (presetColorUndoStack.length > PRESET_COLOR_HISTORY_LIMIT) presetColorUndoStack.shift();
  }
  syncPresetColorHistoryControls();
}

undoPresetColorsBtn?.addEventListener('click', undoPresetColorChange);
redoPresetColorsBtn?.addEventListener('click', redoPresetColorChange);

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

function updatePresetNameSurfaces(presetId, name) {
  const label = name || 'Untitled';
  const presetIndex = pendingSettings?.presets?.findIndex(item => item.id === presetId) ?? -1;
  const fabLabel = name || `Tag ${presetIndex >= 0 ? presetIndex + 1 : 1}`;
  const escapedPresetId = CSS.escape(presetId);
  const paletteItem = appearancePresetSummaryEl
    ?.querySelector(`.appearance-palette-item[data-preset-id="${escapedPresetId}"]`);
  paletteItem?.querySelector('.appearance-palette-name')?.replaceChildren(label);
  if (paletteItem) {
    const preset = pendingSettings?.presets?.find(item => item.id === presetId);
    paletteItem.title = preset
      ? `${label}: ${preset.colorLight.toUpperCase()} / ${preset.colorDark.toUpperCase()}`
      : label;
    paletteItem.setAttribute('aria-label', `Preview ${label} colors`);
  }
  if (selectedAppearancePreviewPresetId === presetId) {
    if (defaultPresetNameLightEl) defaultPresetNameLightEl.textContent = label;
    if (defaultPresetNameDarkEl) defaultPresetNameDarkEl.textContent = label;
  }
  document.querySelectorAll(`[data-fab-button-id="${escapedPresetId}"]`).forEach(element => {
    const text = element.querySelector('.fab-toolbox-label, .fab-slot-label, .fab-popover-option-label');
    if (text) text.textContent = fabLabel;
    if (element.classList.contains('fab-toolbox-item')) {
      element.setAttribute('aria-label', `Drag ${fabLabel} into the FAB layout with a pointer`);
    }
    if (element.classList.contains('fab-slot-btn')) element.title = fabLabel;
    const menuButton = element.closest('.fab-slot')?.querySelector('.fab-slot-menu-btn');
    if (menuButton) {
      menuButton.title = `${fabLabel} options`;
      menuButton.setAttribute('aria-label', `${fabLabel} options`);
    }
    if (element.classList.contains('fab-preview-btn')) {
      element.title = fabLabel;
      element.setAttribute('aria-label', fabLabel);
    }
  });
}

function updatePendingPreset(presetId, update, { nameOnly = false } = {}) {
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
  if (nameOnly) updatePresetNameSurfaces(presetId, preset.name);
  else {
    syncAppearanceFromPresets(presets);
    rerenderFabBuilder();
  }
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

function autoMatchRowLightToDark(presetId, { recordHistory = true } = {}) {
  if (!pendingSettings) return;
  const row = presetRows.find(item => item.presetId === presetId);
  if (!row || !row.light || !row.dark || !row.darkHex) return;
  const applyMatch = () => {
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
  };
  if (recordHistory) recordPresetColorMutation(applyMatch);
  else applyMatch();
}

function autoMatchRowDarkToLight(presetId, { recordHistory = true } = {}) {
  if (!pendingSettings) return;
  const row = presetRows.find(item => item.presetId === presetId);
  if (!row || !row.light || !row.lightHex || !row.dark) return;
  const applyMatch = () => {
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
  };
  if (recordHistory) recordPresetColorMutation(applyMatch);
  else applyMatch();
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
  clearPresetColorHistory();
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
    }, { nameOnly: true });
  });

  row.light.addEventListener('input', (e) => {
    const hex = e.target.value;
    lastChangedSideByPreset.set(presetId, 'light');
    syncPresetMatchButton(row);
    row.lightHex.value = hex.toUpperCase();
    recordPresetColorMutation(() => {
      updatePendingPreset(presetId, preset => {
        preset.colorLight = hex;
      });
    });
  });

  row.dark.addEventListener('input', (e) => {
    const hex = e.target.value;
    lastChangedSideByPreset.set(presetId, 'dark');
    syncPresetMatchButton(row);
    row.darkHex.value = hex.toUpperCase();
    recordPresetColorMutation(() => {
      updatePendingPreset(presetId, preset => {
        preset.colorDark = hex;
      });
    });
  });

  row.lightHex.addEventListener('input', (e) => {
    let val = e.target.value || '';
    if (!val.startsWith('#')) val = '#' + val;
    if (!isValidHex(val)) return;
    lastChangedSideByPreset.set(presetId, 'light');
    syncPresetMatchButton(row);
    row.light.value = val;
    recordPresetColorMutation(() => {
      updatePendingPreset(presetId, preset => {
        preset.colorLight = val;
      });
    });
  });

  row.darkHex.addEventListener('input', (e) => {
    let val = e.target.value || '';
    if (!val.startsWith('#')) val = '#' + val;
    if (!isValidHex(val)) return;
    lastChangedSideByPreset.set(presetId, 'dark');
    syncPresetMatchButton(row);
    row.dark.value = val;
    recordPresetColorMutation(() => {
      updatePendingPreset(presetId, preset => {
        preset.colorDark = val;
      });
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
    clearPresetColorHistory();
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
  clearPresetColorHistory();

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
}

if (deleteTagPresetBtn) {
  deleteTagPresetBtn.addEventListener('click', () => {
    presetDeleteMode = !presetDeleteMode;
    syncPresetsEditor(pendingSettings?.presets || DEFAULTS.presets);
  });
}

if (autoMatchAllLightToDarkBtn) {
  autoMatchAllLightToDarkBtn.addEventListener('click', () => {
    recordPresetColorMutation(() => {
      const presets = normalizePresets(pendingSettings?.presets);
      presets.forEach(preset => {
        preset.colorDark = deriveDarkFromLight(preset.colorLight);
        lastChangedSideByPreset.set(preset.id, 'light');
      });
      pendingSettings.presets = presets;
      const defaultPreset = getDefaultPreset(presets);
      pendingSettings.colorLight = defaultPreset.colorLight;
      pendingSettings.colorDark = defaultPreset.colorDark;
      syncAppearanceFromPresets(presets);
      syncPresetsEditor(presets);
      rerenderFabBuilder();
      refreshTagsLibraryIfLive();
      schedulePresetSettingsSave();
    });
  });
}

if (autoMatchAllDarkToLightBtn) {
  autoMatchAllDarkToLightBtn.addEventListener('click', () => {
    recordPresetColorMutation(() => {
      const presets = normalizePresets(pendingSettings?.presets);
      presets.forEach(preset => {
        preset.colorLight = deriveLightFromDark(preset.colorDark);
        lastChangedSideByPreset.set(preset.id, 'dark');
      });
      pendingSettings.presets = presets;
      const defaultPreset = getDefaultPreset(presets);
      pendingSettings.colorLight = defaultPreset.colorLight;
      pendingSettings.colorDark = defaultPreset.colorDark;
      syncAppearanceFromPresets(presets);
      syncPresetsEditor(presets);
      rerenderFabBuilder();
      refreshTagsLibraryIfLive();
      schedulePresetSettingsSave();
    });
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

    clearPresetColorHistory();
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
  clearPresetColorHistory();
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
      const failed = !!chrome.runtime.lastError;
      showToast(failed ? 'Could not reset settings' : 'Reset to defaults');
      setAppearanceSaveStatus(failed ? 'error' : 'saved');
      done();
    });
  });
}

const BACKUP_FORMAT = 'highlight-backup';
const BACKUP_SCHEMA_VERSION = 1;
const MAX_BACKUP_FILE_BYTES = 25 * 1024 * 1024;
const BACKUP_REQUIRED_DATA_KEYS = [
  'settings',
  'fabLayout',
  'folders',
  'recentlyDeleted',
  'highlightIndex',
  'highlightsByUrl',
  'preferences'
];
const BACKUP_PAGE_PROTOCOLS = new Set(['http:', 'https:', 'file:', 'ftp:']);
const BACKUP_SAFE_ID_PATTERN = /^[A-Za-z0-9_-]{1,256}$/;
const BACKUP_PREFERENCE_KEYS = [
  'popupTheme',
  'popupButtonOrder',
  'lastUsedPresetId',
  'optionsSidebarCollapsed',
  'libraryFoldersExpanded'
];
const BACKUP_CORE_KEYS = [
  'highlightSettings',
  FAB_LAYOUT_KEY,
  'highlightFoldersV1',
  'recentlyDeletedHighlights',
  'highlightIndex',
  ...BACKUP_PREFERENCE_KEYS
];
const DEFAULT_POPUP_BUTTON_ORDER = ['trash', 'theme', 'settings', 'fab-toggle', 'home'];
let pendingBackupImport = null;
let backupOperationPending = false;
let backupReplacementPending = false;

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function storageGet(keys = null) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, result => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(result || {});
    });
  });
}

function storageSet(payload) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(payload, () => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve();
    });
  });
}

function storageRemove(keys) {
  if (!Array.isArray(keys) || keys.length === 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    chrome.storage.local.remove(keys, () => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve();
    });
  });
}

function waitForScopedSettingsIdle({ discardPending = false } = {}) {
  if (discardPending) cancelScopedSettingsAutosave();
  else {
    if (scopedSettingsSaveTimer) {
      clearTimeout(scopedSettingsSaveTimer);
      scopedSettingsSaveTimer = null;
    }
    flushScopedSettingsPatch();
  }
  return new Promise(resolve => {
    const check = () => {
      const hasPendingPatch = Object.keys(pendingScopedSettingsPatch).length > 0;
      if (
        !scopedSettingsWriteInFlight
        && !scopedSettingsBarrierInFlight
        && scopedSettingsBarrierQueue.length === 0
        && (discardPending || !hasPendingPatch)
      ) {
        resolve();
        return;
      }
      if (!discardPending && hasPendingPatch) flushScopedSettingsPatch();
      setTimeout(check, 20);
    };
    check();
  });
}

function normalizePopupButtonOrder(raw) {
  const source = Array.isArray(raw) ? raw : [];
  const seen = new Set();
  const order = source.filter(id => {
    if (!DEFAULT_POPUP_BUTTON_ORDER.includes(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  DEFAULT_POPUP_BUTTON_ORDER.forEach(id => {
    if (!seen.has(id)) order.push(id);
  });
  return order;
}

function normalizeBackupFabLayout(raw, presets) {
  const base = defaultFabLayout();
  const allowed = new Set([
    ...presets.map(preset => preset.id),
    ...FAB_ACTION_DEFS.map(action => action.id)
  ]);
  const source = raw == null
    ? base.slots.slice()
    : (isPlainObject(raw) && Array.isArray(raw.slots) ? raw.slots.slice(0, 8) : []);
  while (source.length < 8) source.push(null);
  const present = new Set(source.filter(slotId => typeof slotId === 'string' && allowed.has(slotId)));
  const seen = new Set();
  const slots = source.map((slotId, index) => {
    if (slotId == null) return null;
    if (typeof slotId === 'string' && allowed.has(slotId) && !seen.has(slotId)) {
      seen.add(slotId);
      return slotId;
    }
    if (typeof slotId === 'string' && allowed.has(slotId)) return null;
    if (RETIRED_FAB_ACTION_IDS.has(slotId)) return null;
    const fallback = index < 4 ? `preset${index + 1}` : null;
    if (fallback && allowed.has(fallback) && !present.has(fallback) && !seen.has(fallback)) {
      seen.add(fallback);
      return fallback;
    }
    return null;
  });
  return { rows: base.rows, cols: base.cols, slots };
}

function requireBackupId(value, label) {
  if (typeof value !== 'string' || !BACKUP_SAFE_ID_PATTERN.test(value)) {
    throw new Error(`This backup contains a malformed ${label}.`);
  }
}

function requireBackupPageUrl(value) {
  if (typeof value !== 'string' || !value || value.length > 8192) {
    throw new Error('This backup contains an unsupported page URL.');
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('This backup contains an unsupported page URL.');
  }
  if (!BACKUP_PAGE_PROTOCOLS.has(parsed.protocol) || (parsed.protocol !== 'file:' && !parsed.hostname)) {
    throw new Error('This backup contains an unsupported page URL.');
  }
}

function validateBackupHighlightPart(part) {
  if (
    !isPlainObject(part)
    || typeof part.xpath !== 'string'
    || !part.xpath
    || !Number.isInteger(part.offset)
    || part.offset < 0
    || typeof part.text !== 'string'
    || !part.text
  ) {
    throw new Error('This backup contains malformed multipart highlight data.');
  }
}

function validateBackupHighlight(highlight) {
  if (!isPlainObject(highlight)) throw new Error('This backup contains a malformed highlight record.');
  requireBackupId(highlight.id, 'highlight ID');
  if (Object.prototype.hasOwnProperty.call(highlight, 'presetId')) requireBackupId(highlight.presetId, 'tag ID');
  if (Object.prototype.hasOwnProperty.call(highlight, 'folderId')) requireBackupId(highlight.folderId, 'folder ID');
  if (Object.prototype.hasOwnProperty.call(highlight, 'favorited') && typeof highlight.favorited !== 'boolean') {
    throw new Error('This backup contains a malformed highlight record.');
  }
  if (Object.prototype.hasOwnProperty.call(highlight, 'comment') && typeof highlight.comment !== 'string') {
    throw new Error('This backup contains a malformed highlight record.');
  }
  if (typeof highlight.comment === 'string' && highlight.comment.length > 500) {
    throw new Error('This backup contains a malformed highlight record.');
  }
  if (Object.prototype.hasOwnProperty.call(highlight, 'createdAt') && !Number.isFinite(highlight.createdAt)) {
    throw new Error('This backup contains a malformed highlight record.');
  }
  if (Object.prototype.hasOwnProperty.call(highlight, 'text') && typeof highlight.text !== 'string') {
    throw new Error('This backup contains a malformed highlight record.');
  }

  if (Object.prototype.hasOwnProperty.call(highlight, 'parts')) {
    if (!Array.isArray(highlight.parts) || highlight.parts.length === 0) {
      throw new Error('This backup contains malformed multipart highlight data.');
    }
    highlight.parts.forEach(validateBackupHighlightPart);
    return;
  }

  if (
    typeof highlight.xpath !== 'string'
    || !highlight.xpath
    || !Number.isInteger(highlight.offset)
    || highlight.offset < 0
    || typeof highlight.text !== 'string'
    || !highlight.text
  ) {
    throw new Error('This backup contains a malformed highlight record.');
  }
}

function validateBackupSettings(settings) {
  if (!isPlainObject(settings) || !Array.isArray(settings.presets) || settings.presets.length === 0) {
    throw new Error('This backup contains malformed settings data.');
  }
  const presetIds = new Set();
  settings.presets.forEach(preset => {
    if (!isPlainObject(preset)) throw new Error('This backup contains malformed tag data.');
    requireBackupId(preset.id, 'tag ID');
    if (presetIds.has(preset.id)) throw new Error('This backup contains duplicate tag IDs.');
    presetIds.add(preset.id);
    if (
      typeof preset.name !== 'string'
      || !isValidHex(preset.colorLight)
      || !isValidHex(preset.colorDark)
    ) {
      throw new Error('This backup contains malformed tag data.');
    }
  });
  if (Object.prototype.hasOwnProperty.call(settings, 'showFab') && typeof settings.showFab !== 'boolean') {
    throw new Error('This backup contains malformed settings data.');
  }
}

function validateBackupData(data) {
  const missing = BACKUP_REQUIRED_DATA_KEYS.filter(key => !Object.prototype.hasOwnProperty.call(data, key));
  if (missing.length > 0) {
    throw new Error(`This backup is incomplete: missing ${missing.join(', ')}.`);
  }
  if (
    !isPlainObject(data.settings)
    || !isPlainObject(data.fabLayout)
    || !Array.isArray(data.folders)
    || !Array.isArray(data.recentlyDeleted)
    || !isPlainObject(data.highlightIndex)
    || !isPlainObject(data.highlightsByUrl)
    || !isPlainObject(data.preferences)
  ) {
    throw new Error('This backup contains malformed core data.');
  }

  validateBackupSettings(data.settings);
  const presetIds = new Set(data.settings.presets.map(preset => preset.id));
  const allowedFabIds = new Set([
    ...presetIds,
    ...FAB_ACTION_DEFS.map(action => action.id),
    ...RETIRED_FAB_ACTION_IDS
  ]);
  if (
    data.fabLayout.rows !== 2
    || data.fabLayout.cols !== 4
    || !Array.isArray(data.fabLayout.slots)
    || data.fabLayout.slots.length !== 8
    || data.fabLayout.slots.some(slot => slot !== null && (
      typeof slot !== 'string'
      || !BACKUP_SAFE_ID_PATTERN.test(slot)
      || !allowedFabIds.has(slot)
    ))
  ) {
    throw new Error('This backup contains malformed FAB layout data.');
  }

  const folderIds = new Set();
  const folderNames = new Set();
  data.folders.forEach(folder => {
    if (!isPlainObject(folder)) throw new Error('This backup contains malformed folder data.');
    requireBackupId(folder.id, 'folder ID');
    const name = typeof folder.name === 'string' ? folder.name.trim() : '';
    const foldedName = name.toLocaleLowerCase();
    if (!name || name.length > 60 || folderIds.has(folder.id) || folderNames.has(foldedName)) {
      throw new Error('This backup contains malformed folder data.');
    }
    if (Object.prototype.hasOwnProperty.call(folder, 'createdAt') && !Number.isFinite(folder.createdAt)) {
      throw new Error('This backup contains malformed folder data.');
    }
    if (Object.prototype.hasOwnProperty.call(folder, 'lastUsedAt') && !Number.isFinite(folder.lastUsedAt)) {
      throw new Error('This backup contains malformed folder data.');
    }
    folderIds.add(folder.id);
    folderNames.add(foldedName);
  });

  Object.entries(data.highlightsByUrl).forEach(([url, highlights]) => {
    requireBackupPageUrl(url);
    if (!Array.isArray(highlights)) throw new Error('This backup contains malformed highlight page data.');
    highlights.forEach(highlight => {
      validateBackupHighlight(highlight);
      if (highlight.presetId && !presetIds.has(highlight.presetId)) {
        throw new Error('This backup contains a highlight with an unknown tag ID.');
      }
      if (highlight.folderId && !folderIds.has(highlight.folderId)) {
        throw new Error('This backup contains a highlight with an unknown folder ID.');
      }
    });
  });

  Object.entries(data.highlightIndex).forEach(([url, metadata]) => {
    requireBackupPageUrl(url);
    if (
      !isPlainObject(metadata)
      || (Object.prototype.hasOwnProperty.call(metadata, 'title') && typeof metadata.title !== 'string')
      || (Object.prototype.hasOwnProperty.call(metadata, 'lastUpdated') && !Number.isFinite(metadata.lastUpdated))
    ) {
      throw new Error('This backup contains malformed page index data.');
    }
  });

  data.recentlyDeleted.forEach(entry => {
    if (!isPlainObject(entry) || !isPlainObject(entry.highlight)) {
      throw new Error('This backup contains a malformed Recently Deleted record.');
    }
    requireBackupPageUrl(entry.pageUrl);
    if (Object.prototype.hasOwnProperty.call(entry, 'trashId')) requireBackupId(entry.trashId, 'Recently Deleted ID');
    if (Object.prototype.hasOwnProperty.call(entry, 'pageTitle') && typeof entry.pageTitle !== 'string') {
      throw new Error('This backup contains a malformed Recently Deleted record.');
    }
    if (Object.prototype.hasOwnProperty.call(entry, 'deletedAt') && !Number.isFinite(entry.deletedAt)) {
      throw new Error('This backup contains a malformed Recently Deleted record.');
    }
    validateBackupHighlight(entry.highlight);
    if (entry.highlight.presetId && !presetIds.has(entry.highlight.presetId)) {
      throw new Error('This backup contains a Recently Deleted highlight with an unknown tag ID.');
    }
    if (entry.highlight.folderId && !folderIds.has(entry.highlight.folderId)) {
      throw new Error('This backup contains a Recently Deleted highlight with an unknown folder ID.');
    }
  });
}

function normalizeBackupHighlightList(raw, settings, folderIds) {
  const previousPresets = activeLibraryPresets;
  try {
    activeLibraryPresets = settings.presets.map(preset => ({ ...preset }));
    return normalizeStoredHighlights(raw).highlights.map(highlight => {
      const next = { ...highlight };
      if (typeof next.folderId === 'string' && !folderIds.has(next.folderId)) delete next.folderId;
      return next;
    });
  } finally {
    activeLibraryPresets = previousPresets;
  }
}

function normalizeBackupDocument(raw) {
  if (!isPlainObject(raw) || raw.format !== BACKUP_FORMAT) {
    throw new Error('This is not a Highlight backup file.');
  }
  if (!Number.isInteger(raw.schemaVersion)) throw new Error('The backup version is missing.');
  if (raw.schemaVersion > BACKUP_SCHEMA_VERSION) {
    throw new Error('This backup was created by a newer version of Highlight.');
  }
  if (raw.schemaVersion !== BACKUP_SCHEMA_VERSION || !isPlainObject(raw.data)) {
    throw new Error('This backup format is not supported.');
  }
  // Validate the complete replacement contract before normalization can hide corrupt input.
  validateBackupData(raw.data);

  const parsedDate = new Date(raw.exportedAt);
  if (!Number.isFinite(parsedDate.getTime())) throw new Error('The backup creation date is invalid.');
  const settings = normalizeScopedSettingsWrite(raw.data.settings, {});
  const folders = normalizeFolders(raw.data.folders);
  const folderIds = new Set(folders.map(folder => folder.id));
  const highlightsByUrl = {};
  const rawPages = isPlainObject(raw.data.highlightsByUrl) ? raw.data.highlightsByUrl : {};
  let activeHighlightCount = 0;
  let noteCount = 0;
  let favoriteCount = 0;

  Object.entries(rawPages).forEach(([url, list]) => {
    if (!url || url.length > 8192 || ['__proto__', 'prototype', 'constructor'].includes(url) || !Array.isArray(list)) return;
    const highlights = normalizeBackupHighlightList(list, settings, folderIds);
    if (highlights.length === 0) return;
    highlightsByUrl[url] = highlights;
    activeHighlightCount += highlights.length;
    noteCount += highlights.filter(highlight => normalizeComment(highlight.comment)).length;
    favoriteCount += highlights.filter(highlight => highlight.favorited === true).length;
  });

  const rawIndex = isPlainObject(raw.data.highlightIndex) ? raw.data.highlightIndex : {};
  const highlightIndex = {};
  Object.entries(highlightsByUrl).forEach(([url, highlights]) => {
    const rawMeta = isPlainObject(rawIndex[url]) ? rawIndex[url] : {};
    const latestCreated = highlights.reduce((latest, highlight) => (
      Math.max(latest, Number.isFinite(highlight.createdAt) ? highlight.createdAt : 0)
    ), 0);
    highlightIndex[url] = {
      title: typeof rawMeta.title === 'string' && rawMeta.title.trim() ? rawMeta.title : url,
      lastUpdated: Number.isFinite(rawMeta.lastUpdated) ? rawMeta.lastUpdated : (latestCreated || parsedDate.getTime())
    };
  });

  const recentlyDeleted = (Array.isArray(raw.data.recentlyDeleted) ? raw.data.recentlyDeleted : [])
    .map(entry => {
      if (!isPlainObject(entry) || !isPlainObject(entry.highlight) || typeof entry.pageUrl !== 'string') return null;
      const highlight = normalizeBackupHighlightList([entry.highlight], settings, folderIds)[0];
      if (!highlight) return null;
      return {
        trashId: typeof entry.trashId === 'string' && entry.trashId ? entry.trashId : generateTrashId(),
        pageUrl: entry.pageUrl,
        pageTitle: typeof entry.pageTitle === 'string' && entry.pageTitle ? entry.pageTitle : entry.pageUrl,
        deletedAt: Number.isFinite(entry.deletedAt) ? entry.deletedAt : parsedDate.getTime(),
        highlight
      };
    })
    .filter(Boolean);

  const preferences = isPlainObject(raw.data.preferences) ? raw.data.preferences : {};
  const presetIds = new Set(settings.presets.map(preset => preset.id));
  const normalized = {
    format: BACKUP_FORMAT,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: parsedDate.toISOString(),
    extensionVersion: typeof raw.extensionVersion === 'string' ? raw.extensionVersion : 'Unknown',
    data: {
      settings,
      fabLayout: normalizeBackupFabLayout(raw.data.fabLayout, settings.presets),
      folders,
      recentlyDeleted,
      highlightIndex,
      highlightsByUrl,
      preferences: {
        popupTheme: preferences.popupTheme === 'dark' ? 'dark' : 'light',
        popupButtonOrder: normalizePopupButtonOrder(preferences.popupButtonOrder),
        lastUsedPresetId: presetIds.has(preferences.lastUsedPresetId) ? preferences.lastUsedPresetId : 'preset1',
        optionsSidebarCollapsed: preferences.optionsSidebarCollapsed === true,
        [FOLDERS_EXPANDED_KEY]: preferences[FOLDERS_EXPANDED_KEY] === true
      }
    }
  };
  normalized.summary = {
    activeHighlights: activeHighlightCount,
    folders: folders.length,
    tags: settings.presets.length,
    notes: noteCount,
    favorites: favoriteCount,
    recentlyDeleted: recentlyDeleted.length
  };
  return normalized;
}

function createBackupDocument(storage) {
  const highlightsByUrl = {};
  Object.entries(storage).forEach(([key, value]) => {
    if (key.startsWith('highlights_') && Array.isArray(value)) {
      highlightsByUrl[key.substring('highlights_'.length)] = value;
    }
  });
  return normalizeBackupDocument({
    format: BACKUP_FORMAT,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    extensionVersion: chrome.runtime.getManifest().version,
    data: {
      settings: storage.highlightSettings || cloneDefaults(),
      fabLayout: storage[FAB_LAYOUT_KEY] || defaultFabLayout(),
      folders: storage[FOLDERS_KEY] || [],
      recentlyDeleted: storage[RECENTLY_DELETED_KEY] || [],
      highlightIndex: storage.highlightIndex || {},
      highlightsByUrl,
      preferences: {
        popupTheme: storage.popupTheme,
        popupButtonOrder: storage.popupButtonOrder,
        lastUsedPresetId: storage.lastUsedPresetId,
        optionsSidebarCollapsed: storage.optionsSidebarCollapsed,
        [FOLDERS_EXPANDED_KEY]: storage[FOLDERS_EXPANDED_KEY]
      }
    }
  });
}

function backupDocumentToStorage(backup) {
  const data = backup.data;
  const payload = {
    highlightSettings: data.settings,
    [FAB_LAYOUT_KEY]: data.fabLayout,
    [FOLDERS_KEY]: data.folders,
    [RECENTLY_DELETED_KEY]: data.recentlyDeleted,
    highlightIndex: data.highlightIndex,
    popupTheme: data.preferences.popupTheme,
    popupButtonOrder: data.preferences.popupButtonOrder,
    lastUsedPresetId: data.preferences.lastUsedPresetId,
    optionsSidebarCollapsed: data.preferences.optionsSidebarCollapsed,
    [FOLDERS_EXPANDED_KEY]: data.preferences[FOLDERS_EXPANDED_KEY]
  };
  Object.entries(data.highlightsByUrl).forEach(([url, highlights]) => {
    payload[`highlights_${url}`] = highlights;
  });
  return payload;
}

function isRecognizedBackupStorageKey(key) {
  return BACKUP_CORE_KEYS.includes(key) || key.startsWith('highlights_');
}

function getRecognizedBackupStorage(storage) {
  return Object.fromEntries(
    Object.entries(storage || {}).filter(([key]) => isRecognizedBackupStorageKey(key))
  );
}

function backupStorageValuesEqual(first, second) {
  if (Object.is(first, second)) return true;
  if (Array.isArray(first) || Array.isArray(second)) {
    return Array.isArray(first)
      && Array.isArray(second)
      && first.length === second.length
      && first.every((value, index) => backupStorageValuesEqual(value, second[index]));
  }
  if (!isPlainObject(first) || !isPlainObject(second)) return false;
  const firstKeys = Object.keys(first).sort();
  const secondKeys = Object.keys(second).sort();
  return firstKeys.length === secondKeys.length
    && firstKeys.every((key, index) => (
      key === secondKeys[index] && backupStorageValuesEqual(first[key], second[key])
    ));
}

function assertBackupStorageMatches(actual, expected) {
  const actualKeys = Object.keys(actual).sort();
  const expectedKeys = Object.keys(expected).sort();
  if (
    actualKeys.length !== expectedKeys.length
    || actualKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new Error('Storage changed while the backup was being replaced.');
  }
  if (!backupStorageValuesEqual(actual, expected)) {
    throw new Error('The final storage state does not match the selected backup.');
  }
}

async function writeExactBackupStorage(expected, { replaceAll = false } = {}) {
  const before = await storageGet(null);
  const keysToRemove = Object.keys(before).filter(key => replaceAll || isRecognizedBackupStorageKey(key));
  await storageRemove(keysToRemove);
  const payload = replaceAll ? expected : getRecognizedBackupStorage(expected);
  if (Object.keys(payload).length > 0) await storageSet(payload);
  const after = await storageGet(null);
  assertBackupStorageMatches(after, expected);
}

async function replaceBackupStorage(payload) {
  const originalSnapshot = await storageGet(null);
  const preservedStorage = Object.fromEntries(
    Object.entries(originalSnapshot).filter(([key]) => !isRecognizedBackupStorageKey(key))
  );
  const expectedImportedState = { ...preservedStorage, ...payload };

  try {
    // Remove replaceable keys first so importing does not temporarily require space for both datasets.
    await writeExactBackupStorage(expectedImportedState);
  } catch (importError) {
    try {
      // Rollback replaces the complete snapshot so a partial import cannot survive recovery.
      await writeExactBackupStorage(originalSnapshot, { replaceAll: true });
    } catch (rollbackError) {
      const criticalError = new Error('Import failed and your previous data could not be fully restored.');
      criticalError.rollbackFailed = true;
      criticalError.importError = importError;
      criticalError.rollbackError = rollbackError;
      throw criticalError;
    }
    throw importError;
  }
}

async function waitForBackupWritersIdle() {
  await waitForScopedSettingsIdle({ discardPending: true });
  while (true) {
    const highlightQueue = libraryHighlightWriteQueue;
    const folderQueue = folderMutationQueue;
    await Promise.all([
      highlightQueue.catch(() => undefined),
      folderQueue.catch(() => undefined)
    ]);
    if (highlightQueue === libraryHighlightWriteQueue && folderQueue === folderMutationQueue) return;
  }
}

function setBackupControlsBusy(isBusy) {
  backupOperationPending = isBusy;
  if (exportBackupBtn) exportBackupBtn.disabled = isBusy;
  if (importBackupBtn) importBackupBtn.disabled = isBusy;
  if (confirmBackupImportBtn) confirmBackupImportBtn.disabled = isBusy;
  if (cancelBackupImportBtn) cancelBackupImportBtn.disabled = isBusy;
  backupImportDialog?.setAttribute('aria-busy', String(isBusy));
}

async function exportBackup() {
  if (backupOperationPending) return;
  setBackupControlsBusy(true);
  try {
    await waitForScopedSettingsIdle();
    const storage = await storageGet(null);
    const backup = createBackupDocument(storage);
    const serializable = { ...backup };
    delete serializable.summary;
    const blob = new Blob([JSON.stringify(serializable, null, 2) + '\n'], { type: 'application/json' });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = `highlight-backup-${backup.exportedAt.slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
    showToast('Backup exported');
  } catch {
    showToast('Could not export backup');
  } finally {
    setBackupControlsBusy(false);
  }
}

function formatBackupDate(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    : 'Unknown';
}

function openBackupImportPreview(backup) {
  pendingBackupImport = backup;
  if (backupImportCreated) backupImportCreated.textContent = formatBackupDate(backup.exportedAt);
  if (backupImportVersion) backupImportVersion.textContent = backup.extensionVersion || 'Unknown';
  if (backupImportError) backupImportError.textContent = '';
  if (backupImportSummary) {
    const rows = [
      ['Highlights', backup.summary.activeHighlights],
      ['Folders', backup.summary.folders],
      ['Tags', backup.summary.tags],
      ['Notes', backup.summary.notes],
      ['Favorites', backup.summary.favorites],
      ['Recently Deleted', backup.summary.recentlyDeleted]
    ];
    backupImportSummary.replaceChildren(...rows.map(([label, count]) => {
      const item = document.createElement('li');
      const strong = document.createElement('strong');
      strong.textContent = String(count);
      item.append(strong, label);
      return item;
    }));
  }
  if (!backupImportDialog || typeof backupImportDialog.showModal !== 'function') return;
  backupImportDialog.returnValue = '';
  backupImportDialog.showModal();
  requestAnimationFrame(() => cancelBackupImportBtn?.focus({ preventScroll: true }));
}

async function readBackupFile(file) {
  if (!file) return;
  if (file.size > MAX_BACKUP_FILE_BYTES) throw new Error('This backup is larger than 25 MB.');
  let parsed;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new Error('The selected file is not valid JSON.');
  }
  return normalizeBackupDocument(parsed);
}

async function importPendingBackup() {
  if (!pendingBackupImport || backupOperationPending) return;
  setBackupControlsBusy(true);
  backupReplacementPending = true;
  if (backupImportError) backupImportError.textContent = '';
  try {
    await waitForBackupWritersIdle();
    const payload = backupDocumentToStorage(pendingBackupImport);
    await replaceBackupStorage(payload);
    clearPresetColorHistory();
    pendingBackupImport = null;
    backupImportDialog?.close('imported');
    showToast('Backup imported');
    setTimeout(() => window.location.reload(), 450);
  } catch (error) {
    const rollbackFailed = error && error.rollbackFailed === true;
    if (backupImportError) {
      backupImportError.textContent = rollbackFailed
        ? 'Critical error: the import failed and your previous data could not be fully restored. Your stored data may be incomplete.'
        : 'Could not replace your data. Your previous data was restored.';
    }
    showToast(rollbackFailed ? 'Critical storage recovery failure' : 'Backup import failed');
    setBackupControlsBusy(false);
  } finally {
    backupReplacementPending = false;
  }
}

// ---- Button handlers ----

exportBackupBtn?.addEventListener('click', exportBackup);

importBackupBtn?.addEventListener('click', () => {
  if (backupOperationPending || !importBackupInput) return;
  importBackupInput.value = '';
  importBackupInput.click();
});

importBackupInput?.addEventListener('change', async () => {
  const file = importBackupInput.files?.[0];
  if (!file) return;
  setBackupControlsBusy(true);
  try {
    const backup = await readBackupFile(file);
    setBackupControlsBusy(false);
    openBackupImportPreview(backup);
  } catch (error) {
    setBackupControlsBusy(false);
    showToast(error instanceof Error ? error.message : 'Could not read backup');
  } finally {
    importBackupInput.value = '';
  }
});

cancelBackupImportBtn?.addEventListener('click', () => backupImportDialog?.close('cancel'));
confirmBackupImportBtn?.addEventListener('click', importPendingBackup);
backupImportDialog?.addEventListener('cancel', event => {
  if (backupOperationPending) event.preventDefault();
});
backupImportDialog?.addEventListener('close', () => {
  if (backupImportDialog.returnValue !== 'imported') pendingBackupImport = null;
  if (!backupOperationPending) importBackupBtn?.focus({ preventScroll: true });
  if (backupImportError) backupImportError.textContent = '';
});

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
  // Open the browser-managed extension shortcut page in a new tab.
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
