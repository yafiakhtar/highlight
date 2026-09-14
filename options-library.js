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
let emptyTrashDialogTrigger = null;
let emptyTrashPending = false;
let emptyTrashOpenPending = false;

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
const emptyTrashDialog = document.getElementById('emptyTrashDialog');
const emptyTrashDialogDescription = document.getElementById('emptyTrashDialogDescription');
const emptyTrashDialogError = document.getElementById('emptyTrashDialogError');
const cancelEmptyTrashBtn = document.getElementById('cancelEmptyTrashBtn');
const confirmEmptyTrashBtn = document.getElementById('confirmEmptyTrashBtn');

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
      || getDefaultPreset(DEFAULTS.presets).id;
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

function getNormalizedLibraryPage(all, storageKey, storageFixups) {
  if (!storageKey.startsWith('highlights_')) return null;
  const raw = all[storageKey];
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const normalized = normalizeStoredHighlights(raw);
  if (normalized.highlights.length === 0) return null;
  if (normalized.changed && storageFixups) storageFixups[storageKey] = normalized.highlights;
  const url = storageKey.substring('highlights_'.length);
  const meta = (all.highlightIndex && all.highlightIndex[url]) || {};
  return {
    storageKey,
    url,
    title: meta.title || url,
    lastUpdated: meta.lastUpdated || Date.now(),
    highlights: normalized.highlights
  };
}

let libraryLoadVersion = 0;

function beginLibraryLoad() {
  // Every refresh invalidates callbacks that were started for an older Library state.
  libraryLoadVersion += 1;
  return libraryLoadVersion;
}

function isCurrentLibraryLoad(requestVersion) {
  return requestVersion === libraryLoadVersion;
}

function refreshLibrary() {
  const requestVersion = beginLibraryLoad();
  closeLibraryTagPopover({ immediate: true });
  closeLibraryFolderPopover({ immediate: true });
  closeLibraryCommentPopover({ immediate: true });
  syncLibraryViewHeader();
  if (currentLibraryView === 'recently-deleted') {
    loadRecentlyDeleted(requestVersion);
  } else if (currentLibraryView === 'folders') {
    loadFoldersView(requestVersion);
  } else if (currentLibraryView === 'tags') {
    loadTagsView(requestVersion);
  } else if (currentLibraryView === 'comments') {
    loadCommentHighlights(requestVersion);
  } else if (currentLibraryView === 'favorites') {
    loadFavoriteHighlights(requestVersion);
  } else {
    loadAllHighlights(requestVersion);
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
  const defaultPreset = activeLibraryPresets.find(p => p.id === 'preset1') || getDefaultPreset(DEFAULTS.presets);
  return match ? match.id : defaultPreset.id;
}

function setActiveLibraryPresets(settings) {
  activeLibraryPresets = getTagPresetDefinitions(settings || DEFAULTS);
}

function getLibraryPresetForHighlight(hl) {
  const presetId = getHighlightPresetId(hl);
  return activeLibraryPresets.find(p => p.id === presetId)
    || activeLibraryPresets.find(p => p.id === 'preset1')
    || getDefaultPreset(DEFAULTS.presets);
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

function finishLibraryPopoverClose(popover, anchor, layer, {
  immediate = false,
  restoreFocus = false,
  setCleanupTimer
} = {}) {
  if (anchor) anchor.setAttribute('aria-expanded', 'false');
  if (restoreFocus && anchor?.isConnected) anchor.focus({ preventScroll: true });
  if (!popover) {
    if (immediate && layer) layer.innerHTML = '';
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
  setCleanupTimer(setTimeout(remove, 220));
}

function installLibraryPopoverDismissal(getPopover, getAnchor, closePopover) {
  const dismissOutside = event => {
    const popover = getPopover();
    if (!popover || popover.contains(event.target) || getAnchor()?.contains(event.target)) return;
    closePopover();
  };
  document.addEventListener('pointerdown', dismissOutside);
  document.addEventListener('focusin', dismissOutside);
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !getPopover()) return;
    event.preventDefault();
    closePopover({ restoreFocus: true });
  });
  window.addEventListener('resize', () => closePopover());
  window.addEventListener('scroll', event => {
    const popover = getPopover();
    if (popover && !popover.contains(event.target)) closePopover();
  }, true);
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

  finishLibraryPopoverClose(popover, anchor, libraryTagPopoverLayerEl, {
    immediate,
    restoreFocus,
    setCleanupTimer: timer => { libraryTagPopoverCleanupTimer = timer; }
  });
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
      const fallbackPreset = getDefaultPreset(presets);
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

  installLibraryPopoverDismissal(
    () => currentLibraryTagPopover,
    () => currentLibraryTagPopoverAnchor,
    closeLibraryTagPopover
  );
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
  finishLibraryPopoverClose(popover, anchor, libraryFolderPopoverLayerEl, {
    immediate,
    restoreFocus,
    setCleanupTimer: timer => { libraryFolderPopoverCleanupTimer = timer; }
  });
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
  installLibraryPopoverDismissal(
    () => currentLibraryFolderPopover,
    () => currentLibraryFolderPopoverAnchor,
    closeLibraryFolderPopover
  );
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
  finishLibraryPopoverClose(popover, anchor, libraryCommentPopoverLayerEl, {
    immediate,
    restoreFocus,
    setCleanupTimer: timer => { libraryCommentPopoverCleanupTimer = timer; }
  });
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
  // Serialize full-array Library writes so each task reads the prior task's result.
  libraryHighlightWriteQueue = libraryHighlightWriteQueue.catch(() => undefined).then(task);
  return libraryHighlightWriteQueue;
}

function saveLibraryComment(pageUrl, highlightId, comment, popover) {
  if (popover !== currentLibraryCommentPopover) return;
  const textarea = popover.querySelector('.library-comment-textarea');
  const error = popover.querySelector('.library-comment-error');
  const normalized = normalizeComment(comment);
  if (!normalized) {
    if (error) error.textContent = 'Write a note before saving.';
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
      showToast('Note saved');
      if (result.status === 'unchanged') restorePendingLibraryCommentFocus();
    })
    .catch(() => {
      pendingLibraryCommentFocus = null;
      if (popover !== currentLibraryCommentPopover) return;
      popover.setAttribute('aria-busy', 'false');
      popover.querySelectorAll('textarea, button').forEach(control => { control.disabled = false; });
      if (error) error.textContent = 'Could not save the note. Try again.';
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
        showToast('Note deleted');
      }
      commentDeleteDialog?.close('deleted');
      refreshLibrary();
    })
    .catch(() => {
      pendingLibraryCommentFocus = null;
      showToast('Could not delete note');
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
  popover.setAttribute('aria-label', existing ? 'View or edit note' : 'Add note');
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
  textarea.setAttribute('aria-label', 'Note');
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
    remove.textContent = 'Delete note';
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
  button.title = hasComment ? 'View or edit note' : 'Add note';
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
  installLibraryPopoverDismissal(
    () => currentLibraryCommentPopover,
    () => currentLibraryCommentPopoverAnchor,
    closeLibraryCommentPopover
  );
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

function loadTagsView(requestVersion) {
  if (currentTagPresetId) {
    loadTagHighlights(currentTagPresetId, requestVersion);
  } else {
    loadTagFolders(requestVersion);
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

function loadTagFolders(requestVersion) {
  chrome.storage.local.get(null, (all) => {
    if (!isCurrentLibraryLoad(requestVersion)) return;
    const settings = all.highlightSettings || DEFAULTS;
    const presets = getTagPresetDefinitions(settings);
    activeLibraryPresets = presets;
    const storageFixups = {};
    const tokens = normalizeQuery(libraryQuery);

    const counts = {};
    let total = 0;
    const tagHasMatch = {};
    const tagNameMatches = new Set(
      tokens.length > 0
        ? presets.filter(preset => matchesTokens(preset.name || '', tokens)).map(preset => preset.id)
        : []
    );

    for (const storageKey of Object.keys(all)) {
      const page = getNormalizedLibraryPage(all, storageKey, storageFixups);
      if (!page) continue;
      const pageMatch = tokens.length > 0 ? pageMatchesQuery(page.title, page.url, tokens) : false;

      for (const hl of page.highlights) {
        const pid = getHighlightPresetId(hl);
        const hlMatch = tokens.length > 0 ? highlightMatchesQuery(hl.text, tokens) : true;
        const isMatch = tokens.length === 0 ? true : (tagNameMatches.has(pid) || pageMatch || hlMatch);
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
    const filteredPresets = tokens.length === 0
      ? presets
      : presets.filter(p => tagNameMatches.has(p.id) || tagHasMatch[p.id]);

    if (tokens.length > 0 && filteredPresets.length === 0) {
      highlightCount.textContent = '';
      highlightsContainer.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-title">No results</div>
          Try a different keyword.
        </div>
      `;
      return;
    }

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
      refreshLibrary();
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

function loadTagHighlights(presetId, requestVersion) {
  chrome.storage.local.get(null, (all) => {
    if (!isCurrentLibraryLoad(requestVersion)) return;
    const settings = all.highlightSettings || DEFAULTS;
    const presets = getTagPresetDefinitions(settings);
    activeLibraryPresets = presets;
    const preset = presets.find(p => p.id === presetId) || getDefaultPreset(presets);
    const storageFixups = {};
    const tokens = normalizeQuery(libraryQuery);

    const pages = [];
    let totalCount = 0;
    for (const storageKey of Object.keys(all)) {
      const page = getNormalizedLibraryPage(all, storageKey, storageFixups);
      if (!page) continue;

      const inTag = page.highlights.filter(h => getHighlightPresetId(h) === presetId);
      if (inTag.length === 0) continue;

      const pageMatch = tokens.length > 0 ? pageMatchesQuery(page.title, page.url, tokens) : false;
      const filtered = tokens.length === 0
        ? inTag
        : (pageMatch ? inTag : inTag.filter(h => highlightMatchesQuery(h.text, tokens)));
      if (filtered.length === 0) continue;

      totalCount += filtered.length;
      pages.push({
        url: page.url,
        title: page.title,
        lastUpdated: page.lastUpdated,
        highlights: filtered.slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
      });
    }

    if (pages.length === 0) {
      highlightCount.textContent = '';
      const emptyTitle = tokens.length > 0 ? 'No results' : `No highlights in ${preset.name || 'this tag'}`;
      const emptyMessage = tokens.length > 0
        ? 'Try a different keyword.'
        : 'Highlights you create with this preset will appear here.';
      renderTagEmptyState(highlightsContainer, emptyTitle, emptyMessage);
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

function renderTagEmptyState(container, titleText, messageText) {
  // Tag names can come from users or imports, so insert them as text rather than HTML.
  container.replaceChildren();
  const empty = document.createElement('div');
  empty.className = 'empty-state';
  const title = document.createElement('div');
  title.className = 'empty-state-title';
  title.textContent = titleText;
  empty.appendChild(title);
  empty.appendChild(document.createTextNode(messageText));
  container.appendChild(empty);
}

function libraryIconMarkup(iconName) {
  const paths = {
    back: '<path d="m15 18-6-6 6-6"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    chevron: '<path d="m8 10 4 4 4-4"/>',
    folder: '<path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H10l2 2h6.5A2.5 2.5 0 0 1 21 8.5v9A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5z"/>',
    comment: '<path d="M6 3h12a3 3 0 0 1 3 3v9l-6 6H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3z"/><path d="M15 21v-6h6"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    star: '<path d="M12 2.8l2.82 5.72 6.31.92-4.57 4.45 1.08 6.29L12 17.22l-5.64 2.96 1.08-6.29-4.57-4.45 6.31-.92L12 2.8z"/>',
    trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
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
    refreshLibrary();
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

function loadFoldersView(requestVersion) {
  chrome.storage.local.get(null, all => {
    if (!isCurrentLibraryLoad(requestVersion)) return;
    setActiveLibraryPresets(all.highlightSettings);
    const storageFixups = {};
    Object.keys(all).forEach(storageKey => {
      const page = getNormalizedLibraryPage(all, storageKey, storageFixups);
      if (page) all[storageKey] = page.highlights;
    });
    if (Object.keys(storageFixups).length > 0) chrome.storage.local.set(storageFixups);
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
  add.innerHTML = '<span class="preset-add-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></span>';
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
    <span class="preset-delete-start-icon preset-delete-x-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></span>
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
  keepFolderHighlightsBtn.textContent = hasHighlights ? 'Keep highlights' : 'Delete folder';
  keepFolderHighlightsBtn.setAttribute(
    'aria-label',
    hasHighlights ? 'Delete folder and keep highlights as unfiled' : 'Delete empty folder'
  );
  deleteFolderHighlightsBtn.setAttribute(
    'aria-label',
    'Delete folder and move highlights to Recently Deleted'
  );
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
  return queueLibraryHighlightMutation(() => queueFolderMutation(() => new Promise((resolve, reject) => {
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
        if (emptyKeys.length > 0) {
          chrome.storage.local.remove(emptyKeys, () => {
            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
            else finish();
          });
        }
        else finish();
      });
    });
  }))).then(folder => {
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
function loadAllHighlights(requestVersion) {
  chrome.storage.local.get(null, (all) => {
    if (!isCurrentLibraryLoad(requestVersion)) return;
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

function loadFavoriteHighlights(requestVersion) {
  chrome.storage.local.get(null, (all) => {
    if (!isCurrentLibraryLoad(requestVersion)) return;
    setActiveLibraryPresets(all.highlightSettings);
    activeLibraryFolders = normalizeFolders(all[FOLDERS_KEY]);
    renderLibraryFolderChildren(activeLibraryFolders);
    const index = all.highlightIndex || {};
    const pages = [];
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

function loadCommentHighlights(requestVersion) {
  chrome.storage.local.get(null, all => {
    if (!isCurrentLibraryLoad(requestVersion)) return;
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
          <div class="empty-state-title">${tokens.length > 0 ? 'No results' : 'No notes yet'}</div>
          ${tokens.length > 0 ? 'Try a different keyword.' : 'Add a note to a highlight to see it here.'}
        </div>
      `;
      return;
    }
    pages.sort((a, b) => (b.lastUpdated || 0) - (a.lastUpdated || 0));
    const totalCount = pages.reduce((count, page) => count + page.highlights.length, 0);
    renderHighlights(pages, totalCount, {
      countLabel: 'notes',
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

function loadRecentlyDeleted(requestVersion) {
  chrome.storage.local.get([RECENTLY_DELETED_KEY, 'highlightSettings'], (result) => {
    if (!isCurrentLibraryLoad(requestVersion)) return;
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
  emptyTrashBtn.addEventListener('click', () => openEmptyTrashDialog(emptyTrashBtn));
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
      restoreBtn.addEventListener('click', () => {
        queueLibraryHighlightMutation(() => restoreFromTrash(entry.trashId)).then(restored => {
          if (!restored) showToast('Could not restore highlight');
        });
      });

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'snippet-delete-forever';
      delBtn.textContent = 'Delete forever';
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

function setEmptyTrashDialogBusy(isBusy, errorMessage = '') {
  emptyTrashPending = isBusy;
  emptyTrashDialog?.setAttribute('aria-busy', String(isBusy));
  if (cancelEmptyTrashBtn) cancelEmptyTrashBtn.disabled = isBusy;
  if (confirmEmptyTrashBtn) confirmEmptyTrashBtn.disabled = isBusy;
  if (emptyTrashDialogError) emptyTrashDialogError.textContent = errorMessage;
}

function getEmptyTrashDialogDescription(count) {
  const scope = count === 1 ? '1 highlight' : `all ${count} highlights`;
  return `Delete ${scope} forever? This cannot be undone.`;
}

function openEmptyTrashDialog(trigger) {
  if (emptyTrashOpenPending || emptyTrashPending) return;
  if (emptyTrashDialog?.open) {
    cancelEmptyTrashBtn?.focus({ preventScroll: true });
    return;
  }
  emptyTrashOpenPending = true;
  chrome.storage.local.get(RECENTLY_DELETED_KEY, result => {
    emptyTrashOpenPending = false;
    if (chrome.runtime.lastError) {
      showToast('Could not check Recently Deleted');
      return;
    }
    const trash = Array.isArray(result[RECENTLY_DELETED_KEY]) ? result[RECENTLY_DELETED_KEY] : [];
    if (trash.length === 0) {
      showToast('Recently Deleted is already empty');
      refreshLibrary();
      return;
    }
    emptyTrashDialogDescription.textContent = getEmptyTrashDialogDescription(trash.length);
    emptyTrashDialogTrigger = trigger;
    setEmptyTrashDialogBusy(false);

    if (!emptyTrashDialog || typeof emptyTrashDialog.showModal !== 'function') {
      if (window.confirm(emptyTrashDialogDescription.textContent)) {
        emptyTrashDialogTrigger = null;
        emptyRecentlyDeleted();
      } else {
        emptyTrashDialogTrigger = null;
      }
      return;
    }
    emptyTrashDialog.returnValue = '';
    try {
      emptyTrashDialog.showModal();
    } catch {
      emptyTrashDialogTrigger = null;
      showToast('Could not open confirmation');
      return;
    }
    requestAnimationFrame(() => cancelEmptyTrashBtn?.focus({ preventScroll: true }));
  });
}

function emptyRecentlyDeleted() {
  if (emptyTrashPending) return;
  setEmptyTrashDialogBusy(true);
  queueLibraryHighlightMutation(() => new Promise((resolve, reject) => {
    chrome.storage.local.get(RECENTLY_DELETED_KEY, result => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      const trash = Array.isArray(result[RECENTLY_DELETED_KEY]) ? result[RECENTLY_DELETED_KEY] : [];
      if (trash.length === 0) {
        resolve(0);
        return;
      }
      chrome.storage.local.set({ [RECENTLY_DELETED_KEY]: [] }, () => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(trash.length);
      });
    });
  })).then(deletedCount => {
    setEmptyTrashDialogBusy(false);
    if (emptyTrashDialog?.open) emptyTrashDialog.close('confirm');
    showToast(deletedCount > 0 ? 'Recently Deleted emptied' : 'Recently Deleted is already empty');
    refreshLibrary();
  }).catch(() => {
    if (emptyTrashDialog?.open) {
      setEmptyTrashDialogBusy(false, 'Could not delete these highlights. Try again.');
      cancelEmptyTrashBtn?.focus({ preventScroll: true });
    } else {
      setEmptyTrashDialogBusy(false);
      showToast('Could not empty Recently Deleted');
    }
  });
}

cancelEmptyTrashBtn?.addEventListener('click', () => emptyTrashDialog?.close('cancel'));
confirmEmptyTrashBtn?.addEventListener('click', emptyRecentlyDeleted);
emptyTrashDialog?.addEventListener('cancel', event => {
  if (emptyTrashPending) event.preventDefault();
});
emptyTrashDialog?.addEventListener('close', () => {
  const trigger = emptyTrashDialogTrigger;
  emptyTrashDialogTrigger = null;
  setEmptyTrashDialogBusy(false);
  requestAnimationFrame(() => {
    if (trigger?.isConnected) trigger.focus({ preventScroll: true });
  });
});

function restoreFromTrash(trashId) {
  return new Promise(resolve => chrome.storage.local.get([RECENTLY_DELETED_KEY, 'highlightIndex', FOLDERS_KEY], (result) => {
    if (chrome.runtime.lastError) {
      resolve(false);
      return;
    }
    const trash = Array.isArray(result[RECENTLY_DELETED_KEY]) ? result[RECENTLY_DELETED_KEY] : [];
    const entry = trash.find(t => t.trashId === trashId);
    if (!entry || !entry.highlight) {
      resolve(false);
      return;
    }

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
      if (chrome.runtime.lastError) {
        resolve(false);
        return;
      }
      let highlights = r2[key] || [];
      const newTrash = trash.filter(t => t.trashId !== trashId);
      if (highlights.some(h => h.id === restoredHighlight.id)) {
        chrome.storage.local.set({ [RECENTLY_DELETED_KEY]: newTrash }, () => {
          refreshLibrary();
          resolve(!chrome.runtime.lastError);
        });
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
      }, () => {
        refreshLibrary();
        resolve(!chrome.runtime.lastError);
      });
    });
  }));
}

function deleteForeverFromTrash(trashId) {
  queueLibraryHighlightMutation(() => new Promise((resolve, reject) => {
    chrome.storage.local.get(RECENTLY_DELETED_KEY, result => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      const trash = Array.isArray(result[RECENTLY_DELETED_KEY]) ? result[RECENTLY_DELETED_KEY] : [];
      const newTrash = trash.filter(entry => entry?.trashId !== trashId);
      if (newTrash.length === trash.length) {
        resolve(false);
        return;
      }
      chrome.storage.local.set({ [RECENTLY_DELETED_KEY]: newTrash }, () => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(true);
      });
    });
  })).then(() => {
    refreshLibrary();
  }).catch(() => {
    showToast('Could not delete highlight');
    refreshLibrary();
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
    : (options.countLabel === 'notes' ? (totalCount === 1 ? 'note' : 'notes') : 'saved');
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
    clearBtn.addEventListener('click', () => queueLibraryHighlightMutation(() => deletePageHighlights(page.url)));

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

      const colorSlot = createLibraryTagSelector(page.url, hl);
      const folder = createLibraryFolderSelector(page.url, hl);
      const comment = createLibraryCommentSelector(page.url, hl);
      const star = createStarButton(page.url, hl);

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'library-action-btn snippet-delete is-danger';
      del.innerHTML = libraryIconMarkup('trash');
      del.title = 'Delete highlight';
      del.setAttribute('aria-label', 'Delete highlight');
      del.addEventListener('click', () => queueLibraryHighlightMutation(() => deleteHighlight(page.url, hl.id)));

      const rowActions = document.createElement('div');
      rowActions.className = 'snippet-item-actions';
      rowActions.appendChild(colorSlot);
      rowActions.appendChild(folder);
      rowActions.appendChild(comment);
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

  return new Promise(resolve => chrome.storage.local.get([key, 'highlightIndex', RECENTLY_DELETED_KEY], (result) => {
    let highlights = result[key] || [];
    const removed = highlights.find(h => h.id === highlightId);
    if (!removed) {
      refreshLibrary();
      resolve(false);
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
      chrome.storage.local.set({ [key]: highlights, [RECENTLY_DELETED_KEY]: trash }, () => {
        refreshLibrary();
        resolve(!chrome.runtime.lastError);
      });
    } else {
      delete index[url];
      // Persist the recoverable copy before clearing the final active record.
      chrome.storage.local.set({ [RECENTLY_DELETED_KEY]: trash }, () => {
        if (chrome.runtime.lastError) {
          refreshLibrary();
          resolve(false);
          return;
        }
        chrome.storage.local.set({ [key]: [], highlightIndex: index }, () => {
          if (chrome.runtime.lastError) {
            refreshLibrary();
            resolve(false);
            return;
          }
          // Keep the successful result's storage shape unchanged when cleanup succeeds.
          chrome.storage.local.remove(key, () => {
            refreshLibrary();
            resolve(!chrome.runtime.lastError);
          });
        });
      });
    }
  }));
}

// Delete all highlights for a page (soft-delete into Recently Deleted)
function deletePageHighlights(url) {
  const key = 'highlights_' + url;

  return new Promise(resolve => chrome.storage.local.get([key, 'highlightIndex', RECENTLY_DELETED_KEY], (result) => {
    const highlights = result[key] || [];
    if (highlights.length === 0) {
      refreshLibrary();
      resolve({ status: 'empty', count: 0 });
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
    // Persist all recoverable copies before clearing active page data.
    chrome.storage.local.set({ [RECENTLY_DELETED_KEY]: trash }, () => {
      if (chrome.runtime.lastError) {
        refreshLibrary();
        resolve({ status: 'error', count: 0 });
        return;
      }
      chrome.storage.local.set({ [key]: [], highlightIndex: index }, () => {
        if (chrome.runtime.lastError) {
          refreshLibrary();
          resolve({ status: 'error', count: 0 });
          return;
        }
        // Keep the successful result's storage shape unchanged when cleanup succeeds.
        chrome.storage.local.remove(key, () => {
          refreshLibrary();
          resolve(chrome.runtime.lastError ? { status: 'error', count: 0 } : { status: 'cleared', count: highlights.length });
        });
      });
    });
  }));
}

// Live-update when highlights or trash change from another tab
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (backupReplacementPending) return;

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
    closeLibraryFolderPopover({ immediate: true });
  }
  if (hasFolderExpansionChange) {
    setFoldersExpanded(changes[FOLDERS_EXPANDED_KEY].newValue === true);
  }
  if (hasTrashChange && emptyTrashDialog?.open && !emptyTrashPending) {
    const nextTrash = Array.isArray(changes[RECENTLY_DELETED_KEY].newValue)
      ? changes[RECENTLY_DELETED_KEY].newValue
      : [];
    if (nextTrash.length === 0) {
      emptyTrashDialog.close('external-empty');
      showToast('Recently Deleted is already empty');
    } else {
      emptyTrashDialogDescription.textContent = getEmptyTrashDialogDescription(nextTrash.length);
    }
  }

  const folderChangeAffectsCurrentView = hasFolderChange && currentLibraryView === 'folders';
  if ((hasHighlightChange || hasTrashChange || folderChangeAffectsCurrentView) && isLibraryTabActive()) {
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
  chrome.storage.local.set({ [SIDEBAR_COLLAPSED_KEY]: collapsed }, () => {
    if (chrome.runtime.lastError) showToast('Could not save sidebar preference');
  });
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
const hasValidTabParam = ['library', 'settings', 'guide', 'about'].includes(tabParam);
if (hasValidTabParam) {
  switchToTab(tabParam);
}

// Initialize sidebar state for active tab on load
const activeTab = document.querySelector('.tab-btn.active');
if (activeTab && !hasValidTabParam) {
  resetSidebarForTab(activeTab.dataset.tab);
}
