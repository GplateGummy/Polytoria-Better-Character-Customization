// ==UserScript==
// @name         Polytoria Better Character Customization
// @namespace    polytoria-better-character-customization
// @version      6.7
// @description  Removes pagination from every wardrobe tab (except Outfits) and loads all items.
// @match        https://polytoria.com/my/avatar*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  let currentAbortController = null;
  const wardrobeCache = {};
  let activeType = 'all';
  let activeAccessoryType = 'all';
  let activeSearchValue = '';

  const EMPTY_WARDROBE = `
    <div class="text-muted" style="padding:37px 30px;">
      <h1 class="display-3"><i class="fas fa-box-open"></i></h1>
      <h6 class="mb-0">
        You do not have any items matching this type or search query.
        Find new items in the <a href="/store">store</a>!
      </h6>
    </div>`;

  function escapeHTML(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function hidePagination() {
    const nav = document.getElementById('pagination');
    if (nav) nav.style.display = 'none';
  }

  function showStatus(msg) {
    let badge = document.getElementById('pwa-status-badge');
    if (!badge) {
      badge = document.createElement('span');
      badge.id = 'pwa-status-badge';
      badge.style.cssText = 'margin-left:8px;font-size:0.78em;vertical-align:middle;color:#9e9e9e;';
      const search = document.getElementById('search');
      if (search) search.after(badge);
    }
    badge.textContent = msg;
  }

  async function fetchAllItems(type, accessoryType, signal) {
    const cacheKey = `${type}_${accessoryType}`;
    if (wardrobeCache[cacheKey]) {
      return wardrobeCache[cacheKey];
    }

    const base = `/api/avatar/wardrobe?type=${type}&accessoryType=${accessoryType}&search=&page=`;
    const first = await fetch(base + '1', { signal }).then(r => r.json());
    const { lastPage } = first.meta;
    const items = [...first.data];

    if (lastPage > 1) {
      const pages = await Promise.all(
        Array.from({ length: lastPage - 1 }, (_, i) =>
          fetch(base + (i + 2), { signal }).then(r => r.json())
        )
      );
      pages.forEach(p => items.push(...p.data));
    }

    wardrobeCache[cacheKey] = items;
    return items;
  }

  function buildWardrobeCard(item, searchTerm) {
    let accessoryLabel = item.typeString;
    if (item.type === 'hat') {
      let aType = item.accessoryType ?? 'Hat';
      if (aType === 'headAccessory') aType = 'headCover';
      aType = aType.replace(/([A-Z])/g, ' $1').trim();
      accessoryLabel = aType.charAt(0).toUpperCase() + aType.slice(1);
    }

    const creatorText = item.isOfficial
      ? accessoryLabel
      : `by <a href="${item.creatorUrl}" class="text-reset">${escapeHTML(item.creatorName)}</a>`;

    let highlightedName = escapeHTML(item.name);
    if (searchTerm) {
      const escapedSearch = escapeHTML(searchTerm);
      const regexStr = escapedSearch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`((?:${regexStr})+)`, 'gi');

      const customHighlightStyle = `
        background-color: #3bafff;
        color: #ffffff;
        padding: 0.75px 3.75px;
        border-radius: 5px;
        font-weight: 600;
        text-shadow: none;
        display: inline-block;
        line-height: 1;
      `;

      highlightedName = highlightedName.replace(
        regex,
        `<mark style="${customHighlightStyle}">$1</mark>`
      );
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'col-auto';
    wrapper.innerHTML = `
      <div style="max-width:150px;">
        <div class="card mb-2 avatar-item-container">
          <div class="p-2" style="cursor:pointer;position:relative;overflow:hidden;">
            <img src="${item.thumbnailUrl}" class="img-fluid" alt="${escapeHTML(item.name)}">
          </div>
        </div>
        <a href="/store/${item.id}" class="text-reset">
          <h6 class="text-truncate mb-0" style="padding-top: 2px; padding-bottom: 2px;">${highlightedName}</h6>
        </a>
        <small class="text-muted d-block">${creatorText}</small>
      </div>`;

    wrapper.querySelector('.p-2').addEventListener('click', () => {
      if (typeof window.wearAsset === 'function') window.wearAsset(item.id);
    });

    return wrapper;
  }

  function renderItems(allItems, grid) {
    grid.innerHTML = '';

    const searchBox = document.getElementById('search');
    if (searchBox) activeSearchValue = searchBox.value;

    const query = activeSearchValue.trim().toLowerCase();

    const filteredItems = query
      ? allItems.filter(item => item.name.toLowerCase().includes(query))
      : allItems;

    if (filteredItems.length === 0) {
      grid.classList.remove('itemgrid');
      grid.classList.add('row');
      grid.innerHTML = EMPTY_WARDROBE;
      showStatus(query ? '0 items found' : '');
      return;
    }

    grid.classList.remove('row');
    grid.classList.add('itemgrid');

    const frag = document.createDocumentFragment();
    filteredItems.forEach(item => frag.appendChild(buildWardrobeCard(item, activeSearchValue.trim())));
    grid.appendChild(frag);

    if (query) {
      showStatus(`Found ${filteredItems.length} of ${allItems.length} items`);
    } else {
      showStatus(`${allItems.length} items`);
    }
  }

  async function populateWardrobe(type, accessoryType) {
    const grid = document.getElementById('wardrobe-assets');
    if (!grid) return;

    const cacheKey = `${type}_${accessoryType}`;

    if (wardrobeCache[cacheKey]) {
      renderItems(wardrobeCache[cacheKey], grid);
      return;
    }

    if (currentAbortController) {
      currentAbortController.abort();
    }

    currentAbortController = new AbortController();
    const signal = currentAbortController.signal;

    grid.innerHTML = '<div class="text-muted p-4"><i class="fas fa-spinner fa-spin me-2"></i>Loading all items…</div>';
    hidePagination();

    try {
      const items = await fetchAllItems(type, accessoryType, signal);
      if (signal.aborted) return;

      renderItems(items, grid);
    } catch (error) {
      if (error.name === 'AbortError') return;

      console.error('Error fetching wardrobe items:', error);
      if (!signal.aborted) {
        grid.classList.remove('itemgrid');
        grid.classList.add('row');
        grid.innerHTML = `<div class="text-danger m-4" style="width: 100%;">
          <h6 class="mb-1"><i class="fas fa-exclamation-triangle me-2"></i>Failed to load items</h6>
          <p class="mb-0 small text-danger" style="opacity: 0.8;">You might be hitting rate limits. Please wait a moment or refresh the page.</p>
        </div>`;
      }
    }
  }


  document.addEventListener('click', (e) => {
    const tab = e.target.closest('.nav-link[data-wardrobe-tab]');
    if (tab) {
      const targetType = tab.dataset.wardrobeTab;
      if (targetType === 'outfits') {
        showStatus('');
        activeType = 'outfits';
        return;
      }

      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      activeType = targetType;
      activeAccessoryType = 'all';
      populateWardrobe(activeType, activeAccessoryType);
      return;
    }

    const accTab = e.target.closest('.nav-link[data-wardrobe-accessory-tab]');
    if (accTab) {
      if (activeType === 'outfits') return;

      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      activeAccessoryType = accTab.dataset.wardrobeAccessoryTab;
      populateWardrobe(activeType, activeAccessoryType);
    }
  }, true);

  let debounceTimer;
  const handleSearch = (e) => {
    if (activeType === 'outfits') return;
    if (e.target && e.target.id === 'search') {
      e.stopImmediatePropagation();

      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        activeSearchValue = e.target.value;
        populateWardrobe(activeType, activeAccessoryType);
      }, 100);
    }
  };

  document.addEventListener('keyup', handleSearch, true);
  document.addEventListener('input', handleSearch, true);
  document.addEventListener('change', handleSearch, true);

  document.addEventListener('keydown', (e) => {
    if (e.target && e.target.id === 'search' && e.key === 'Enter') {
      if (activeType !== 'outfits') {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    }
  }, true);

  function waitForWardrobe() {
    const grid = document.getElementById('wardrobe-assets');
    if (!grid) {
      setTimeout(waitForWardrobe, 100);
      return;
    }

    const observer = new MutationObserver((_, obs) => {
      if (grid.children.length > 0) {
        obs.disconnect();

        grid.style.maxHeight = 204.2 * 3 + 'px';
        grid.style.overflowY = 'auto';
        grid.style.overflowX = 'hidden';
        grid.style.paddingRight = '10px';

        const searchBox = document.getElementById('search');
        if (searchBox) activeSearchValue = searchBox.value;

        populateWardrobe('all', 'all');
      }
    });

    observer.observe(grid, { childList: true });
  }

  waitForWardrobe();
})();
