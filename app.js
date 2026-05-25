const TMDB_API_KEY = "c992fe96a2f09932659dbc9effcc6b6d";

// --- STATE ---
let isUnlocked = false;
let catalog      = [];
let myList       = [];
let currentFilter   = 'all';
let currentDetailId = null;
let nextId = 400;

// Image cache: mal_id/tmdb_id → image URL (persisted in localStorage)
const IMG_CACHE_KEY = 'twl_img_cache';
let imgCache = {};

const SITE_ACCESS_PASSWORD = 'lee123';

// ============================================================
// CACHE BUST — wipes stale wrong covers on first load
// ============================================================
(function bustOldCache() {
  const bustedKey = 'twl_cache_busted_v7';
  if (localStorage.getItem(bustedKey)) return;
  localStorage.removeItem('twl_img_cache');
  localStorage.removeItem('twl_catalog_version'); // force catalog re-merge
  localStorage.setItem(bustedKey, '1');
})();


window.addEventListener('DOMContentLoaded', () => {
  loadImgCache();
  loadCatalog();
  isUnlocked = sessionStorage.getItem('twl_unlocked') === '1';
  if (isUnlocked) loadMyList();
  enterApp();
});

// ============================================================
// IMAGE CACHE
// ============================================================
function loadImgCache() {
  try { imgCache = JSON.parse(localStorage.getItem(IMG_CACHE_KEY)) || {}; }
  catch { imgCache = {}; }
}
function saveImgCache() {
  localStorage.setItem(IMG_CACHE_KEY, JSON.stringify(imgCache));
}

// ============================================================
// API FETCHING
// ============================================================

// Jikan: fetch by MAL ID (used for anime, which have reliable IDs)
async function fetchJikanById(mal_id, type = 'anime') {
  const cacheKey = `jikan_${type}_id_${mal_id}`;
  if (imgCache[cacheKey]) return imgCache[cacheKey];
  try {
    const res = await fetch(`https://api.jikan.moe/v4/${type}/${mal_id}`);
    if (!res.ok) return null;
    const json = await res.json();
    const url = json?.data?.images?.jpg?.large_image_url
              || json?.data?.images?.jpg?.image_url || null;
    if (url) { imgCache[cacheKey] = url; saveImgCache(); }
    return url;
  } catch { return null; }
}

// Jikan: search by title — used for manga so we always get the right cover
// regardless of whether the ID is correct. Searches, then picks the top result
// whose title closely matches what we expect.
async function fetchJikanBySearch(title, type = 'manga') {
  const cacheKey = `jikan_${type}_search_${title.toLowerCase().replace(/\s+/g, '_')}`;
  if (imgCache[cacheKey]) return imgCache[cacheKey];
  try {
    const encoded = encodeURIComponent(title);
    const res = await fetch(
      `https://api.jikan.moe/v4/${type}?q=${encoded}&limit=5&order_by=members&sort=desc`
    );
    if (!res.ok) return null;
    const json = await res.json();
    const results = json?.data || [];
    if (!results.length) return null;

    // Try to find a result whose title matches closely
    const titleLower = title.toLowerCase().replace(/[^a-z0-9]/g, '');
    const best = results.find(r => {
      const t = (r.title || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const te = (r.title_english || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      return t.includes(titleLower) || titleLower.includes(t) ||
             te.includes(titleLower) || titleLower.includes(te);
    }) || results[0]; // fallback to top result by members

    const url = best?.images?.jpg?.large_image_url
              || best?.images?.jpg?.image_url || null;
    if (url) { imgCache[cacheKey] = url; saveImgCache(); }
    return url;
  } catch { return null; }
}

// TMDB API — requires free API key
async function fetchTMDBImage(tmdb_id) {
  if (!TMDB_API_KEY) return null;
  const cacheKey = `tmdb_${tmdb_id}`;
  if (imgCache[cacheKey]) return imgCache[cacheKey];
  try {
    const res = await fetch(
      `https://api.themoviedb.org/3/tv/${tmdb_id}?api_key=${TMDB_API_KEY}`
    );
    if (!res.ok) return null;
    const json = await res.json();
    const path = json?.poster_path;
    if (!path) return null;
    const url = `https://image.tmdb.org/t/p/w500${path}`;
    imgCache[cacheKey] = url; saveImgCache();
    return url;
  } catch { return null; }
}

// Fetch all missing images — anime uses ID lookup, manga uses title search
async function fetchMissingImages() {
  const toFetch = catalog.filter(item => !item.img && !item._fetchedImg);
  if (!toFetch.length) return;

  for (let i = 0; i < toFetch.length; i++) {
    const item = toFetch[i];
    let url = null;

    if (item.category === 'anime') {
      // Search by title — always gets the right cover regardless of ID
      url = await fetchJikanBySearch(item.title, 'anime');
      await delay(450);
    } else if (item.category === 'manga') {
      // Search by title for accuracy
      url = await fetchJikanBySearch(item.title, 'manga');
      await delay(450);
    } else if (item.category === 'tv' && item.tmdb_id) {
      url = await fetchTMDBImage(item.tmdb_id);
      await delay(100);
    }

    if (url) {
      const idx = catalog.findIndex(c => c.id === item.id);
      if (idx !== -1) {
        catalog[idx]._fetchedImg = url;
        updateCardImage(item.id, url);
      }
    }
  }
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// Resolve the best image for an item (manual > fetched > nothing)
function resolveImg(item) {
  return item.img || item._fetchedImg || '';
}

// After grid renders, kick off API fetches for missing covers
function scheduleFetch() {
  // Small delay so UI paints first
  setTimeout(fetchMissingImages, 300);
}

// Update a card's poster after async fetch
function updateCardImage(id, url) {
  const card = document.querySelector(`.card[data-id="${id}"]`);
  if (!card) return;
  const poster = card.querySelector('.card-poster');
  if (!poster) return;
  let img = poster.querySelector('img');
  const placeholder = poster.querySelector('.card-placeholder');
  if (!img) {
    img = document.createElement('img');
    img.alt = '';
    img.onerror = function() { this.style.display = 'none'; if(placeholder) placeholder.style.display = 'flex'; };
    poster.insertBefore(img, poster.firstChild);
  }
  img.src = url;
  img.style.display = 'block';
  if (placeholder) placeholder.style.display = 'none';

  // Also refresh hero if it's showing this item
  const banner = document.getElementById('hero-banner');
  if (banner && parseInt(banner.dataset.id) === id) {
    banner.style.backgroundImage = `url('${url}')`;
  }
}

// ============================================================
// AUTH SCREEN SWITCHING
// ============================================================
function showLogin() {
  document.getElementById('auth-login').classList.remove('hidden');
  document.getElementById('login-password').value = '';
  document.getElementById('login-error').classList.add('hidden');
}

function goToLogin() {
  document.getElementById('login-screen').classList.add('active');
  document.getElementById('app-screen').classList.remove('active');
  showLogin();
}

function handleLogin() {
  const password = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-error');

  if (!password) {
    errEl.textContent = 'Please enter the password.';
    errEl.classList.remove('hidden');
    return;
  }

  if (password !== SITE_ACCESS_PASSWORD) {
    errEl.textContent = 'Incorrect password.';
    errEl.classList.remove('hidden');
    return;
  }

  errEl.classList.add('hidden');
  isUnlocked = true;
  sessionStorage.setItem('twl_unlocked', '1');
  loadMyList();
  enterApp();
}

function handleLogout() {
  if (!isUnlocked) return;
  if (!confirm('Log out and lock the site?')) return;
  sessionStorage.removeItem('twl_unlocked');
  isUnlocked = false;
  myList = [];
  enterApp();
}

function enterApp() {
  if (!isUnlocked) {
    document.getElementById('login-screen').classList.add('active');
    document.getElementById('app-screen').classList.remove('active');
    document.getElementById('logout-nav-btn').style.display = 'none';
    return;
  }

  document.getElementById('login-screen').classList.remove('active');
  document.getElementById('app-screen').classList.add('active');
  document.getElementById('logout-nav-btn').style.display = '';
  document.getElementById('user-badge').textContent = 'Marvin Lee';
  document.getElementById('admin-toolbar').classList.remove('hidden');
  document.getElementById('mylist-btn').classList.remove('hidden');

  renderGrid();
  scheduleFetch();
}

// ============================================================
// CATALOG PERSISTENCE
// ============================================================

// Version stamp — bump this whenever DEFAULT_ITEMS changes significantly
// so returning users automatically get the new defaults merged in.
const CATALOG_VERSION = 4;

function loadCatalog() {
  const saved      = localStorage.getItem('twl_catalog');
  const savedVer   = parseInt(localStorage.getItem('twl_catalog_version') || '0');
  const defaultMap = Object.fromEntries(DEFAULT_ITEMS.map(i => [i.id, i]));

  if (saved && savedVer >= CATALOG_VERSION) {
    const parsed = JSON.parse(saved);
    // Build a map of what's saved so we can detect custom edits
    const savedMap = Object.fromEntries(parsed.map(i => [i.id, i]));

    // Start from DEFAULT_ITEMS so we always have all 45 entries,
    // then overlay any admin edits that were saved
    catalog = DEFAULT_ITEMS.map(def => ({
      ...def,
      _fetchedImg: '',
      // If admin edited this item, apply those overrides
      ...(savedMap[def.id] ? {
        title:    savedMap[def.id].title    ?? def.title,
        desc:     savedMap[def.id].desc     ?? def.desc,
        tags:     savedMap[def.id].tags     ?? def.tags,
        rating:   savedMap[def.id].rating   ?? def.rating,
        year:     savedMap[def.id].year     ?? def.year,
        img:      savedMap[def.id].img      ?? def.img,
        _fetchedImg: savedMap[def.id]._fetchedImg || '',
      } : {})
    }));

    // Also keep any admin-added custom items (id not in DEFAULT_ITEMS)
    const defaultIds = new Set(DEFAULT_ITEMS.map(i => i.id));
    const customItems = parsed.filter(i => !defaultIds.has(i.id));
    catalog = [...catalog, ...customItems.map(i => ({ ...i, _fetchedImg: i._fetchedImg || '' }))];

    nextId = Math.max(...catalog.map(i => i.id), 399) + 1;
  } else {
    // First load or outdated version — start fresh from defaults
    catalog = DEFAULT_ITEMS.map(i => ({ ...i, _fetchedImg: '' }));
    nextId = 400;
    saveCatalog();
  }

  // Restore any already-fetched images from the image cache
  catalog.forEach(item => {
    if (!item.img && !item._fetchedImg) {
      const titleKey = item.title.toLowerCase().replace(/\s+/g, '_');
      if (item.category === 'anime')
        item._fetchedImg = imgCache[`jikan_anime_search_${titleKey}`] || '';
      else if (item.category === 'manga')
        item._fetchedImg = imgCache[`jikan_manga_search_${titleKey}`] || '';
      else if (item.category === 'tv' && item.tmdb_id)
        item._fetchedImg = imgCache[`tmdb_${item.tmdb_id}`] || '';
    }
  });
}

function saveCatalog() {
  localStorage.setItem('twl_catalog', JSON.stringify(catalog));
  localStorage.setItem('twl_catalog_version', String(CATALOG_VERSION));
}

function loadMyList() {
  const key = 'twl_mylist';
  const saved = localStorage.getItem(key);
  myList = saved ? JSON.parse(saved).map(id => parseInt(id)) : [];
}

function saveMyList() {
  localStorage.setItem('twl_mylist', JSON.stringify(myList));
}

// ============================================================
// GRID RENDER
// ============================================================
function renderGrid() {
  const grid = document.getElementById('card-grid');
  const items = currentFilter === 'all' ? catalog : catalog.filter(i => i.category === currentFilter);
  const label = { all: 'All Titles', anime: 'Anime', manga: 'Manga', tv: 'TV Shows' }[currentFilter];
  document.getElementById('section-label').textContent = label;

  grid.innerHTML = '';
  items.forEach(item => {
    const inList = myList.includes(item.id);
    const imgSrc = resolveImg(item);
    const card = document.createElement('div');
    card.className = 'card';
    card.setAttribute('data-id', item.id);
    card.innerHTML = `
      <div class="card-poster" onclick="openDetail(${item.id})">
        ${imgSrc
          ? `<img src="${imgSrc}" alt="${item.title}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" />`
          : ''}
        <div class="card-placeholder" style="${imgSrc ? 'display:none' : ''}">
          <span>${getCatIcon(item.category)}</span>
          <small>${item.category.toUpperCase()}</small>
        </div>
        <div class="card-overlay">
          <div class="card-rating">★ ${item.rating}</div>
          <div class="card-cat-badge">${item.category}</div>
        </div>
      </div>
      <div class="card-body">
        <div class="card-title" onclick="openDetail(${item.id})">${item.title}</div>
        <div class="card-year">${item.year}</div>
        <button class="card-action-btn ${inList ? 'completed' : ''}" onclick="toggleComplete(${item.id}, this)">
          ${inList ? '✓ Completed' : 'Mark Complete'}
        </button>
      </div>`;
    grid.appendChild(card);
  });

  setHero(items);
}

function getCatIcon(cat) {
  return { anime: '⛩', manga: '📖', tv: '📺' }[cat] || '🎬';
}

function filterCategory(cat, btn) {
  currentFilter = cat;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderGrid();
}

// ============================================================
// HERO
// ============================================================
function setHero(items) {
  const pool = items || catalog;
  if (!pool.length) return;
  const item = pool[Math.floor(Math.random() * Math.min(pool.length, 6))];
  document.getElementById('hero-title').textContent  = item.title;
  document.getElementById('hero-desc').textContent   = item.desc;
  document.getElementById('hero-cat').textContent    = item.category.toUpperCase();
  const banner = document.getElementById('hero-banner');
  const img = resolveImg(item);
  banner.style.backgroundImage = img ? `url('${img}')` : 'none';
  banner.dataset.id = item.id;

  const inList = myList.includes(item.id);
  const btn = document.getElementById('hero-complete-btn');
  btn.textContent = inList ? '✓ Completed' : 'Mark Complete';
  btn.classList.toggle('completed', inList);
  btn.style.display = '';
  btn.onclick = heroMarkComplete;
}

function heroMarkComplete() {
  const id = parseInt(document.getElementById('hero-banner').dataset.id);
  toggleCompleteById(id);
  setHero();
}

// ============================================================
// MY LIST
// ============================================================
function toggleComplete(id, btn) {
  id = parseInt(id);
  toggleCompleteById(id);
  const inList = myList.includes(id);
  btn.textContent = inList ? '✓ Completed' : 'Mark Complete';
  btn.classList.toggle('completed', inList);
}

function toggleCompleteById(id) {
  id = parseInt(id); // normalize to number
  const idx = myList.indexOf(id);
  if (idx === -1) myList.push(id); else myList.splice(idx, 1);
  saveMyList();
  renderMyList();
}

function toggleMyList() {
  if (!isUnlocked) { goToLogin(); return; }
  const panel = document.getElementById('mylist-panel');
  panel.classList.toggle('hidden');
  if (!panel.classList.contains('hidden')) renderMyList();
}

function renderMyList() {
  const container = document.getElementById('mylist-items');
  if (!myList.length) {
    container.innerHTML = '<div class="mylist-empty">Nothing here yet. Start adding!</div>';
    return;
  }
  container.innerHTML = '';
  myList.forEach(rawId => {
    const id = parseInt(rawId); // normalize in case saved as string
    const item = catalog.find(i => parseInt(i.id) === id);
    if (!item) return;
    const img = resolveImg(item);
    const div = document.createElement('div');
    div.className = 'mylist-item';
    div.innerHTML = `
      <div class="mylist-thumb">
        ${img ? `<img src="${img}" alt="" />` : `<span>${getCatIcon(item.category)}</span>`}
      </div>
      <div class="mylist-info">
        <div class="mylist-title">${item.title}</div>
        <div class="mylist-cat">${item.category} · ${item.year}</div>
      </div>
      <button class="mylist-remove" onclick="removeFromMyList(${item.id})">✕</button>`;
    container.appendChild(div);
  });
}

function removeFromMyList(id) {
  id = parseInt(id);
  myList = myList.filter(i => parseInt(i) !== id);
  saveMyList();
  renderMyList();
  renderGrid();
}

// ============================================================
// DETAIL MODAL
// ============================================================
function openDetail(id) {
  const item = catalog.find(i => i.id === id);
  if (!item) return;
  currentDetailId = id;
  const img = resolveImg(item);

  document.getElementById('detail-img').src = img || '';
  document.getElementById('detail-img').style.display = img ? 'block' : 'none';
  document.getElementById('detail-cat').textContent         = item.category.toUpperCase();
  document.getElementById('detail-title-text').textContent  = item.title;
  document.getElementById('detail-meta').textContent        = `★ ${item.rating} · ${item.year}`;
  document.getElementById('detail-tags').innerHTML          = item.tags.map(t => `<span class="tag">${t}</span>`).join('');
  document.getElementById('detail-desc-text').textContent   = item.desc;

  const adminBtns   = document.getElementById('detail-admin-btns');
  const completeBtn = document.getElementById('detail-complete-btn');

  if (isUnlocked) {
    adminBtns.classList.remove('hidden');
  } else {
    adminBtns.classList.add('hidden');
  }
  completeBtn.style.display = '';
  const inList = myList.includes(id);
  completeBtn.textContent = inList ? '✓ Completed' : 'Mark Complete';
  completeBtn.classList.toggle('completed', inList);

  document.getElementById('detail-overlay').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeDetail() {
  document.getElementById('detail-overlay').classList.add('hidden');
  document.body.style.overflow = '';
  currentDetailId = null;
}

function closeDetailOutside(e) {
  if (e.target === document.getElementById('detail-overlay')) closeDetail();
}

function detailMarkComplete() {
  if (!currentDetailId) return;
  toggleCompleteById(currentDetailId);
  const inList = myList.includes(currentDetailId);
  const btn = document.getElementById('detail-complete-btn');
  btn.textContent = inList ? '✓ Completed' : 'Mark Complete';
  btn.classList.toggle('completed', inList);
  renderGrid();
}

function editCurrentDetail() {
  const idToEdit = currentDetailId;
  closeDetail();
  openEdit(idToEdit);
}

function deleteCurrentDetail() {
  if (!currentDetailId) return;
  if (confirm('Delete this title?')) {
    catalog = catalog.filter(i => i.id !== currentDetailId);
    saveCatalog();
    closeDetail();
    renderGrid();
  }
}

// ============================================================
// ADMIN: ADD / EDIT / DELETE
// ============================================================
function openModal(editId = null) {
  document.getElementById('modal-title').textContent = editId ? 'Edit Title' : 'Add New Title';
  document.getElementById('edit-id').value = editId || '';
  document.getElementById('m-category').value = 'anime';
  document.getElementById('m-title').value   = '';
  document.getElementById('m-desc').value    = '';
  document.getElementById('m-tags').value    = '';
  document.getElementById('m-rating').value  = '';
  document.getElementById('m-year').value    = '';
  document.getElementById('m-img-url').value = '';
  document.getElementById('m-mal-id').value  = '';
  document.getElementById('m-tmdb-id').value = '';
  clearImagePreview();

  if (editId) {
    const item = catalog.find(i => i.id === editId);
    if (item) {
      document.getElementById('m-category').value = item.category;
      document.getElementById('m-title').value    = item.title;
      document.getElementById('m-desc').value     = item.desc;
      document.getElementById('m-tags').value     = item.tags.join(', ');
      document.getElementById('m-rating').value   = item.rating;
      document.getElementById('m-year').value     = item.year;
      document.getElementById('m-img-url').value  = item.img || '';
      document.getElementById('m-mal-id').value   = item.mal_id || '';
      document.getElementById('m-tmdb-id').value  = item.tmdb_id || '';
      const img = resolveImg(item);
      if (img) showImagePreview(img);
    }
  }

  document.getElementById('modal-overlay').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function openEdit(id) { openModal(id); }

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
  document.body.style.overflow = '';
}

function closeModalOutside(e) {
  if (e.target === document.getElementById('modal-overlay')) closeModal();
}

async function saveItem() {
  const editId = document.getElementById('edit-id').value;
  const title  = document.getElementById('m-title').value.trim();
  if (!title) { alert('Title is required.'); return; }

  const imgUrl  = document.getElementById('m-img-url').value.trim();
  const malId   = parseInt(document.getElementById('m-mal-id').value) || null;
  const tmdbId  = parseInt(document.getElementById('m-tmdb-id').value) || null;
  const cat     = document.getElementById('m-category').value;

  const itemData = {
    category: cat,
    title,
    desc:   document.getElementById('m-desc').value.trim(),
    tags:   document.getElementById('m-tags').value.split(',').map(t => t.trim()).filter(Boolean),
    rating: parseFloat(document.getElementById('m-rating').value) || 0,
    year:   parseInt(document.getElementById('m-year').value) || new Date().getFullYear(),
    img:    imgUrl,
    mal_id:  (cat === 'anime' || cat === 'manga') ? malId : null,
    tmdb_id: cat === 'tv' ? tmdbId : null,
    _fetchedImg: ''
  };

  if (editId) {
    const idx = catalog.findIndex(i => i.id === parseInt(editId));
    if (idx !== -1) catalog[idx] = { ...catalog[idx], ...itemData };
  } else {
    catalog.push({ id: nextId++, ...itemData });
  }

  saveCatalog();
  closeModal();
  renderGrid();

  // Fetch image for new/edited item
  const newItem = catalog.find(i => i.title === title);
  if (newItem && !newItem.img) {
    if (cat === 'anime') {
      const url = await fetchJikanBySearch(title, 'anime');
      if (url) { newItem._fetchedImg = url; updateCardImage(newItem.id, url); }
    } else if (cat === 'manga') {
      const url = await fetchJikanBySearch(title, 'manga');
      if (url) { newItem._fetchedImg = url; updateCardImage(newItem.id, url); }
    } else if (cat === 'tv' && tmdbId) {
      const url = await fetchTMDBImage(tmdbId);
      if (url) { newItem._fetchedImg = url; updateCardImage(newItem.id, url); }
    }
  }
}

function deleteItem(id) {
  if (confirm('Delete this title?')) {
    catalog = catalog.filter(i => i.id !== id);
    saveCatalog();
    renderGrid();
  }
}

// ============================================================
// IMAGE UPLOAD HELPERS
// ============================================================
function handleImageFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    document.getElementById('m-img-url').value = e.target.result;
    showImagePreview(e.target.result);
  };
  reader.readAsDataURL(file);
}

function handleImageUrl(url) {
  if (url) showImagePreview(url); else clearImagePreview();
}

function showImagePreview(src) {
  const preview     = document.getElementById('image-preview');
  const placeholder = document.getElementById('upload-placeholder');
  preview.src = src;
  preview.classList.remove('hidden');
  placeholder.style.display = 'none';
}

function clearImagePreview() {
  const preview     = document.getElementById('image-preview');
  const placeholder = document.getElementById('upload-placeholder');
  preview.src = '';
  preview.classList.add('hidden');
  placeholder.style.display = 'flex';
}
