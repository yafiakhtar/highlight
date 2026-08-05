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
    title: 'Comments',
    description: 'Review highlights with comments and notes.'
  },
  folders: {
    title: 'Folders',
    description: 'Create folders and organize highlights into one place.'
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
  if (persist) chrome.storage.local.set({ [FOLDERS_EXPANDED_KEY]: foldersExpandedPreference });
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
  chrome.storage.local.get([FOLDERS_KEY, FOLDERS_EXPANDED_KEY], result => {
    activeLibraryFolders = normalizeFolders(result[FOLDERS_KEY]);
    renderLibraryFolderChildren();
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
  { id: 'favorite', label: 'Favorite', type: 'action', glyph: '☆', paletteGlyph: '☆' },
  { id: 'folder', label: 'Folder', type: 'action', glyph: '', paletteGlyph: '', icon: 'folder' },
  { id: 'close', label: 'Close', type: 'action', glyph: '', paletteGlyph: '', icon: 'close' },
  { id: 'comment', label: 'Comment', type: 'action', glyph: '', paletteGlyph: '', icon: 'comment' },
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
      iconName: def.icon,
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
    defs.filter(def => def.type === 'action')
  ));
  popover.appendChild(createFabPickerGroup(
    'Coming soon',
    defs.filter(def => def.type === 'placeholder')
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
  fabToolboxEl.appendChild(createFabToolboxGroup(
    'Coming soon',
    defs.filter(def => def.type === 'placeholder')
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
const libraryTagPopoverLayerEl = document.getElementById('libraryTagPopoverLayer');
const libraryFolderPopoverLayerEl = document.getElementById('libraryFolderPopoverLayer');
const libraryCommentPopoverLayerEl = document.getElementById('libraryCommentPopoverLayer');

let libraryQuery = '';
let librarySearchDebounce = null;
let currentLibraryTagPopover = null;
let currentLibraryTagPopoverAnchor = null;
let libraryTagPopoverCleanupTimer = null;
let libraryTagPopoverListenersInitialized = false;
let pendingLibraryTagFocus = null;
let currentLibraryFolderPopover = null;
let currentLibraryFolderPopoverAnchor = null;
let libraryFolderPopoverCleanupTimer = null;
let libraryFolderPopoverRequestVersion = 0;
let libraryFolderPopoverListenersInitialized = false;
let pendingLibraryFolderFocus = null;
let currentLibraryCommentPopover = null;
let currentLibraryCommentPopoverAnchor = null;
let libraryCommentPopoverCleanupTimer = null;
let libraryCommentPopoverListenersInitialized = false;
let libraryHighlightWriteQueue = Promise.resolve();
let pendingLibraryCommentFocus = null;
let libraryCommentDeleteTarget = null;
let libraryCommentDeleteTrigger = null;

const RECENTLY_DELETED_KEY = 'recentlyDeletedHighlights';
const FOLDERS_KEY = 'highlightFoldersV1';
const FOLDERS_EXPANDED_KEY = 'libraryFoldersExpanded';
const MAX_FOLDER_NAME_LENGTH = 60;
const RECENT_FOLDER_LIMIT = 5;
const MAX_COMMENT_LENGTH = 500;

function normalizeComment(value) {
  return typeof value === 'string'
    ? value.replace(/\r\n?/g, '\n').trim().slice(0, MAX_COMMENT_LENGTH)
    : '';
}

let activeLibraryFolders = [];
let currentFolderId = null;
let editingFolderId = null;
let folderDeleteMode = false;
let folderDeleteTargetId = null;
let folderDeleteTrigger = null;
let folderMutationQueue = Promise.resolve();
const folderDeleteDialog = document.getElementById('folderDeleteDialog');
const folderDeleteDialogTitle = document.getElementById('folderDeleteDialogTitle');
const folderDeleteDialogDescription = document.getElementById('folderDeleteDialogDescription');
const cancelFolderDeleteBtn = document.getElementById('cancelFolderDeleteBtn');
const keepFolderHighlightsBtn = document.getElementById('keepFolderHighlightsBtn');
const deleteFolderHighlightsBtn = document.getElementById('deleteFolderHighlightsBtn');
const commentDeleteDialog = document.getElementById('commentDeleteDialog');
const cancelCommentDeleteBtn = document.getElementById('cancelCommentDeleteBtn');
const confirmCommentDeleteBtn = document.getElementById('confirmCommentDeleteBtn');

function normalizeFolderName(name) {
  return (name || '').toString().replace(/\s+/g, ' ').trim().slice(0, MAX_FOLDER_NAME_LENGTH);
}

function generateFolderId() {
  return 'folder_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
}

function normalizeFolders(rawFolders) {
  if (!Array.isArray(rawFolders)) return [];
  const seenIds = new Set();
  const seenNames = new Set();
  const folders = [];
  rawFolders.forEach(raw => {
    if (!raw || typeof raw !== 'object') return;
    const name = normalizeFolderName(raw.name);
    const normalizedName = name.toLocaleLowerCase();
    if (!name || seenNames.has(normalizedName)) return;
    let id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : generateFolderId();
    if (seenIds.has(id)) id = generateFolderId();
    seenIds.add(id);
    seenNames.add(normalizedName);
    const createdAt = Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now();
    folders.push({
      id,
      name,
      createdAt,
      lastUsedAt: Number.isFinite(raw.lastUsedAt) ? raw.lastUsedAt : createdAt
    });
  });
  return folders;
}

function sortFoldersByName(folders) {
  return folders.slice().sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

function getFolderById(folderId, folders = activeLibraryFolders) {
  return folders.find(folder => folder.id === folderId) || null;
}

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
      const comment = normalizeComment(one.comment);
      if (comment) {
        if (one.comment !== comment) changed = true;
        one.comment = comment;
      } else if (Object.prototype.hasOwnProperty.call(one, 'comment')) {
        delete one.comment;
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
    const folderId = items.find(it => typeof it?.folderId === 'string' && it.folderId.trim())?.folderId || null;
    const comment = items.map(it => normalizeComment(it?.comment)).find(Boolean) || '';
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
    if (folderId) out.folderId = folderId;
    else delete out.folderId;
    if (comment) out.comment = comment;
    else delete out.comment;

    merged.push(out);
  }

  return { highlights: merged, changed };
}

function refreshLibrary() {
  closeLibraryTagPopover({ immediate: true });
  closeLibraryFolderPopover({ immediate: true });
  closeLibraryCommentPopover({ immediate: true });
  syncLibraryViewHeader();
  if (currentLibraryView === 'recently-deleted') {
    loadRecentlyDeleted();
  } else if (currentLibraryView === 'folders') {
    loadFoldersView();
  } else if (currentLibraryView === 'tags') {
    loadTagsView();
  } else if (currentLibraryView === 'comments') {
    loadCommentHighlights();
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

function prefersReducedLibraryMotion() {
  return typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function closeLibraryTagPopover({ immediate = false, restoreFocus = false } = {}) {
  if (libraryTagPopoverCleanupTimer) {
    clearTimeout(libraryTagPopoverCleanupTimer);
    libraryTagPopoverCleanupTimer = null;
  }

  const popover = currentLibraryTagPopover;
  const anchor = currentLibraryTagPopoverAnchor;
  currentLibraryTagPopover = null;
  currentLibraryTagPopoverAnchor = null;

  if (anchor) anchor.setAttribute('aria-expanded', 'false');
  if (restoreFocus && anchor?.isConnected) {
    anchor.focus({ preventScroll: true });
  }

  if (!popover) {
    if (immediate && libraryTagPopoverLayerEl) libraryTagPopoverLayerEl.innerHTML = '';
    return;
  }

  const removePopover = () => {
    if (popover.parentNode) popover.parentNode.removeChild(popover);
  };

  if (immediate || prefersReducedLibraryMotion()) {
    removePopover();
    return;
  }

  popover.classList.remove('is-open');
  popover.classList.add('is-closing');
  popover.setAttribute('aria-hidden', 'true');
  popover.addEventListener('transitionend', removePopover, { once: true });
  libraryTagPopoverCleanupTimer = setTimeout(removePopover, 220);
}

function positionLibraryTagPopover(popover, anchor) {
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

function getLibraryPresetColor(preset) {
  return document.body.classList.contains('dark')
    ? (preset.colorDark || DEFAULTS.colorDark)
    : (preset.colorLight || DEFAULTS.colorLight);
}

function patchStoredHighlightPreset(pageUrl, highlightId, requestedPresetId) {
  const key = 'highlights_' + pageUrl;
  return new Promise((resolve, reject) => {
    chrome.storage.local.get([key, 'highlightSettings'], (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      const storedSettings = result.highlightSettings || DEFAULTS;
      const presets = normalizePresets(storedSettings.presets);
      const fallbackPreset = presets.find(preset => preset.id === 'preset1') || presets[0];
      const targetPreset = presets.find(preset => preset.id === requestedPresetId) || fallbackPreset;
      const highlights = result[key];
      if (!Array.isArray(highlights) || !targetPreset) {
        resolve({ status: 'missing' });
        return;
      }

      let found = false;
      let changed = false;
      const next = highlights.map(highlight => {
        if (!highlight || highlight.id !== highlightId) return highlight;
        found = true;
        if (getHighlightPresetId(highlight) === targetPreset.id) return highlight;
        changed = true;
        return { ...highlight, presetId: targetPreset.id };
      });

      if (!found) {
        resolve({ status: 'missing' });
        return;
      }
      if (!changed) {
        resolve({ status: 'unchanged', preset: targetPreset });
        return;
      }

      chrome.storage.local.set({ [key]: next }, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve({ status: 'changed', preset: targetPreset });
      });
    });
  });
}

function reassignLibraryHighlightTag(pageUrl, highlightId, presetId) {
  pendingLibraryTagFocus = { pageUrl, highlightId };
  closeLibraryTagPopover({ immediate: true });
  queueLibraryHighlightMutation(() => patchStoredHighlightPreset(pageUrl, highlightId, presetId)).then(result => {
    if (result.status === 'changed') {
      showToast(`Changed tag to ${result.preset.name || 'Untitled'}`);
    } else if (result.status === 'unchanged') {
      restorePendingLibraryTagSelectorFocus();
    } else if (result.status === 'missing') {
      pendingLibraryTagFocus = null;
      showToast('Highlight is no longer available');
      refreshLibrary();
    }
  }).catch(() => {
    pendingLibraryTagFocus = null;
    showToast('Could not change tag');
    refreshLibrary();
  });
}

function restorePendingLibraryTagSelectorFocus() {
  if (!pendingLibraryTagFocus) return;
  const focusTarget = pendingLibraryTagFocus;
  pendingLibraryTagFocus = null;
  requestAnimationFrame(() => {
    const selector = Array.from(highlightsContainer.querySelectorAll('.snippet-tag-selector')).find(button => (
      button.dataset.pageUrl === focusTarget.pageUrl
      && button.dataset.highlightId === focusTarget.highlightId
    ));
    selector?.focus({ preventScroll: true });
  });
}

function openTagPresetSettingsFromLibrary() {
  closeLibraryTagPopover({ immediate: true });
  activateMainTab('settings');
  requestAnimationFrame(() => {
    scrollToSettingsSection('presets-tags', { focusHeading: true });
  });
}

function createLibraryTagOption(preset, currentPresetId, pageUrl, highlightId) {
  const option = document.createElement('button');
  const isCurrent = preset.id === currentPresetId;
  option.type = 'button';
  option.className = 'fab-popover-option library-tag-option';
  option.setAttribute('role', 'menuitemradio');
  option.setAttribute('aria-checked', String(isCurrent));

  const swatch = document.createElement('span');
  swatch.className = 'fab-popover-option-icon library-tag-option-swatch';
  swatch.style.backgroundColor = getLibraryPresetColor(preset);
  swatch.setAttribute('aria-hidden', 'true');

  const label = document.createElement('span');
  label.className = 'fab-popover-option-label library-tag-option-label';
  label.textContent = preset.name || 'Untitled';

  const check = document.createElement('span');
  check.innerHTML = libraryIconMarkup('check');
  const checkSvg = check.firstElementChild;
  checkSvg.classList.add('library-tag-option-check');

  option.appendChild(swatch);
  option.appendChild(label);
  option.appendChild(checkSvg);
  option.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    if (isCurrent) {
      closeLibraryTagPopover({ restoreFocus: true });
      return;
    }
    reassignLibraryHighlightTag(pageUrl, highlightId, preset.id);
  });
  return option;
}

function openLibraryTagPopover(anchor, pageUrl, highlight) {
  if (!libraryTagPopoverLayerEl || !anchor || !highlight) return;
  if (currentLibraryTagPopoverAnchor === anchor) {
    closeLibraryTagPopover({ restoreFocus: true });
    return;
  }

  closeFabPopover({ immediate: true });
  closeLibraryTagPopover({ immediate: true });
  closeLibraryCommentPopover({ immediate: true });

  const currentPreset = getLibraryPresetForHighlight(highlight);
  const popover = document.createElement('div');
  popover.className = 'fab-popover library-tag-popover';
  popover.setAttribute('role', 'menu');
  popover.setAttribute('aria-label', `Change tag from ${currentPreset.name || 'Untitled'}`);

  const title = document.createElement('div');
  title.className = 'fab-popover-title';
  title.textContent = 'Change tag';
  title.setAttribute('role', 'presentation');

  const list = document.createElement('div');
  list.className = 'library-tag-popover-list';
  list.setAttribute('role', 'presentation');
  activeLibraryPresets.forEach(preset => {
    list.appendChild(createLibraryTagOption(preset, currentPreset.id, pageUrl, highlight.id));
  });

  const footer = document.createElement('div');
  footer.className = 'library-tag-popover-footer';
  footer.setAttribute('role', 'presentation');
  const manage = document.createElement('button');
  manage.type = 'button';
  manage.className = 'fab-popover-option library-tag-manage';
  manage.setAttribute('role', 'menuitem');
  manage.innerHTML = '<span>Manage Tag Presets</span><span aria-hidden="true">→</span>';
  manage.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    openTagPresetSettingsFromLibrary();
  });
  footer.appendChild(manage);

  popover.appendChild(title);
  popover.appendChild(list);
  popover.appendChild(footer);
  popover.addEventListener('keydown', event => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const items = Array.from(popover.querySelectorAll('button:not(:disabled)'));
    if (items.length === 0) return;
    event.preventDefault();
    const currentIndex = items.indexOf(document.activeElement);
    let nextIndex = 0;
    if (event.key === 'End') nextIndex = items.length - 1;
    else if (event.key === 'ArrowDown') nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % items.length;
    else if (event.key === 'ArrowUp') nextIndex = currentIndex < 0 ? items.length - 1 : (currentIndex - 1 + items.length) % items.length;
    items[nextIndex].focus({ preventScroll: true });
  });

  libraryTagPopoverLayerEl.replaceChildren(popover);
  currentLibraryTagPopover = popover;
  currentLibraryTagPopoverAnchor = anchor;
  anchor.setAttribute('aria-expanded', 'true');
  positionLibraryTagPopover(popover, anchor);

  requestAnimationFrame(() => {
    if (currentLibraryTagPopover !== popover) return;
    popover.classList.add('is-open');
    const currentOption = popover.querySelector('[aria-checked="true"]');
    (currentOption || popover.querySelector('button'))?.focus({ preventScroll: true });
  });
}

function createLibraryTagSelector(pageUrl, highlight) {
  const preset = getLibraryPresetForHighlight(highlight);
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'snippet-tag-selector';
  button.title = `Change tag: ${preset.name || 'Untitled'}`;
  button.setAttribute('aria-label', `Change tag. Current tag: ${preset.name || 'Untitled'}`);
  button.setAttribute('aria-haspopup', 'menu');
  button.setAttribute('aria-expanded', 'false');
  button.dataset.pageUrl = pageUrl;
  button.dataset.highlightId = highlight.id;

  const dot = document.createElement('span');
  dot.className = 'snippet-color-dot';
  dot.style.backgroundColor = getLibraryPresetColor(preset);
  dot.setAttribute('aria-hidden', 'true');

  const chevron = document.createElement('span');
  chevron.innerHTML = libraryIconMarkup('chevron');
  const chevronSvg = chevron.firstElementChild;

  button.appendChild(dot);
  button.appendChild(chevronSvg);
  button.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    openLibraryTagPopover(button, pageUrl, highlight);
  });
  return button;
}

function initLibraryTagPopoverInteractions() {
  if (libraryTagPopoverListenersInitialized) return;
  libraryTagPopoverListenersInitialized = true;

  document.addEventListener('pointerdown', event => {
    if (!currentLibraryTagPopover) return;
    if (currentLibraryTagPopover.contains(event.target)) return;
    if (currentLibraryTagPopoverAnchor?.contains(event.target)) return;
    closeLibraryTagPopover();
  });
  document.addEventListener('focusin', event => {
    if (!currentLibraryTagPopover) return;
    if (currentLibraryTagPopover.contains(event.target)) return;
    if (currentLibraryTagPopoverAnchor?.contains(event.target)) return;
    closeLibraryTagPopover();
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !currentLibraryTagPopover) return;
    event.preventDefault();
    closeLibraryTagPopover({ restoreFocus: true });
  });
  window.addEventListener('resize', () => closeLibraryTagPopover());
  window.addEventListener('scroll', event => {
    if (currentLibraryTagPopover && !currentLibraryTagPopover.contains(event.target)) {
      closeLibraryTagPopover();
    }
  }, true);
}

function closeLibraryFolderPopover({ immediate = false, restoreFocus = false } = {}) {
  libraryFolderPopoverRequestVersion++;
  if (libraryFolderPopoverCleanupTimer) {
    clearTimeout(libraryFolderPopoverCleanupTimer);
    libraryFolderPopoverCleanupTimer = null;
  }
  const popover = currentLibraryFolderPopover;
  const anchor = currentLibraryFolderPopoverAnchor;
  currentLibraryFolderPopover = null;
  currentLibraryFolderPopoverAnchor = null;
  if (anchor) anchor.setAttribute('aria-expanded', 'false');
  if (restoreFocus && anchor?.isConnected) anchor.focus({ preventScroll: true });
  if (!popover) {
    if (immediate && libraryFolderPopoverLayerEl) libraryFolderPopoverLayerEl.innerHTML = '';
    return;
  }
  const remove = () => popover.remove();
  if (immediate || prefersReducedLibraryMotion()) {
    remove();
    return;
  }
  popover.classList.remove('is-open');
  popover.classList.add('is-closing');
  popover.setAttribute('aria-hidden', 'true');
  popover.addEventListener('transitionend', remove, { once: true });
  libraryFolderPopoverCleanupTimer = setTimeout(remove, 220);
}

function patchLibraryHighlightFolder(pageUrl, highlightId, requestedFolderId, createName = '') {
  const key = 'highlights_' + pageUrl;
  return new Promise((resolve, reject) => {
    chrome.storage.local.get([key, FOLDERS_KEY], result => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      let folders = normalizeFolders(result[FOLDERS_KEY]);
      const highlights = Array.isArray(result[key]) ? result[key] : [];
      const index = highlights.findIndex(highlight => highlight?.id === highlightId);
      if (index < 0) {
        resolve({ status: 'missing' });
        return;
      }

      let folder = requestedFolderId ? folders.find(item => item.id === requestedFolderId) : null;
      const normalizedCreateName = normalizeFolderName(createName);
      if (normalizedCreateName) {
        folder = folders.find(item => item.name.toLocaleLowerCase() === normalizedCreateName.toLocaleLowerCase()) || null;
        if (!folder) {
          const now = Date.now();
          folder = { id: generateFolderId(), name: normalizedCreateName, createdAt: now, lastUsedAt: now };
          folders = [...folders, folder];
        }
      }

      const currentFolderId = typeof highlights[index].folderId === 'string' ? highlights[index].folderId : null;
      const nextFolderId = folder?.id || null;
      if (currentFolderId === nextFolderId && !normalizedCreateName) {
        resolve({ status: 'unchanged', folder });
        return;
      }

      const nextHighlight = { ...highlights[index] };
      if (nextFolderId) nextHighlight.folderId = nextFolderId;
      else delete nextHighlight.folderId;
      const nextHighlights = highlights.slice();
      nextHighlights[index] = nextHighlight;
      if (folder) {
        const usedAt = Date.now();
        folders = folders.map(item => item.id === folder.id ? { ...item, lastUsedAt: usedAt } : item);
        folder = folders.find(item => item.id === folder.id);
      }

      chrome.storage.local.set({ [key]: nextHighlights, [FOLDERS_KEY]: folders }, () => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve({ status: 'changed', folder });
      });
    });
  });
}

function restorePendingLibraryFolderSelectorFocus() {
  if (!pendingLibraryFolderFocus) return;
  const target = pendingLibraryFolderFocus;
  pendingLibraryFolderFocus = null;
  requestAnimationFrame(() => {
    const selector = Array.from(highlightsContainer.querySelectorAll('.snippet-folder-selector')).find(button => (
      button.dataset.pageUrl === target.pageUrl && button.dataset.highlightId === target.highlightId
    ));
    selector?.focus({ preventScroll: true });
  });
}

function assignLibraryHighlightFolder(pageUrl, highlightId, folderId, createName = '') {
  pendingLibraryFolderFocus = { pageUrl, highlightId };
  closeLibraryFolderPopover({ immediate: true });
  queueLibraryHighlightMutation(() => (
    queueFolderMutation(() => patchLibraryHighlightFolder(pageUrl, highlightId, folderId, createName))
  ))
    .then(result => {
      if (result.status === 'changed') {
        showToast(result.folder ? `Added to ${result.folder.name}` : 'Removed from folder');
      } else if (result.status === 'unchanged') {
        restorePendingLibraryFolderSelectorFocus();
      } else {
        pendingLibraryFolderFocus = null;
        showToast('Highlight is no longer available');
        refreshLibrary();
      }
    })
    .catch(() => {
      pendingLibraryFolderFocus = null;
      showToast('Could not update folder');
      refreshLibrary();
    });
}

function createLibraryFolderPickerOption(folder, currentFolderId, onSelect) {
  const option = document.createElement('button');
  option.type = 'button';
  option.className = 'fab-popover-option folder-picker-option';
  option.classList.toggle('is-current', folder.id === currentFolderId);
  option.setAttribute('role', 'option');
  option.setAttribute('aria-selected', String(folder.id === currentFolderId));
  const icon = document.createElement('span');
  icon.className = 'fab-popover-option-icon';
  icon.innerHTML = libraryIconMarkup('folder');
  const label = document.createElement('span');
  label.className = 'fab-popover-option-label';
  label.textContent = folder.name;
  option.append(icon, label);
  if (folder.id === currentFolderId) {
    const check = document.createElement('span');
    check.textContent = '✓';
    check.setAttribute('aria-hidden', 'true');
    option.appendChild(check);
  }
  option.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    onSelect();
  });
  return option;
}

function renderLibraryFolderPickerResults(list, query, folders, currentFolderId, pageUrl, highlightId) {
  list.innerHTML = '';
  const normalizedQuery = normalizeFolderName(query);
  const shownFolders = normalizedQuery
    ? sortFoldersByName(folders.filter(folder => folder.name.toLocaleLowerCase().includes(normalizedQuery.toLocaleLowerCase())))
    : folders.slice().sort((a, b) => b.lastUsedAt - a.lastUsedAt).slice(0, RECENT_FOLDER_LIMIT);

  const heading = document.createElement('div');
  heading.className = 'folder-picker-heading';
  heading.textContent = normalizedQuery ? 'Results' : 'Recent folders';
  list.appendChild(heading);

  if (currentFolderId && !normalizedQuery) {
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'fab-popover-option folder-picker-option is-danger';
    remove.setAttribute('role', 'option');
    remove.innerHTML = `<span class="fab-popover-option-icon">×</span><span class="fab-popover-option-label">Remove from folder</span>`;
    remove.addEventListener('click', () => assignLibraryHighlightFolder(pageUrl, highlightId, null));
    list.appendChild(remove);
  }

  shownFolders.forEach(folder => {
    list.appendChild(createLibraryFolderPickerOption(folder, currentFolderId, () => {
      assignLibraryHighlightFolder(pageUrl, highlightId, folder.id);
    }));
  });

  const exactMatch = folders.some(folder => folder.name.toLocaleLowerCase() === normalizedQuery.toLocaleLowerCase());
  if (normalizedQuery && !exactMatch) {
    const create = document.createElement('button');
    create.type = 'button';
    create.className = 'fab-popover-option folder-picker-create';
    create.innerHTML = `${libraryIconMarkup('plus')}<span class="fab-popover-option-label"></span>`;
    create.querySelector('svg')?.classList.add('fab-popover-option-icon');
    create.querySelector('.fab-popover-option-label').textContent = `Create “${normalizedQuery}”`;
    create.addEventListener('click', () => assignLibraryHighlightFolder(pageUrl, highlightId, null, normalizedQuery));
    list.appendChild(create);
  } else if (shownFolders.length === 0 && !currentFolderId) {
    const empty = document.createElement('div');
    empty.className = 'folder-picker-empty';
    empty.textContent = normalizedQuery ? 'No matching folders' : 'No folders yet. Search to create one.';
    list.appendChild(empty);
  }
}

function openLibraryFolderPopover(anchor, pageUrl, highlight) {
  if (!libraryFolderPopoverLayerEl || !anchor || !highlight) return;
  if (currentLibraryFolderPopoverAnchor === anchor) {
    closeLibraryFolderPopover({ restoreFocus: true });
    return;
  }
  closeLibraryTagPopover({ immediate: true });
  closeLibraryFolderPopover({ immediate: true });
  closeLibraryCommentPopover({ immediate: true });
  const requestVersion = ++libraryFolderPopoverRequestVersion;
  chrome.storage.local.get(FOLDERS_KEY, result => {
    if (requestVersion !== libraryFolderPopoverRequestVersion || !anchor.isConnected) return;
    activeLibraryFolders = normalizeFolders(result[FOLDERS_KEY]);
    const currentFolder = getFolderById(highlight.folderId);
    const popover = document.createElement('div');
    popover.className = 'fab-popover library-folder-popover';
    popover.setAttribute('role', 'dialog');
    popover.setAttribute('aria-label', 'Choose folder');

    const searchWrap = document.createElement('div');
    searchWrap.className = 'folder-picker-search-wrap';
    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'folder-picker-search';
    search.placeholder = 'Search folders…';
    search.maxLength = MAX_FOLDER_NAME_LENGTH;
    search.setAttribute('aria-label', 'Search or create folders');
    searchWrap.appendChild(search);
    const list = document.createElement('div');
    list.className = 'library-tag-popover-list';
    list.setAttribute('role', 'listbox');
    renderLibraryFolderPickerResults(list, '', activeLibraryFolders, currentFolder?.id || null, pageUrl, highlight.id);
    search.addEventListener('input', () => {
      renderLibraryFolderPickerResults(list, search.value, activeLibraryFolders, currentFolder?.id || null, pageUrl, highlight.id);
    });

    const footer = document.createElement('div');
    footer.className = 'library-tag-popover-footer';
    const manage = document.createElement('button');
    manage.type = 'button';
    manage.className = 'fab-popover-option library-tag-manage';
    manage.innerHTML = '<span>Manage Folders</span><span aria-hidden="true">→</span>';
    manage.addEventListener('click', () => {
      closeLibraryFolderPopover({ immediate: true });
      switchSidebarView('library', 'folders');
      requestAnimationFrame(() => document.getElementById('libraryViewHeading')?.focus({ preventScroll: true }));
    });
    footer.appendChild(manage);
    popover.append(searchWrap, list, footer);
    popover.addEventListener('keydown', event => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      const buttons = Array.from(popover.querySelectorAll('button:not(:disabled)'));
      if (buttons.length === 0) return;
      event.preventDefault();
      const currentIndex = buttons.indexOf(document.activeElement);
      let nextIndex = 0;
      if (event.key === 'End') nextIndex = buttons.length - 1;
      else if (event.key === 'ArrowDown') nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % buttons.length;
      else if (event.key === 'ArrowUp') nextIndex = currentIndex < 0 ? buttons.length - 1 : (currentIndex - 1 + buttons.length) % buttons.length;
      buttons[nextIndex].focus({ preventScroll: true });
    });

    libraryFolderPopoverLayerEl.replaceChildren(popover);
    currentLibraryFolderPopover = popover;
    currentLibraryFolderPopoverAnchor = anchor;
    anchor.setAttribute('aria-expanded', 'true');
    positionLibraryTagPopover(popover, anchor);
    requestAnimationFrame(() => {
      if (currentLibraryFolderPopover !== popover) return;
      popover.classList.add('is-open');
      search.focus({ preventScroll: true });
    });
  });
}

function createLibraryFolderSelector(pageUrl, highlight) {
  const folder = getFolderById(highlight.folderId);
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'snippet-folder-selector';
  button.classList.toggle('has-folder', Boolean(folder));
  button.innerHTML = libraryIconMarkup('folder');
  button.title = folder ? `Folder: ${folder.name}` : 'Add to folder';
  button.setAttribute('aria-label', folder ? `Change folder. Current folder: ${folder.name}` : 'Add highlight to folder');
  button.setAttribute('aria-haspopup', 'dialog');
  button.setAttribute('aria-expanded', 'false');
  button.dataset.pageUrl = pageUrl;
  button.dataset.highlightId = highlight.id;
  button.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    openLibraryFolderPopover(button, pageUrl, highlight);
  });
  return button;
}

function initLibraryFolderPopoverInteractions() {
  if (libraryFolderPopoverListenersInitialized) return;
  libraryFolderPopoverListenersInitialized = true;
  document.addEventListener('pointerdown', event => {
    if (!currentLibraryFolderPopover) return;
    if (currentLibraryFolderPopover.contains(event.target)) return;
    if (currentLibraryFolderPopoverAnchor?.contains(event.target)) return;
    closeLibraryFolderPopover();
  });
  document.addEventListener('focusin', event => {
    if (!currentLibraryFolderPopover) return;
    if (currentLibraryFolderPopover.contains(event.target)) return;
    if (currentLibraryFolderPopoverAnchor?.contains(event.target)) return;
    closeLibraryFolderPopover();
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !currentLibraryFolderPopover) return;
    event.preventDefault();
    closeLibraryFolderPopover({ restoreFocus: true });
  });
  window.addEventListener('resize', () => closeLibraryFolderPopover());
  window.addEventListener('scroll', event => {
    if (currentLibraryFolderPopover && !currentLibraryFolderPopover.contains(event.target)) closeLibraryFolderPopover();
  }, true);
}

function closeLibraryCommentPopover({ immediate = false, restoreFocus = false } = {}) {
  if (libraryCommentPopoverCleanupTimer) {
    clearTimeout(libraryCommentPopoverCleanupTimer);
    libraryCommentPopoverCleanupTimer = null;
  }
  const popover = currentLibraryCommentPopover;
  const anchor = currentLibraryCommentPopoverAnchor;
  currentLibraryCommentPopover = null;
  currentLibraryCommentPopoverAnchor = null;
  if (anchor) anchor.setAttribute('aria-expanded', 'false');
  if (restoreFocus && anchor?.isConnected) anchor.focus({ preventScroll: true });
  if (!popover) {
    if (immediate && libraryCommentPopoverLayerEl) libraryCommentPopoverLayerEl.innerHTML = '';
    return;
  }
  const remove = () => popover.remove();
  if (immediate || prefersReducedLibraryMotion()) {
    remove();
    return;
  }
  popover.classList.remove('is-open');
  popover.classList.add('is-closing');
  popover.setAttribute('aria-hidden', 'true');
  popover.addEventListener('transitionend', remove, { once: true });
  libraryCommentPopoverCleanupTimer = setTimeout(remove, 220);
}

function patchLibraryHighlightComment(pageUrl, highlightId, requestedComment) {
  const key = 'highlights_' + pageUrl;
  const comment = normalizeComment(requestedComment);
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(key, result => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      const highlights = Array.isArray(result[key]) ? result[key] : [];
      const index = highlights.findIndex(highlight => highlight?.id === highlightId);
      if (index < 0) {
        resolve({ status: 'missing' });
        return;
      }
      const current = normalizeComment(highlights[index].comment);
      if (current === comment) {
        resolve({ status: 'unchanged', comment });
        return;
      }
      const nextHighlight = { ...highlights[index] };
      if (comment) nextHighlight.comment = comment;
      else delete nextHighlight.comment;
      const nextHighlights = highlights.slice();
      nextHighlights[index] = nextHighlight;
      chrome.storage.local.set({ [key]: nextHighlights }, () => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve({ status: 'changed', comment });
      });
    });
  });
}

function restorePendingLibraryCommentFocus() {
  if (!pendingLibraryCommentFocus) return;
  const target = pendingLibraryCommentFocus;
  pendingLibraryCommentFocus = null;
  requestAnimationFrame(() => {
    const selector = Array.from(highlightsContainer.querySelectorAll('.snippet-comment-selector')).find(button => (
      button.dataset.pageUrl === target.pageUrl && button.dataset.highlightId === target.highlightId
    ));
    if (selector) selector.focus({ preventScroll: true });
    else document.getElementById('libraryViewHeading')?.focus({ preventScroll: true });
  });
}

function queueLibraryHighlightMutation(task) {
  libraryHighlightWriteQueue = libraryHighlightWriteQueue.catch(() => undefined).then(task);
  return libraryHighlightWriteQueue;
}

function saveLibraryComment(pageUrl, highlightId, comment, popover) {
  if (popover !== currentLibraryCommentPopover) return;
  const textarea = popover.querySelector('.library-comment-textarea');
  const error = popover.querySelector('.library-comment-error');
  const normalized = normalizeComment(comment);
  if (!normalized) {
    if (error) error.textContent = 'Write a comment before saving.';
    textarea?.focus({ preventScroll: true });
    return;
  }
  popover.setAttribute('aria-busy', 'true');
  popover.querySelectorAll('textarea, button').forEach(control => { control.disabled = true; });
  pendingLibraryCommentFocus = { pageUrl, highlightId };
  queueLibraryHighlightMutation(() => patchLibraryHighlightComment(pageUrl, highlightId, normalized))
    .then(result => {
      if (result.status === 'missing') {
        pendingLibraryCommentFocus = null;
        closeLibraryCommentPopover({ immediate: true });
        showToast('Highlight is no longer available');
        refreshLibrary();
        return;
      }
      closeLibraryCommentPopover({ immediate: true });
      showToast('Comment saved');
      if (result.status === 'unchanged') restorePendingLibraryCommentFocus();
    })
    .catch(() => {
      pendingLibraryCommentFocus = null;
      if (popover !== currentLibraryCommentPopover) return;
      popover.setAttribute('aria-busy', 'false');
      popover.querySelectorAll('textarea, button').forEach(control => { control.disabled = false; });
      if (error) error.textContent = 'Could not save the comment. Try again.';
      textarea?.focus({ preventScroll: true });
    });
}

function openCommentDeleteDialog(pageUrl, highlightId, trigger) {
  libraryCommentDeleteTarget = { pageUrl, highlightId };
  libraryCommentDeleteTrigger = trigger || null;
  closeLibraryCommentPopover({ immediate: true });
  if (!commentDeleteDialog || typeof commentDeleteDialog.showModal !== 'function') return;
  commentDeleteDialog.returnValue = '';
  commentDeleteDialog.showModal();
  requestAnimationFrame(() => cancelCommentDeleteBtn?.focus({ preventScroll: true }));
}

function confirmLibraryCommentDelete() {
  const target = libraryCommentDeleteTarget;
  if (!target) return;
  confirmCommentDeleteBtn.disabled = true;
  cancelCommentDeleteBtn.disabled = true;
  pendingLibraryCommentFocus = { ...target };
  queueLibraryHighlightMutation(() => patchLibraryHighlightComment(target.pageUrl, target.highlightId, ''))
    .then(result => {
      if (result.status === 'missing') {
        pendingLibraryCommentFocus = null;
        showToast('Highlight is no longer available');
      } else {
        showToast('Comment deleted');
      }
      commentDeleteDialog?.close('deleted');
      refreshLibrary();
    })
    .catch(() => {
      pendingLibraryCommentFocus = null;
      showToast('Could not delete comment');
      commentDeleteDialog?.close('error');
    });
}

function openLibraryCommentPopover(anchor, pageUrl, highlight) {
  if (!libraryCommentPopoverLayerEl || !anchor || !highlight) return;
  if (currentLibraryCommentPopoverAnchor === anchor) {
    closeLibraryCommentPopover({ restoreFocus: true });
    return;
  }
  closeLibraryTagPopover({ immediate: true });
  closeLibraryFolderPopover({ immediate: true });
  closeLibraryCommentPopover({ immediate: true });

  const existing = normalizeComment(highlight.comment);
  const popover = document.createElement('div');
  popover.className = 'fab-popover library-comment-popover';
  popover.style.setProperty('--comment-accent', getLibraryHighlightColor(highlight));
  popover.setAttribute('role', 'dialog');
  popover.setAttribute('aria-label', existing ? 'View or edit comment' : 'Add comment');
  const title = document.createElement('div');
  title.className = 'fab-popover-title library-comment-heading';
  const accent = document.createElement('span');
  accent.className = 'library-comment-accent';
  accent.style.backgroundColor = 'var(--comment-accent)';
  accent.setAttribute('aria-hidden', 'true');
  const titleLabel = document.createElement('span');
  titleLabel.textContent = 'Note';
  const counter = document.createElement('span');
  counter.className = 'library-comment-counter';
  title.append(accent, titleLabel, counter);
  const textarea = document.createElement('textarea');
  textarea.className = 'library-comment-textarea';
  textarea.maxLength = MAX_COMMENT_LENGTH;
  textarea.rows = 5;
  textarea.placeholder = 'Write a note…';
  textarea.setAttribute('aria-label', 'Comment');
  textarea.value = existing;
  const meta = document.createElement('div');
  meta.className = 'library-comment-meta';
  const error = document.createElement('span');
  error.className = 'library-comment-error';
  error.setAttribute('role', 'status');
  error.setAttribute('aria-live', 'polite');
  const hint = document.createElement('span');
  hint.className = 'library-comment-hint';
  hint.textContent = '↵ save  ·  ⇧↵ new line';
  meta.append(error, hint);
  const actions = document.createElement('div');
  actions.className = 'library-comment-actions';
  if (existing) {
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn btn-secondary library-comment-delete';
    remove.textContent = 'Delete comment';
    remove.addEventListener('click', () => openCommentDeleteDialog(pageUrl, highlight.id, anchor));
    actions.appendChild(remove);
  }
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'btn btn-secondary';
  cancel.textContent = 'Cancel';
  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'btn btn-primary library-comment-save';
  save.textContent = 'Save';
  actions.append(cancel, save);
  popover.append(title, textarea, meta, actions);

  const update = () => {
    counter.textContent = `${textarea.value.length} / ${MAX_COMMENT_LENGTH}`;
    save.disabled = !normalizeComment(textarea.value);
    error.textContent = '';
  };
  update();
  textarea.addEventListener('input', update);
  textarea.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      saveLibraryComment(pageUrl, highlight.id, textarea.value, popover);
    }
  });
  cancel.addEventListener('click', () => closeLibraryCommentPopover({ restoreFocus: true }));
  save.addEventListener('click', () => saveLibraryComment(pageUrl, highlight.id, textarea.value, popover));
  popover.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    closeLibraryCommentPopover({ restoreFocus: true });
  });

  libraryCommentPopoverLayerEl.replaceChildren(popover);
  currentLibraryCommentPopover = popover;
  currentLibraryCommentPopoverAnchor = anchor;
  anchor.setAttribute('aria-expanded', 'true');
  positionLibraryTagPopover(popover, anchor);
  requestAnimationFrame(() => {
    if (currentLibraryCommentPopover !== popover) return;
    popover.classList.add('is-open');
    textarea.focus({ preventScroll: true });
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  });
}

function createLibraryCommentSelector(pageUrl, highlight) {
  const hasComment = Boolean(normalizeComment(highlight.comment));
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'library-action-btn snippet-comment-selector' + (hasComment ? ' has-comment' : '');
  button.innerHTML = libraryIconMarkup('comment');
  button.title = hasComment ? 'View or edit comment' : 'Add comment';
  button.setAttribute('aria-label', button.title);
  button.setAttribute('aria-haspopup', 'dialog');
  button.setAttribute('aria-expanded', 'false');
  button.dataset.pageUrl = pageUrl;
  button.dataset.highlightId = highlight.id;
  button.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    openLibraryCommentPopover(button, pageUrl, highlight);
  });
  return button;
}

function initLibraryCommentPopoverInteractions() {
  if (libraryCommentPopoverListenersInitialized) return;
  libraryCommentPopoverListenersInitialized = true;
  document.addEventListener('pointerdown', event => {
    if (!currentLibraryCommentPopover) return;
    if (currentLibraryCommentPopover.contains(event.target)) return;
    if (currentLibraryCommentPopoverAnchor?.contains(event.target)) return;
    closeLibraryCommentPopover();
  });
  document.addEventListener('focusin', event => {
    if (!currentLibraryCommentPopover) return;
    if (currentLibraryCommentPopover.contains(event.target)) return;
    if (currentLibraryCommentPopoverAnchor?.contains(event.target)) return;
    closeLibraryCommentPopover();
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !currentLibraryCommentPopover) return;
    event.preventDefault();
    closeLibraryCommentPopover({ restoreFocus: true });
  });
  window.addEventListener('resize', () => closeLibraryCommentPopover());
  window.addEventListener('scroll', event => {
    if (currentLibraryCommentPopover && !currentLibraryCommentPopover.contains(event.target)) closeLibraryCommentPopover();
  }, true);
}

cancelCommentDeleteBtn?.addEventListener('click', () => commentDeleteDialog?.close('cancel'));
confirmCommentDeleteBtn?.addEventListener('click', confirmLibraryCommentDelete);
commentDeleteDialog?.addEventListener('cancel', event => {
  event.preventDefault();
  commentDeleteDialog.close('cancel');
});
commentDeleteDialog?.addEventListener('close', () => {
  confirmCommentDeleteBtn.disabled = false;
  cancelCommentDeleteBtn.disabled = false;
  const shouldRestore = ['cancel', 'error'].includes(commentDeleteDialog.returnValue);
  const trigger = libraryCommentDeleteTrigger;
  libraryCommentDeleteTarget = null;
  libraryCommentDeleteTrigger = null;
  if (shouldRestore && trigger?.isConnected) trigger.focus({ preventScroll: true });
});

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

function libraryIconMarkup(iconName) {
  const paths = {
    back: '<path d="m15 18-6-6 6-6"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    chevron: '<path d="m8 10 4 4 4-4"/>',
    folder: '<path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H10l2 2h6.5A2.5 2.5 0 0 1 21 8.5v9A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5z"/>',
    comment: '<path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    star: '<path d="M12 2.8l2.82 5.72 6.31.92-4.57 4.45 1.08 6.29L12 17.22l-5.64 2.96 1.08-6.29-4.57-4.45 6.31-.92L12 2.8z"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 10v6M14 10v6"/>',
    restore: '<path d="M3 7v5h5"/><path d="M5.1 16a8 8 0 1 0 .5-9.4L3 9"/>'
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[iconName] || ''}</svg>`;
}

function createTagsToolbar(preset) {
  const toolbar = document.createElement('div');
  toolbar.className = 'tags-toolbar';

  const backBtn = document.createElement('button');
  backBtn.type = 'button';
  backBtn.className = 'tags-back-btn';
  backBtn.innerHTML = `${libraryIconMarkup('back')}<span>All tags</span>`;
  backBtn.title = 'Back to all tags';
  backBtn.setAttribute('aria-label', 'Back to all tags');
  backBtn.addEventListener('click', () => {
    currentTagPresetId = null;
    loadTagsView();
  });

  const title = document.createElement('div');
  title.className = 'tags-toolbar-title';
  title.textContent = preset && preset.name ? preset.name : 'Tag';

  toolbar.appendChild(backBtn);
  toolbar.appendChild(title);
  return toolbar;
}

function queueFolderMutation(task) {
  folderMutationQueue = folderMutationQueue.catch(() => undefined).then(task);
  return folderMutationQueue;
}

function findUniqueFolderName(folders, baseName = 'New Folder') {
  const used = new Set(folders.map(folder => folder.name.toLocaleLowerCase()));
  if (!used.has(baseName.toLocaleLowerCase())) return baseName;
  let suffix = 2;
  while (used.has(`${baseName} ${suffix}`.toLocaleLowerCase())) suffix++;
  return `${baseName} ${suffix}`;
}

function createFolderFromManager() {
  libraryQuery = '';
  if (librarySearchInput) librarySearchInput.value = '';
  queueFolderMutation(() => new Promise((resolve, reject) => {
    chrome.storage.local.get(FOLDERS_KEY, result => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      const folders = normalizeFolders(result[FOLDERS_KEY]);
      const now = Date.now();
      const folder = {
        id: generateFolderId(),
        name: findUniqueFolderName(folders),
        createdAt: now,
        lastUsedAt: now
      };
      editingFolderId = folder.id;
      chrome.storage.local.set({ [FOLDERS_KEY]: [...folders, folder] }, () => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(folder);
      });
    });
  })).catch(() => showToast('Could not create folder'));
}

function renameFolder(folderId, requestedName) {
  const name = normalizeFolderName(requestedName);
  if (!name) {
    showToast('Folder name cannot be empty');
    editingFolderId = null;
    refreshLibrary();
    return;
  }
  queueFolderMutation(() => new Promise((resolve, reject) => {
    chrome.storage.local.get(FOLDERS_KEY, result => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      const folders = normalizeFolders(result[FOLDERS_KEY]);
      if (folders.some(folder => folder.id !== folderId && folder.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
        resolve({ duplicate: true });
        return;
      }
      let changed = false;
      const next = folders.map(folder => {
        if (folder.id !== folderId || folder.name === name) return folder;
        changed = true;
        return { ...folder, name };
      });
      if (!changed) {
        resolve({ changed: false });
        return;
      }
      chrome.storage.local.set({ [FOLDERS_KEY]: next }, () => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve({ changed: true });
      });
    });
  })).then(result => {
    editingFolderId = null;
    if (result?.duplicate) showToast('A folder with that name already exists');
    refreshLibrary();
  }).catch(() => {
    editingFolderId = null;
    showToast('Could not rename folder');
    refreshLibrary();
  });
}

function countHighlightsByFolder(all, folders) {
  const counts = Object.fromEntries(folders.map(folder => [folder.id, 0]));
  Object.keys(all).forEach(storageKey => {
    if (!storageKey.startsWith('highlights_') || !Array.isArray(all[storageKey])) return;
    all[storageKey].forEach(highlight => {
      if (highlight && typeof highlight.folderId === 'string' && counts[highlight.folderId] !== undefined) {
        counts[highlight.folderId]++;
      }
    });
  });
  return counts;
}

function loadFoldersView() {
  chrome.storage.local.get(null, all => {
    activeLibraryFolders = normalizeFolders(all[FOLDERS_KEY]);
    if (activeLibraryFolders.length === 0) folderDeleteMode = false;
    renderLibraryFolderChildren(activeLibraryFolders);
    const selectedFolder = getFolderById(currentFolderId);
    if (currentFolderId && selectedFolder) {
      const heading = document.getElementById('libraryViewHeading');
      const description = document.getElementById('libraryViewDescription');
      if (heading) heading.textContent = selectedFolder.name;
      if (description) description.textContent = 'Highlights saved in this folder.';
      renderFolderHighlights(all, selectedFolder);
      return;
    }
    currentFolderId = null;
    syncLibraryViewHeader('folders');
    const folderTokens = normalizeQuery(libraryQuery);
    const visibleFolders = folderTokens.length > 0
      ? activeLibraryFolders.filter(folder => matchesTokens(folder.name, folderTokens))
      : activeLibraryFolders;
    renderFolderManager(visibleFolders, countHighlightsByFolder(all, activeLibraryFolders), {
      filtered: folderTokens.length > 0,
      totalFolders: activeLibraryFolders.length
    });
  });
}

function renderFolderManager(folders, counts, { filtered = false, totalFolders = folders.length } = {}) {
  highlightCount.textContent = `${filtered ? folders.length : totalFolders} ${folders.length === 1 ? 'folder' : 'folders'}`;
  highlightsContainer.innerHTML = '';

  const footer = createFolderManagerActions(totalFolders > 0);

  if (folders.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = filtered
      ? '<div class="empty-state-title">No results</div>Try a different folder name.'
      : '<div class="empty-state-title">No folders yet</div>Create a folder to start organizing highlights.';
    highlightsContainer.appendChild(empty);
    highlightsContainer.appendChild(footer);
    return;
  }

  const list = document.createElement('div');
  list.className = 'folder-manager-list';
  sortFoldersByName(folders).forEach(folder => {
    const row = document.createElement('div');
    row.className = 'folder-manager-row';

    if (editingFolderId === folder.id) {
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'folder-name-input';
      input.value = folder.name;
      input.maxLength = MAX_FOLDER_NAME_LENGTH;
      input.setAttribute('aria-label', `Rename ${folder.name}`);
      let cancelled = false;
      input.addEventListener('keydown', event => {
        if (event.key === 'Enter') input.blur();
        if (event.key === 'Escape') {
          cancelled = true;
          editingFolderId = null;
          refreshLibrary();
        }
      });
      input.addEventListener('blur', () => {
        if (!cancelled) renameFolder(folder.id, input.value);
      }, { once: true });
      row.appendChild(input);
      requestAnimationFrame(() => {
        if (!input.isConnected) return;
        input.focus({ preventScroll: true });
        input.select();
      });
    } else {
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'folder-manager-open';
      open.innerHTML = `${libraryIconMarkup('folder')}<span class="folder-manager-name"></span><span class="folder-manager-count"></span>`;
      open.querySelector('svg')?.classList.add('folder-manager-icon');
      open.querySelector('.folder-manager-name').textContent = folder.name;
      const count = counts[folder.id] || 0;
      open.querySelector('.folder-manager-count').textContent = `${count} ${count === 1 ? 'highlight' : 'highlights'}`;
      open.addEventListener('click', () => {
        currentFolderId = folder.id;
        renderLibraryFolderChildren();
        refreshLibrary();
      });

      const actions = document.createElement('div');
      actions.className = 'folder-manager-actions';
      const rename = document.createElement('button');
      rename.type = 'button';
      rename.className = 'library-action-btn';
      rename.innerHTML = libraryIconMarkup('edit');
      rename.title = `Rename ${folder.name}`;
      rename.setAttribute('aria-label', rename.title);
      rename.addEventListener('click', () => {
        editingFolderId = folder.id;
        refreshLibrary();
      });
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'library-action-btn is-danger folder-manager-delete';
      remove.textContent = '×';
      remove.title = `Delete ${folder.name}`;
      remove.setAttribute('aria-label', remove.title);
      remove.addEventListener('click', () => openFolderDeleteDialog(folder.id, count, remove));
      actions.appendChild(rename);
      if (folderDeleteMode) actions.appendChild(remove);
      row.append(open, actions);
    }
    list.appendChild(row);
  });
  highlightsContainer.appendChild(list);
  highlightsContainer.appendChild(footer);
}

function createFolderManagerActions(hasFolders) {
  if (!hasFolders) folderDeleteMode = false;

  const actions = document.createElement('div');
  actions.className = 'presets-footer-actions folder-manager-footer-actions';

  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'btn btn-secondary presets-footer-icon';
  add.title = 'Add folder';
  add.setAttribute('aria-label', 'Add folder');
  add.innerHTML = '<span class="preset-add-icon" aria-hidden="true">+</span>';
  add.addEventListener('click', createFolderFromManager);

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'btn btn-secondary presets-footer-icon preset-delete-mode-toggle';
  remove.disabled = !hasFolders;
  remove.setAttribute('aria-pressed', String(folderDeleteMode));
  const removeLabel = folderDeleteMode ? 'Finish deleting folders' : 'Delete folders';
  remove.title = removeLabel;
  remove.setAttribute('aria-label', removeLabel);
  remove.innerHTML = `
    <span class="preset-delete-trash-icon" aria-hidden="true">${libraryIconMarkup('trash')}</span>
    <span class="preset-delete-done-icon" aria-hidden="true">${libraryIconMarkup('check')}</span>
  `;
  remove.addEventListener('click', () => {
    folderDeleteMode = !folderDeleteMode;
    refreshLibrary();
  });

  actions.append(add, remove);
  return actions;
}

function renderFolderHighlights(all, folder) {
  const pages = [];
  const index = all.highlightIndex || {};
  let totalCount = 0;
  Object.keys(all).forEach(storageKey => {
    if (!storageKey.startsWith('highlights_') || !Array.isArray(all[storageKey])) return;
    const inFolder = all[storageKey].filter(highlight => highlight?.folderId === folder.id);
    if (inFolder.length === 0) return;
    const url = storageKey.substring('highlights_'.length);
    const meta = index[url] || {};
    const tokens = normalizeQuery(libraryQuery);
    const pageMatch = tokens.length > 0 ? pageMatchesQuery(meta.title || url, url, tokens) : false;
    const filtered = tokens.length === 0 || pageMatch
      ? inFolder
      : inFolder.filter(highlight => highlightMatchesQuery(highlight.text, tokens));
    if (filtered.length === 0) return;
    totalCount += filtered.length;
    pages.push({
      url,
      title: meta.title || url,
      lastUpdated: meta.lastUpdated || 0,
      highlights: filtered.slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
    });
  });
  pages.sort((a, b) => b.lastUpdated - a.lastUpdated);

  const toolbar = document.createElement('div');
  toolbar.className = 'tags-toolbar folder-view-toolbar';
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'tags-back-btn folder-view-back';
  back.innerHTML = `${libraryIconMarkup('back')}<span>All folders</span>`;
  back.addEventListener('click', () => {
    currentFolderId = null;
    renderLibraryFolderChildren();
    refreshLibrary();
  });
  const name = document.createElement('span');
  name.className = 'tags-toolbar-title';
  name.textContent = folder.name;
  toolbar.append(back, name);

  if (pages.length === 0) {
    highlightCount.textContent = '';
    highlightsContainer.innerHTML = '';
    highlightsContainer.appendChild(toolbar);
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = `<div class="empty-state-title">${libraryQuery ? 'No results' : 'No highlights in this folder'}</div>${libraryQuery ? 'Try a different keyword.' : 'Assign highlights from All, Favorites, or the FAB.'}`;
    highlightsContainer.appendChild(empty);
    return;
  }
  renderHighlights(pages, totalCount, { countLabel: 'saved' });
  highlightsContainer.prepend(toolbar);
}

function openFolderDeleteDialog(folderId, highlightCountForFolder, trigger = null) {
  const folder = getFolderById(folderId);
  if (!folder) return;
  folderDeleteTargetId = folderId;
  folderDeleteTrigger = trigger;
  const hasHighlights = highlightCountForFolder > 0;
  folderDeleteDialogTitle.textContent = `Delete “${folder.name}”?`;
  folderDeleteDialogDescription.textContent = hasHighlights
    ? `This folder contains ${highlightCountForFolder} ${highlightCountForFolder === 1 ? 'highlight' : 'highlights'}. Keep them as unfiled, or move them to Recently Deleted.`
    : 'This folder is empty and can be deleted safely.';
  keepFolderHighlightsBtn.textContent = hasHighlights ? 'Delete folder, keep highlights' : 'Delete folder';
  deleteFolderHighlightsBtn.hidden = !hasHighlights;
  if (!folderDeleteDialog || typeof folderDeleteDialog.showModal !== 'function') {
    if (window.confirm(`Delete “${folder.name}”? Highlights will be kept as unfiled.`)) {
      deleteFolder(folderId, 'keep');
    } else {
      folderDeleteTargetId = null;
      folderDeleteTrigger = null;
    }
    return;
  }
  folderDeleteDialog.returnValue = '';
  folderDeleteDialog.showModal();
  requestAnimationFrame(() => cancelFolderDeleteBtn?.focus({ preventScroll: true }));
}

function deleteFolder(folderId, mode) {
  queueFolderMutation(() => new Promise((resolve, reject) => {
    chrome.storage.local.get(null, all => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      const folders = normalizeFolders(all[FOLDERS_KEY]);
      const folder = folders.find(item => item.id === folderId);
      if (!folder) {
        resolve(null);
        return;
      }
      const nextFolders = folders.filter(item => item.id !== folderId);
      const index = { ...(all.highlightIndex || {}) };
      let trash = Array.isArray(all[RECENTLY_DELETED_KEY])
        ? all[RECENTLY_DELETED_KEY].map(entry => {
            if (entry?.highlight?.folderId !== folderId) return entry;
            const highlight = { ...entry.highlight };
            delete highlight.folderId;
            return { ...entry, highlight };
          })
        : [];
      const payload = {
        [FOLDERS_KEY]: nextFolders,
        [RECENTLY_DELETED_KEY]: trash,
        highlightIndex: index
      };
      const emptyKeys = [];
      const now = Date.now();

      Object.keys(all).forEach(storageKey => {
        if (!storageKey.startsWith('highlights_') || !Array.isArray(all[storageKey])) return;
        const pageUrl = storageKey.substring('highlights_'.length);
        const pageTitle = index[pageUrl]?.title || pageUrl;
        const nextHighlights = [];
        let affected = false;
        all[storageKey].forEach(highlight => {
          if (!highlight || highlight.folderId !== folderId) {
            nextHighlights.push(highlight);
            return;
          }
          affected = true;
          const nextHighlight = { ...highlight };
          delete nextHighlight.folderId;
          if (mode === 'delete-highlights') {
            trash.unshift({
              trashId: generateTrashId(),
              pageUrl,
              pageTitle,
              deletedAt: now,
              highlight: nextHighlight
            });
          } else {
            nextHighlights.push(nextHighlight);
          }
        });
        if (!affected) return;
        if (nextHighlights.length === 0 && all[storageKey].length > 0) {
          payload[storageKey] = [];
          emptyKeys.push(storageKey);
          delete index[pageUrl];
        } else {
          payload[storageKey] = nextHighlights;
        }
      });
      payload[RECENTLY_DELETED_KEY] = trash;

      chrome.storage.local.set(payload, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        const finish = () => resolve(folder);
        if (emptyKeys.length > 0) chrome.storage.local.remove(emptyKeys, finish);
        else finish();
      });
    });
  })).then(folder => {
    if (!folder) return;
    if (currentFolderId === folder.id) currentFolderId = null;
    folderDeleteTargetId = null;
    showToast(mode === 'delete-highlights' ? 'Folder and highlights moved to Recently Deleted' : 'Folder deleted; highlights kept');
    refreshLibrary();
  }).catch(() => {
    folderDeleteTargetId = null;
    showToast('Could not delete folder');
  });
}

cancelFolderDeleteBtn?.addEventListener('click', () => folderDeleteDialog?.close('cancel'));
keepFolderHighlightsBtn?.addEventListener('click', () => {
  const folderId = folderDeleteTargetId;
  folderDeleteDialog?.close('keep');
  if (folderId) deleteFolder(folderId, 'keep');
});
deleteFolderHighlightsBtn?.addEventListener('click', () => {
  const folderId = folderDeleteTargetId;
  folderDeleteDialog?.close('delete-highlights');
  if (folderId) deleteFolder(folderId, 'delete-highlights');
});
folderDeleteDialog?.addEventListener('close', () => {
  const trigger = folderDeleteTrigger;
  folderDeleteTrigger = null;
  if (folderDeleteDialog.returnValue === 'cancel') folderDeleteTargetId = null;
  requestAnimationFrame(() => trigger?.isConnected && trigger.focus({ preventScroll: true }));
});
folderDeleteDialog?.addEventListener('cancel', () => {
  folderDeleteTargetId = null;
});

// Load all highlights from storage and render them
function loadAllHighlights() {
  chrome.storage.local.get(null, (all) => {
    setActiveLibraryPresets(all.highlightSettings);
    activeLibraryFolders = normalizeFolders(all[FOLDERS_KEY]);
    renderLibraryFolderChildren(activeLibraryFolders);
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

    renderHighlights(filtered.pages, filtered.totalCount, {
      countLabel: 'saved',
      allowTagChange: true,
      allowFolderChange: true,
      allowCommentChange: true
    });
  });
}

function loadFavoriteHighlights() {
  chrome.storage.local.get(null, (all) => {
    setActiveLibraryPresets(all.highlightSettings);
    activeLibraryFolders = normalizeFolders(all[FOLDERS_KEY]);
    renderLibraryFolderChildren(activeLibraryFolders);
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
    renderHighlights(filtered.pages, filtered.totalCount, {
      countLabel: 'favorited',
      allowTagChange: true,
      allowFolderChange: true,
      allowCommentChange: true
    });
  });
}

function loadCommentHighlights() {
  chrome.storage.local.get(null, all => {
    setActiveLibraryPresets(all.highlightSettings);
    activeLibraryFolders = normalizeFolders(all[FOLDERS_KEY]);
    renderLibraryFolderChildren(activeLibraryFolders);
    const index = all.highlightIndex || {};
    const pages = [];
    const storageFixups = {};
    const tokens = normalizeQuery(libraryQuery);

    Object.keys(all).forEach(storageKey => {
      if (!storageKey.startsWith('highlights_')) return;
      const url = storageKey.substring('highlights_'.length);
      const raw = all[storageKey];
      if (!Array.isArray(raw) || raw.length === 0) return;
      const normalized = normalizeStoredHighlights(raw);
      if (normalized.changed) storageFixups[storageKey] = normalized.highlights;
      const meta = index[url] || {};
      const title = meta.title || url;
      const pageMatches = tokens.length > 0 && (matchesTokens(title, tokens) || matchesTokens(url, tokens));
      const comments = normalized.highlights.filter(highlight => {
        const comment = normalizeComment(highlight?.comment);
        if (!comment) return false;
        if (tokens.length === 0 || pageMatches) return true;
        return matchesTokens(highlight.text || '', tokens) || matchesTokens(comment, tokens);
      });
      if (comments.length === 0) return;
      pages.push({
        url,
        title,
        lastUpdated: meta.lastUpdated || Date.now(),
        highlights: comments.slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
      });
    });

    if (Object.keys(storageFixups).length > 0) chrome.storage.local.set(storageFixups);
    if (pages.length === 0) {
      highlightCount.textContent = '';
      highlightsContainer.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-title">${tokens.length > 0 ? 'No results' : 'No comments yet'}</div>
          ${tokens.length > 0 ? 'Try a different keyword.' : 'Add a comment to a highlight to see it here.'}
        </div>
      `;
      return;
    }
    pages.sort((a, b) => (b.lastUpdated || 0) - (a.lastUpdated || 0));
    const totalCount = pages.reduce((count, page) => count + page.highlights.length, 0);
    renderHighlights(pages, totalCount, {
      countLabel: 'commented',
      allowCommentChange: true,
      allowPageClear: false
    });
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
      restoreBtn.className = 'library-action-btn snippet-restore';
      restoreBtn.innerHTML = libraryIconMarkup('restore');
      restoreBtn.title = 'Restore highlight';
      restoreBtn.setAttribute('aria-label', 'Restore highlight');
      restoreBtn.addEventListener('click', () => restoreFromTrash(entry.trashId));

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'library-action-btn snippet-delete is-danger';
      delBtn.innerHTML = libraryIconMarkup('trash');
      delBtn.title = 'Delete forever';
      delBtn.setAttribute('aria-label', 'Delete highlight forever');
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
  chrome.storage.local.get([RECENTLY_DELETED_KEY, 'highlightIndex', FOLDERS_KEY], (result) => {
    const trash = Array.isArray(result[RECENTLY_DELETED_KEY]) ? result[RECENTLY_DELETED_KEY] : [];
    const entry = trash.find(t => t.trashId === trashId);
    if (!entry || !entry.highlight) return;

    const restoredHighlight = { ...entry.highlight };
    const folders = normalizeFolders(result[FOLDERS_KEY]);
    if (
      restoredHighlight.folderId
      && !folders.some(folder => folder.id === restoredHighlight.folderId)
    ) {
      delete restoredHighlight.folderId;
    }

    const key = 'highlights_' + entry.pageUrl;
    chrome.storage.local.get(key, (r2) => {
      let highlights = r2[key] || [];
      const newTrash = trash.filter(t => t.trashId !== trashId);
      if (highlights.some(h => h.id === restoredHighlight.id)) {
        chrome.storage.local.set({ [RECENTLY_DELETED_KEY]: newTrash }, refreshLibrary);
        return;
      }
      highlights = highlights.concat([restoredHighlight]);
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
  btn.className = 'library-action-btn snippet-star' + (hl.favorited === true ? ' is-favorited' : '');
  const favorited = hl.favorited === true;
  btn.title = favorited ? 'Remove from favorites' : 'Add to favorites';
  btn.setAttribute('aria-label', btn.title);
  btn.innerHTML = libraryIconMarkup('star');
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleFavorite(pageUrl, hl.id);
  });
  return btn;
}

function toggleFavorite(url, highlightId) {
  const key = 'highlights_' + url;
  queueLibraryHighlightMutation(() => new Promise((resolve, reject) => {
    chrome.storage.local.get(key, result => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      const highlights = Array.isArray(result[key]) ? result[key] : [];
      const index = highlights.findIndex(highlight => highlight?.id === highlightId);
      if (index < 0) {
        resolve(false);
        return;
      }
      const copy = { ...highlights[index] };
      if (copy.favorited === true) delete copy.favorited;
      else copy.favorited = true;
      const next = highlights.slice();
      next[index] = copy;
      chrome.storage.local.set({ [key]: next }, () => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(true);
      });
    });
  })).then(changed => {
    if (!changed) refreshLibrary();
  }).catch(() => {
    showToast('Could not update favorite');
    refreshLibrary();
  });
}

// Render all page groups
function renderHighlights(pages, totalCount, options = {}) {
  const countWord = options.countLabel === 'favorited'
    ? 'favorited'
    : (options.countLabel === 'commented' ? 'commented' : 'saved');
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
    if (options.allowPageClear !== false) header.appendChild(clearBtn);
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

      let colorSlot;
      if (options.allowTagChange) {
        colorSlot = createLibraryTagSelector(page.url, hl);
      } else {
        colorSlot = document.createElement('span');
        colorSlot.className = 'snippet-color-slot';
        const dot = document.createElement('span');
        dot.className = 'snippet-color-dot';
        const resolvedColor = getLibraryHighlightColor(hl);
        dot.style.backgroundColor = resolvedColor;
        dot.title = getLibraryPresetForHighlight(hl).name || resolvedColor;
        colorSlot.appendChild(dot);
      }

      const star = createStarButton(page.url, hl);
      const folder = options.allowFolderChange ? createLibraryFolderSelector(page.url, hl) : null;
      const comment = options.allowCommentChange ? createLibraryCommentSelector(page.url, hl) : null;

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'library-action-btn snippet-delete is-danger';
      del.innerHTML = libraryIconMarkup('trash');
      del.title = 'Delete highlight';
      del.setAttribute('aria-label', 'Delete highlight');
      del.addEventListener('click', () => deleteHighlight(page.url, hl.id));

      const rowActions = document.createElement('div');
      rowActions.className = 'snippet-item-actions';
      rowActions.appendChild(colorSlot);
      if (folder) rowActions.appendChild(folder);
      if (comment) rowActions.appendChild(comment);
      rowActions.appendChild(star);
      rowActions.appendChild(del);

      item.appendChild(text);
      item.appendChild(rowActions);
      list.appendChild(item);
    });

    group.appendChild(list);
    highlightsContainer.appendChild(group);
  });

  restorePendingLibraryTagSelectorFocus();
  restorePendingLibraryFolderSelectorFocus();
  restorePendingLibraryCommentFocus();
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
  const hasFolderChange = Object.prototype.hasOwnProperty.call(changes, FOLDERS_KEY);
  const hasFolderExpansionChange = Object.prototype.hasOwnProperty.call(changes, FOLDERS_EXPANDED_KEY);

  if (hasFolderChange) {
    activeLibraryFolders = normalizeFolders(changes[FOLDERS_KEY].newValue);
    if (currentFolderId && !getFolderById(currentFolderId)) currentFolderId = null;
    renderLibraryFolderChildren(activeLibraryFolders);
  }
  if (hasFolderExpansionChange) {
    setFoldersExpanded(changes[FOLDERS_EXPANDED_KEY].newValue === true);
  }

  if ((hasHighlightChange || hasTrashChange || hasFolderChange) && isLibraryTabActive()) {
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
  setFoldersExpanded(foldersExpandedPreference);
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
      const sidebar = btn.closest('.sidebar');
      if (sidebar?.id === 'sidebar-library' && isMobileLibraryLayout()) {
        const willOpen = !sidebar.classList.contains('is-mobile-search-open');
        setMobileLibrarySearchOpen(willOpen, { focusInput: willOpen });
        if (!willOpen) btn.focus({ preventScroll: true });
        return;
      }
      setSidebarCollapsed(false);
      saveSidebarCollapsedState(false);
      const input = sidebar ? sidebar.querySelector('.search-bar-wrap input') : null;
      if (input) {
        input.focus();
      }
    });
  });
}

document.addEventListener('pointerdown', (event) => {
  const sidebar = document.getElementById('sidebar-library');
  if (!sidebar?.classList.contains('is-mobile-search-open')) return;
  if (!sidebar.contains(event.target)) closeMobileLibrarySearch();
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  const sidebar = document.getElementById('sidebar-library');
  if (!sidebar?.classList.contains('is-mobile-search-open')) return;
  closeMobileLibrarySearch();
  sidebar.querySelector('.search-bar-collapsed-btn')?.focus({ preventScroll: true });
});

// ---- Init ----
loadSettings();
initSidebarNavigation();
loadSidebarCollapsedState();
initSidebarCollapseToggle();
initSearchCollapsedBtn();
initGlobalNavbarMetrics();
initSettingsStickyHeaderMetrics();
initLibraryTagPopoverInteractions();
initLibraryFolderPopoverInteractions();
initLibraryCommentPopoverInteractions();
initLibraryFoldersNavigation();

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
