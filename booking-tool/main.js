/* ============================================
   BOOK YOUR PITCH — Booking Automation Engine
   ============================================
   Replicates the n8n workflow:
   Parse → Validate → Check Availability → Calculate Price
   → Generate Booking ID → Store (API) → Notify → Invoice
   ============================================ */

'use strict';

// ============================================
// GLOBAL ERROR HANDLER
// ============================================
window.onerror = function(msg, url, line, col, error) {
  console.error('Global error:', msg, 'at', line+':'+col, error);
  const toast = document.getElementById('toast');
  if (toast) {
    toast.textContent = '⚠️ Script error: ' + (msg || 'Unknown') + ' (line ' + line + ')';
    toast.className = 'toast error show';
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => toast.classList.remove('show'), 8000);
  }
};

window.addEventListener('unhandledrejection', function(e) {
  console.error('Unhandled promise rejection:', e.reason);
  const toast = document.getElementById('toast');
  if (toast) {
    toast.textContent = '⚠️ API error: ' + (e.reason?.message || 'Request failed') + '. Try again.';
    toast.className = 'toast error show';
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => toast.classList.remove('show'), 8000);
  }
});

// ============================================
// API CONFIGURATION
// ============================================
// Backend API URL.
// In production (Render), the frontend and API are served from the same origin,
// so an empty string means "same as the current page".
// For local development, change to 'http://localhost:8000'.
const API_BASE_URL = '';

async function apiPost(endpoint, data) {
  const res = await fetch(`${API_BASE_URL}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    // Try to parse JSON error body; fall back to throwing a clear message
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`Server error (${res.status}): ${text.slice(0, 150)}`);
    }
  }
  return res.json();
}

async function apiGet(endpoint) {
  const res = await fetch(`${API_BASE_URL}${endpoint}`);
  return res.json();
}

async function apiDelete(endpoint) {
  const res = await fetch(`${API_BASE_URL}${endpoint}`, { method: 'DELETE' });
  return res.json();
}

// ============================================
// DOM REFS
// ============================================
const form = document.getElementById('booking-form');
const btnSubmit = document.getElementById('btn-submit');
const pipeline = document.getElementById('pipeline');
const emptyState = document.getElementById('empty-state');
const invoiceContainer = document.getElementById('invoice-container');
const invoiceCard = document.getElementById('invoice-card');
const errorCard = document.getElementById('error-card');
const errorMsg = document.getElementById('error-msg');
const invActions = document.getElementById('inv-actions');
const totalBookingsEl = document.getElementById('total-bookings');
const toast = document.getElementById('toast');

// Invoice fields
const invBookingId = document.getElementById('inv-booking-id');
const invCustomer = document.getElementById('inv-customer');
const invSport = document.getElementById('inv-sport');
const invVenue = document.getElementById('inv-venue');
const invDate = document.getElementById('inv-date');
const invTime = document.getElementById('inv-time');
const invDuration = document.getElementById('inv-duration');
const invRate = document.getElementById('inv-rate');
const invBase = document.getElementById('inv-base');
const invGst = document.getElementById('inv-gst');
const invTotal = document.getElementById('inv-total');
const invPaymentBadge = document.getElementById('inv-payment-badge');

// Tab elements
const tabs = document.querySelectorAll('.nav-tab');
const tabContents = document.querySelectorAll('.tab-content');

// Bookings list elements
const bookingsTbody = document.getElementById('bookings-tbody');
const bookingsCount = document.getElementById('bookings-count');
const bookingsSearch = document.getElementById('bookings-search');
const tableEmpty = document.getElementById('table-empty');
const statsRevenue = document.getElementById('stat-revenue');
const statsOnline = document.getElementById('stat-online');
const statsVenue = document.getElementById('stat-venue');
const statsVenuesCount = document.getElementById('stat-venues-count');

// Venue management elements
const venuesGrid = document.getElementById('venues-grid');
const venuesCount = document.getElementById('venues-count');
const venuesEmpty = document.getElementById('venues-empty');
const btnAddVenue = document.getElementById('btn-add-venue');
const venueModal = document.getElementById('venue-modal');
const venueModalTitle = document.getElementById('venue-modal-title');
const venueForm = document.getElementById('venue-form');
const venueNameInput = document.getElementById('venue-name-input');
const venueEditId = document.getElementById('venue-edit-id');
const venueModalClose = document.getElementById('venue-modal-close');
const venueModalCancel = document.getElementById('venue-modal-cancel');
const sportsChecklist = document.getElementById('sports-checklist');

// Confirm modal
const confirmModal = document.getElementById('confirm-modal');
const confirmTitle = document.getElementById('confirm-title');
const confirmMsg = document.getElementById('confirm-msg');
const confirmOk = document.getElementById('confirm-ok');
const confirmCancel = document.getElementById('confirm-cancel');

// Venue select in form
const venueSelect = document.getElementById('venue-name');
const sportSelect = document.getElementById('sport-type');

// Dark mode
const btnTheme = document.getElementById('btn-theme');

// Voice input
const btnMic = document.getElementById('btn-mic');
const customerNameInput = document.getElementById('customer-name');

// Recent clients
const recentClientsEl = document.getElementById('recent-clients');
const recentClientsList = document.getElementById('recent-clients-list');
const recentClientsClear = document.getElementById('recent-clients-clear');

// Loading overlays
const resultsLoading = document.getElementById('results-loading');
const bookingsLoading = document.getElementById('bookings-loading');

// ============================================
// STATE
// ============================================
const VENUES_KEY = 'byp_venues';
const RECENT_CLIENTS_KEY = 'byp_recent_clients';
const THEME_KEY = 'byp_theme';
const MAX_RECENT_CLIENTS = 10;

const ALL_SPORTS = ['Cricket', 'Football', 'Pickleball', 'Badminton', 'Tennis', 'Other'];

// Pricing constants (used by calculatePrice if called directly)
const PRICING = { cricket: 1500, football: 1200, pickleball: 800, badminton: 600, tennis: 1000 };
const DEFAULT_RATE = 1000;
const GST_RATE = 0.18;

// ============================================
// INDEXED DB — Offline Local Storage
// ============================================

const DB_NAME = 'byp_offline';
const DB_VERSION = 1;
const STORE_BOOKINGS = 'bookings';
const STORE_SYNC_QUEUE = 'sync_queue';

function openDB() {
  return new Promise(function(resolve, reject) {
    var request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = function(e) {
      var db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_BOOKINGS)) {
        var store = db.createObjectStore(STORE_BOOKINGS, { keyPath: 'booking_id' });
        store.createIndex('preferred_date', 'preferred_date', { unique: false });
        store.createIndex('venue_name', 'venue_name', { unique: false });
        store.createIndex('created_at', 'created_at', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_SYNC_QUEUE)) {
        var queue = db.createObjectStore(STORE_SYNC_QUEUE, { keyPath: 'id', autoIncrement: true });
        queue.createIndex('type', 'type', { unique: false });
      }
    };
    request.onsuccess = function(e) { resolve(e.target.result); };
    request.onerror = function(e) { reject(e.target.error); };
  });
}

function dbAdd(storeName, data) {
  return openDB().then(function(db) {
    return new Promise(function(resolve, reject) {
      var tx = db.transaction(storeName, 'readwrite');
      var store = tx.objectStore(storeName);
      var req = store.add(data);
      req.onsuccess = function() { resolve(req.result); };
      req.onerror = function() { reject(req.error); };
      tx.oncomplete = function() { db.close(); };
    });
  });
}

function dbPut(storeName, data) {
  return openDB().then(function(db) {
    return new Promise(function(resolve, reject) {
      var tx = db.transaction(storeName, 'readwrite');
      var store = tx.objectStore(storeName);
      var req = store.put(data);
      req.onsuccess = function() { resolve(req.result); };
      req.onerror = function() { reject(req.error); };
      tx.oncomplete = function() { db.close(); };
    });
  });
}

function dbGetAll(storeName) {
  return openDB().then(function(db) {
    return new Promise(function(resolve, reject) {
      var tx = db.transaction(storeName, 'readonly');
      var store = tx.objectStore(storeName);
      var req = store.getAll();
      req.onsuccess = function() { resolve(req.result || []); };
      req.onerror = function() { reject(req.error); };
      tx.oncomplete = function() { db.close(); };
    });
  });
}

function dbDelete(storeName, key) {
  return openDB().then(function(db) {
    return new Promise(function(resolve, reject) {
      var tx = db.transaction(storeName, 'readwrite');
      var store = tx.objectStore(storeName);
      var req = store.delete(key);
      req.onsuccess = function() { resolve(); };
      req.onerror = function() { reject(req.error); };
      tx.oncomplete = function() { db.close(); };
    });
  });
}

function dbClear(storeName) {
  return openDB().then(function(db) {
    return new Promise(function(resolve, reject) {
      var tx = db.transaction(storeName, 'readwrite');
      var store = tx.objectStore(storeName);
      var req = store.clear();
      req.onsuccess = function() { resolve(); };
      req.onerror = function() { reject(req.error); };
      tx.oncomplete = function() { db.close(); };
    });
  });
}

// ---- Local booking helpers ----

function getLocalBookings() {
  return dbGetAll(STORE_BOOKINGS);
}

function saveLocalBooking(booking) {
  return dbPut(STORE_BOOKINGS, booking);
}

function deleteLocalBooking(bookingId) {
  return dbDelete(STORE_BOOKINGS, bookingId);
}

// ---- Sync Queue ----

function addToSyncQueue(item) {
  item.status = 'pending';
  item.created_at = new Date().toISOString();
  item.retries = 0;
  return dbAdd(STORE_SYNC_QUEUE, item);
}

function getSyncQueue() {
  return dbGetAll(STORE_SYNC_QUEUE);
}

function removeFromSyncQueue(id) {
  return dbDelete(STORE_SYNC_QUEUE, id);
}

function clearSyncQueue() {
  return dbClear(STORE_SYNC_QUEUE);
}

// ---- Process Sync Queue (send pending offline bookings to API) ----

async function processSyncQueue() {
  var items = await getSyncQueue();
  if (items.length === 0) return { synced: 0, failed: 0 };

  var synced = 0, failed = 0;
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    try {
      if (item.type === 'create_booking') {
        await apiPost('/api/bookings', item.data);
      } else if (item.type === 'delete_booking') {
        await apiDelete('/api/bookings/' + encodeURIComponent(item.data.booking_id));
      }
      await removeFromSyncQueue(item.id);
      synced++;
    } catch (e) {
      item.retries = (item.retries || 0) + 1;
      if (item.retries >= 5) {
        // Give up after 5 retries — user can manually retry
        await removeFromSyncQueue(item.id);
        failed++;
        console.warn('Sync failed after 5 retries, dropping:', item.id, e);
      } else {
        failed++;
        console.warn('Sync retry', item.retries, 'failed for', item.id, e);
      }
    }
  }
  return { synced: synced, failed: failed };
}

// ============================================
// CONNECTIVITY DETECTION
// ============================================

var _online = navigator.onLine;
var connectivityIndicator = null;

function createConnectivityIndicator() {
  if (connectivityIndicator) return;
  connectivityIndicator = document.createElement('div');
  connectivityIndicator.id = 'connectivity-indicator';
  connectivityIndicator.className = 'connectivity-indicator';
  var dot = document.createElement('span');
  dot.className = 'conn-dot';
  var label = document.createElement('span');
  label.className = 'conn-label';
  connectivityIndicator.appendChild(dot);
  connectivityIndicator.appendChild(label);
  var navStats = document.querySelector('.nav-stats');
  if (navStats) {
    navStats.appendChild(connectivityIndicator);
  }
  updateConnectivityStatus();
}

function updateConnectivityStatus() {
  _online = navigator.onLine;
  if (!connectivityIndicator) return;
  var dot = connectivityIndicator.querySelector('.conn-dot');
  var label = connectivityIndicator.querySelector('.conn-label');
  if (!dot || !label) return;

  if (_online) {
    dot.className = 'conn-dot online';
    label.textContent = 'Online';
    connectivityIndicator.className = 'connectivity-indicator online';
  } else {
    dot.className = 'conn-dot offline';
    label.textContent = 'Offline';
    connectivityIndicator.className = 'connectivity-indicator offline';
  }
}

function isOnline() {
  return navigator.onLine;
}

// Called when connection returns — process sync queue
async function onConnectionRestored() {
  updateConnectivityStatus();
  showToast('📡 Connection restored — syncing...', 'success');
  var result = await processSyncQueue();
  if (result.synced > 0 || result.failed > 0) {
    showToast(
      'Sync complete: ' + result.synced + ' synced' +
      (result.failed > 0 ? ', ' + result.failed + ' failed' : ''),
      result.failed > 0 ? 'warning' : 'success'
    );
    renderBookingsList();
    updateBookingCount();
  } else {
    showToast('📡 Connection restored', 'success');
  }
}

// ============================================
// DARK MODE TOGGLE
// ============================================

function loadTheme() {
  var saved = localStorage.getItem(THEME_KEY);
  if (saved === 'dark' || (!saved && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    document.documentElement.setAttribute('data-theme', 'dark');
    if (!saved) localStorage.setItem(THEME_KEY, 'dark');
  } else if (saved === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
}

function toggleTheme() {
  var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  if (isDark) {
    document.documentElement.removeAttribute('data-theme');
    localStorage.setItem(THEME_KEY, 'light');
  } else {
    document.documentElement.setAttribute('data-theme', 'dark');
    localStorage.setItem(THEME_KEY, 'dark');
  }
}

// ============================================
// VOICE INPUT (Web Speech API)
// ============================================

function initVoiceInput() {
  if (!btnMic || !customerNameInput) return;

  var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    btnMic.style.display = 'none';
    return;
  }

  var recognition = new SpeechRecognition();
  recognition.lang = 'en-IN';
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  btnMic.addEventListener('click', function() {
    if (btnMic.classList.contains('listening')) {
      recognition.abort();
      btnMic.classList.remove('listening');
      return;
    }

    try {
      recognition.start();
      btnMic.classList.add('listening');
    } catch (e) {
      console.warn('Speech recognition error:', e);
    }
  });

  recognition.addEventListener('result', function(e) {
    var transcript = e.results[0][0].transcript;
    customerNameInput.value = transcript;
    customerNameInput.classList.remove('error');
    // Trigger input event for any listeners
    customerNameInput.dispatchEvent(new Event('input'));
  });

  recognition.addEventListener('end', function() {
    btnMic.classList.remove('listening');
  });

  recognition.addEventListener('error', function(e) {
    btnMic.classList.remove('listening');
    if (e.error !== 'no-speech' && e.error !== 'aborted') {
      console.warn('Speech recognition error:', e.error);
    }
  });
}

// ============================================
// RECENT CLIENTS
// ============================================

function getRecentClients() {
  try {
    var raw = localStorage.getItem(RECENT_CLIENTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function saveRecentClient(name, phone, email) {
  if (!name || !name.trim()) return;
  var clients = getRecentClients();
  // Remove existing entry with same name (case-insensitive)
  clients = clients.filter(function(c) {
    return c.name.toLowerCase() !== name.trim().toLowerCase();
  });
  // Add to front
  clients.unshift({ name: name.trim(), phone: phone || '', email: email || '' });
  // Keep max
  if (clients.length > MAX_RECENT_CLIENTS) {
    clients = clients.slice(0, MAX_RECENT_CLIENTS);
  }
  localStorage.setItem(RECENT_CLIENTS_KEY, JSON.stringify(clients));
  renderRecentClients();
}

function renderRecentClients() {
  var clients = getRecentClients();
  if (clients.length === 0) {
    recentClientsEl.classList.remove('visible');
    return;
  }
  recentClientsEl.classList.add('visible');

  var html = '';
  clients.forEach(function(c) {
    var phoneDisplay = c.phone ? '<span class="chip-phone">' + escapeHtml(c.phone) + '</span>' : '';
    html += '<div class="recent-client-chip" data-name="' + escapeHtml(c.name) + '" ' +
      'data-phone="' + escapeHtml(c.phone) + '" ' +
      'data-email="' + escapeHtml(c.email) + '">' +
      '<span class="chip-name">' + escapeHtml(c.name) + '</span>' +
      phoneDisplay +
    '</div>';
  });
  recentClientsList.innerHTML = html;

  // Tap to auto-fill
  recentClientsList.querySelectorAll('.recent-client-chip').forEach(function(chip) {
    chip.addEventListener('click', function() {
      document.getElementById('customer-name').value = chip.dataset.name;
      document.getElementById('client-email').value = chip.dataset.email;
      document.getElementById('client-phone').value = chip.dataset.phone;
      clearErrors();
      showToast('Client info filled: ' + chip.dataset.name, 'success');
      // Scroll to top of form
      document.getElementById('form-panel').scrollIntoView({ behavior: 'smooth' });
    });
  });
}

// ============================================
// VENUE HELPERS (localStorage only)
// ============================================

function getVenues() {
  try {
    const raw = localStorage.getItem(VENUES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveVenues(venues) {
  localStorage.setItem(VENUES_KEY, JSON.stringify(venues));
}

function updateBookingCount() {
  if (isOnline()) {
    // Fetch count from API
    apiGet('/api/bookings')
      .then(data => {
        totalBookingsEl.textContent = data.count || 0;
      })
      .catch(() => {
        // Fall back to local count
        updateLocalBookingCount();
      });
  } else {
    updateLocalBookingCount();
  }
}

function updateLocalBookingCount() {
  getLocalBookings().then(function(bookings) {
    totalBookingsEl.textContent = bookings.length || 0;
  }).catch(function() {
    totalBookingsEl.textContent = '?';
  });
}

function showToast(message, type = 'success') {
  toast.textContent = message;
  toast.className = 'toast ' + type + ' show';
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
}

// ============================================
// VENUE MANAGEMENT
// ============================================

function loadVenueSelect() {
  const venues = getVenues();
  venueSelect.innerHTML = '<option value="" disabled selected>Select venue</option>';

  if (venues.length === 0) {
    // If no venues are configured yet, show a placeholder
    venueSelect.innerHTML += '<option value="__no_venues__" disabled>— No venues configured —</option>';
    return;
  }

  venues.forEach(v => {
    const opt = document.createElement('option');
    opt.value = v.name;
    opt.textContent = v.name;
    venueSelect.appendChild(opt);
  });
}

function filterSportsByVenue() {
  const selectedVenue = venueSelect.value;
  const venues = getVenues();
  const venue = venues.find(v => v.name === selectedVenue);

  // Reset sport options
  sportSelect.innerHTML = '<option value="" disabled selected>Select sport</option>';

  if (venue && venue.sports && venue.sports.length > 0) {
    venue.sports.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s;
      opt.textContent = s;
      sportSelect.appendChild(opt);
    });
  } else {
    // Show all sports if no venue-specific filtering
    ALL_SPORTS.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s;
      opt.textContent = s;
      sportSelect.appendChild(opt);
    });
  }
}

function renderVenues() {
  const venues = getVenues();
  venuesCount.textContent = `${venues.length} venue${venues.length !== 1 ? 's' : ''} configured`;

  if (venues.length === 0) {
    venuesGrid.innerHTML = '';
    venuesEmpty.style.display = 'flex';
    return;
  }

  venuesEmpty.style.display = 'none';

  let html = '';
  venues.forEach((v, idx) => {
    const sportsHtml = v.sports.map(s => `<span class="venue-sport-tag">${s}</span>`).join('');
    html += `
      <div class="venue-card">
        <div class="venue-card-top">
          <span class="venue-card-name">${escapeHtml(v.name)}</span>
          <div class="venue-card-actions">
            <button class="venue-btn edit" data-index="${idx}" title="Edit">✏️</button>
            <button class="venue-btn delete" data-index="${idx}" title="Delete">🗑️</button>
          </div>
        </div>
        <div class="venue-card-sports">
          ${sportsHtml || '<span style="color:var(--text-muted);font-size:12px;">No sports configured</span>'}
        </div>
      </div>
    `;
  });

  // Add "Add venue" card
  html += `
    <div class="venue-card add-venue-card" id="add-venue-card-btn">
      <div class="add-venue-card-icon">+</div>
      <div class="add-venue-card-text">Add a new venue</div>
    </div>
  `;

  venuesGrid.innerHTML = html;

  // Attach event listeners
  document.querySelectorAll('.venue-btn.edit').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.index);
      openVenueModal(idx);
    });
  });

  document.querySelectorAll('.venue-btn.delete').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.index);
      const venues = getVenues();
      confirmThenDelete(`Delete "${venues[idx].name}"?`, 'This venue will be removed. Bookings for this venue will not be affected.', () => {
        venues.splice(idx, 1);
        saveVenues(venues);
        renderVenues();
        loadVenueSelect();
        showToast(`Venue deleted`, 'success');
      });
    });
  });

  const addCard = document.getElementById('add-venue-card-btn');
  if (addCard) {
    addCard.addEventListener('click', () => openVenueModal());
  }
}

function openVenueModal(editIndex) {
  const isEdit = editIndex !== undefined && editIndex >= 0;
  venueModalTitle.textContent = isEdit ? 'Edit Venue' : 'Add Venue';
  document.getElementById('btn-save-venue').textContent = isEdit ? 'Update Venue' : 'Save Venue';

  if (isEdit) {
    const venues = getVenues();
    const venue = venues[editIndex];
    venueNameInput.value = venue.name;
    venueEditId.value = editIndex;
    // Check the right sports
    sportsChecklist.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.checked = venue.sports.includes(cb.value);
    });
  } else {
    venueForm.reset();
    venueEditId.value = '';
    sportsChecklist.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.checked = false;
    });
  }

  venueModal.classList.add('visible');
}

function closeVenueModal() {
  venueModal.classList.remove('visible');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ============================================
// VENUE FORM
// ============================================

venueForm.addEventListener('submit', (e) => {
  e.preventDefault();

  const name = venueNameInput.value.trim();
  if (!name) {
    showToast('Please enter a venue name', 'error');
    return;
  }

  const selectedSports = [];
  sportsChecklist.querySelectorAll('input[type="checkbox"]:checked').forEach(cb => {
    selectedSports.push(cb.value);
  });

  if (selectedSports.length === 0) {
    showToast('Select at least one sport for this venue', 'error');
    return;
  }

  const venues = getVenues();
  const editIdx = venueEditId.value;

  // Check for duplicate name (skip if editing same venue)
  const duplicate = venues.find((v, i) =>
    v.name.toLowerCase() === name.toLowerCase() && i !== parseInt(editIdx)
  );
  if (duplicate) {
    showToast('A venue with this name already exists', 'error');
    return;
  }

  const venueData = { name, sports: selectedSports };

  if (editIdx !== '' && editIdx >= 0) {
    venues[parseInt(editIdx)] = venueData;
  } else {
    venues.push(venueData);
  }

  saveVenues(venues);
  renderVenues();
  loadVenueSelect();
  closeVenueModal();
  showToast(editIdx !== '' && editIdx >= 0 ? 'Venue updated!' : 'Venue added!', 'success');
});

// Venue modal close handlers
venueModalClose.addEventListener('click', closeVenueModal);
venueModalCancel.addEventListener('click', closeVenueModal);
venueModal.addEventListener('click', (e) => {
  if (e.target === venueModal) closeVenueModal();
});

// Add venue button / add venue card
btnAddVenue.addEventListener('click', () => openVenueModal());

// ============================================
// VENUE-SPORT LINKING
// ============================================

venueSelect.addEventListener('change', filterSportsByVenue);

// ============================================
// TAB SWITCHING
// ============================================

tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    const tabName = tab.dataset.tab;

    // Update active tab
    tabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');

    // Show corresponding content
    tabContents.forEach(tc => tc.classList.remove('active'));
    const target = document.getElementById(`tab-content-${tabName}`);
    if (target) {
      target.classList.add('active');

      // Refresh data when switching tabs
      if (tabName === 'bookings-list') {
        renderBookingsList();
      }
      if (tabName === 'venues') {
        renderVenues();
      }
    }
  });
});

// ============================================
// BOOKINGS LIST (fetches from API)
// ============================================

let _cachedBookings = [];

async function renderLocalBookingsTable(bookings, search) {
  var filtered = bookings;
  if (search) {
    filtered = bookings.filter(function(b) {
      return (b.client_name || '').toLowerCase().includes(search) ||
        (b.booking_id || '').toLowerCase().includes(search) ||
        (b.venue_name || '').toLowerCase().includes(search) ||
        (b.service_type || '').toLowerCase().includes(search);
    });
  }

  bookingsCount.textContent = filtered.length + ' booking' + (filtered.length !== 1 ? 's' : '') + ' found (offline)';

  var totalRevenue = filtered.reduce(function(sum, b) { return sum + (parseInt(b.total_amount) || 0); }, 0);
  var onlineCount = filtered.filter(function(b) { return b.payment_status === 'Paid'; }).length;
  var venuePayCount = filtered.filter(function(b) { return b.payment_status !== 'Paid'; }).length;
  var uniqueVenues = new Set(filtered.map(function(b) { return b.venue_name || b.service_type; })).size;

  statsRevenue.textContent = '₹' + totalRevenue.toLocaleString('en-IN');
  statsOnline.textContent = onlineCount;
  statsVenue.textContent = venuePayCount;
  statsVenuesCount.textContent = uniqueVenues;

  if (filtered.length === 0) {
    bookingsTbody.innerHTML = '';
    tableEmpty.style.display = 'flex';
    return;
  }

  tableEmpty.style.display = 'none';

  var html = '';
  filtered.forEach(function(b) {
    var dateStr = formatDate(b.preferred_date);
    var timeStr = (b.preferred_time || '—') + (b.end_time ? ' — ' + b.end_time : '');
    var amount = b.total_amount ? '₹' + parseInt(b.total_amount).toLocaleString('en-IN') : '—';
    var isPaid = b.payment_status === 'Paid';
    var badgeClass = isPaid ? 'paid' : 'venue';

    html += '<tr>' +
      '<td class="booking-id-cell">' + escapeHtml(b.booking_id || '—') + '</td>' +
      '<td>' + escapeHtml(b.client_name || '—') + '</td>' +
      '<td>' + escapeHtml(b.service_type || '—') + '</td>' +
      '<td>' + escapeHtml(b.venue_name || '—') + '</td>' +
      '<td>' + dateStr + '</td>' +
      '<td>' + timeStr + '</td>' +
      '<td class="amount-cell">' + amount + '</td>' +
      '<td><span class="payment-badge ' + badgeClass + '">' + escapeHtml(b.payment_status || '—') + '</span></td>' +
      '<td><button class="btn-delete-row" data-id="' + escapeHtml(b.booking_id) + '" title="Delete booking">✕</button></td>' +
    '</tr>';
  });

  bookingsTbody.innerHTML = html;

  bookingsTbody.querySelectorAll('.btn-delete-row').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var id = btn.dataset.id;
      confirmThenDelete('Delete booking ' + id + '?', 'This will remove the booking from local storage and queue deletion.', async function() {
        try {
          await deleteLocalBooking(id);
          if (isOnline()) {
            try {
              await apiDelete('/api/bookings/' + encodeURIComponent(id));
            } catch (e) {
              addToSyncQueue({ type: 'delete_booking', data: { booking_id: id } }).catch(function(err) {
                console.warn('Failed to enqueue sync item:', err);
              });
            }
          } else {
            addToSyncQueue({ type: 'delete_booking', data: { booking_id: id } }).catch(function(err) {
              console.warn('Failed to enqueue sync item:', err);
            });
          }
          renderBookingsList();
          updateBookingCount();
          showToast('Booking cancelled', 'success');
        } catch (e) {
          showToast('Failed to cancel booking', 'error');
        }
      });
    });
  });
}

async function renderBookingsList(filterText) {
  const search = (filterText || bookingsSearch.value || '').toLowerCase().trim();

  // Show loading state
  if (bookingsLoading) bookingsLoading.classList.add('show');

  try {
    const data = await apiGet('/api/bookings');
    let bookings = data.bookings || [];
    _cachedBookings = bookings;

    if (search) {
      bookings = bookings.filter(b =>
        (b.client_name || '').toLowerCase().includes(search) ||
        (b.booking_id || '').toLowerCase().includes(search) ||
        (b.venue_name || '').toLowerCase().includes(search) ||
        (b.service_type || '').toLowerCase().includes(search)
      );
    }

    bookingsCount.textContent = `${bookings.length} booking${bookings.length !== 1 ? 's' : ''} found`;

    // Calculate stats
    const totalRevenue = bookings.reduce((sum, b) => sum + (parseInt(b.total_amount) || 0), 0);
    const onlineCount = bookings.filter(b => b.payment_status === 'Paid').length;
    const venuePayCount = bookings.filter(b => b.payment_status !== 'Paid').length;
    const uniqueVenues = new Set(bookings.map(b => b.venue_name || b.service_type)).size;

    statsRevenue.textContent = `₹${totalRevenue.toLocaleString('en-IN')}`;
    statsOnline.textContent = onlineCount;
    statsVenue.textContent = venuePayCount;
    statsVenuesCount.textContent = uniqueVenues;

    if (bookings.length === 0) {
      bookingsTbody.innerHTML = '';
      tableEmpty.style.display = 'flex';
      return;
    }

    tableEmpty.style.display = 'none';

    // Sort by created_at descending (newest first)
    bookings.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

    let html = '';
    bookings.forEach(b => {
      const dateStr = formatDate(b.preferred_date);
      const timeStr = `${b.preferred_time || '—'}${b.end_time ? ' — ' + b.end_time : ''}`;
      const amount = b.total_amount ? `₹${parseInt(b.total_amount).toLocaleString('en-IN')}` : '—';
      const isPaid = b.payment_status === 'Paid';
      const badgeClass = isPaid ? 'paid' : 'venue';

      html += `
        <tr>
          <td class="booking-id-cell">${escapeHtml(b.booking_id || '—')}</td>
          <td>${escapeHtml(b.client_name || '—')}</td>
          <td>${escapeHtml(b.service_type || '—')}</td>
          <td>${escapeHtml(b.venue_name || '—')}</td>
          <td>${dateStr}</td>
          <td>${timeStr}</td>
          <td class="amount-cell">${amount}</td>
          <td><span class="payment-badge ${badgeClass}">${escapeHtml(b.payment_status || '—')}</span></td>
          <td><button class="btn-delete-row" data-id="${escapeHtml(b.booking_id)}" title="Delete booking">✕</button></td>
        </tr>
      `;
    });

    bookingsTbody.innerHTML = html;

    // Delete handlers
    bookingsTbody.querySelectorAll('.btn-delete-row').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        confirmThenDelete(`Delete booking ${id}?`, 'This will cancel the booking on the server.', async () => {
          try {
            await apiDelete(`/api/bookings/${encodeURIComponent(id)}`);
            renderBookingsList();
            updateBookingCount();
            showToast('Booking cancelled', 'success');
          } catch {
            showToast('Failed to cancel booking', 'error');
          }
        });
      });
    });
  } catch (err) {
    console.warn('API fetch failed, trying local data:', err.message);
    // Fall back to IndexedDB for offline mode
    try {
      const localBookings = await getLocalBookings();
      if (localBookings && localBookings.length > 0) {
        var sorted = localBookings.slice().sort(function(a, b) {
          return (b.created_at || '').localeCompare(a.created_at || '');
        });
        _cachedBookings = sorted;
        renderLocalBookingsTable(sorted, search);
        return;
      }
    } catch (localErr) {
      console.warn('Local data also failed:', localErr);
    }
    showToast('Could not connect to server. Is the API running?', 'error');
    bookingsTbody.innerHTML = '';
    tableEmpty.style.display = 'flex';
  } finally {
    // Hide loading state
    if (bookingsLoading) bookingsLoading.classList.remove('show');
  }
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

// Search with debounce
let searchTimer;
bookingsSearch.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => renderBookingsList(), 250);
});

// CSV Export (uses cached API data)
document.getElementById('btn-export-csv').addEventListener('click', () => {
  const bookings = _cachedBookings;
  if (!bookings || bookings.length === 0) {
    showToast('No bookings to export', 'error');
    return;
  }

  const headers = ['Booking ID', 'Customer', 'Sport', 'Venue', 'Date', 'Time', 'Amount', 'Payment', 'Status', 'Created At'];
  const rows = bookings.map(b => [
    b.booking_id || '',
    b.client_name || '',
    b.service_type || '',
    b.venue_name || '',
    b.preferred_date || '',
    b.preferred_time || '',
    b.total_amount || 0,
    b.payment_status || '',
    b.status || '',
    b.created_at || '',
  ]);

  const csv = [headers, ...rows]
    .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n');

  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `bookings-export-${Date.now()}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
  showToast('CSV exported!', 'success');
});

// Clear all bookings (disabled for API mode — use sheet directly)
document.getElementById('btn-clear-all').addEventListener('click', () => {
  showToast('Clear all is disabled when using the API server. Clear the sheet directly.', 'error');
});

// ============================================
// CONFIRM MODAL
// ============================================

let confirmCallback = null;

function confirmThenDelete(title, msg, callback, buttonLabel) {
  confirmTitle.textContent = title;
  confirmMsg.textContent = msg;
  confirmOk.textContent = buttonLabel || 'Delete';
  confirmOk.className = 'btn-action btn-danger';
  confirmCallback = callback;
  confirmModal.classList.add('visible');
}

function closeConfirmModal() {
  confirmModal.classList.remove('visible');
  confirmCallback = null;
}

confirmOk.addEventListener('click', () => {
  if (confirmCallback) confirmCallback();
  closeConfirmModal();
});

confirmCancel.addEventListener('click', closeConfirmModal);
confirmModal.addEventListener('click', (e) => {
  if (e.target === confirmModal) closeConfirmModal();
});

// ============================================
// PIPELINE STEPS ANIMATION
// ============================================

function resetPipeline() {
  document.querySelectorAll('.pipe-step').forEach(el => {
    el.classList.remove('active', 'done', 'failed');
  });
}

function advancePipeline(stepId) {
  const step = document.querySelector(`[data-step="${stepId}"]`);
  if (!step) return;

  const allSteps = document.querySelectorAll('.pipe-step');
  let found = false;
  allSteps.forEach(s => {
    if (s.dataset.step === stepId) found = true;
    if (found) return;
    s.classList.remove('active');
    s.classList.add('done');
  });

  step.classList.remove('done', 'failed');
  step.classList.add('active');
}

function failPipeline(stepId) {
  const step = document.querySelector(`[data-step="${stepId}"]`);
  if (!step) return;
  step.classList.remove('active', 'done');
  step.classList.add('failed');
}

// ============================================
// STEP 1: PARSE INPUT
// ============================================

function parseInput() {
  const customer_name = document.getElementById('customer-name').value.trim();
  const sport_type = document.getElementById('sport-type').value;
  let venue_name = document.getElementById('venue-name').value;

  // If no venues are configured, the venue select is disabled — show a helpful toast
  if (venue_name === '__no_venues__' || venue_name === '') {
    venue_name = '';
  }

  const client_email = document.getElementById('client-email').value.trim();
  const client_phone = document.getElementById('client-phone').value.trim();
  const booking_date = document.getElementById('booking-date').value;
  const start_time = document.getElementById('start-time').value;
  const end_time = document.getElementById('end-time').value;

  const paymentRadio = document.querySelector('input[name="payment"]:checked');
  const payment_mode = paymentRadio ? paymentRadio.value : '';

  return {
    customer_name,
    sport_type,
    venue_name,
    client_email,
    client_phone,
    booking_date,
    start_time,
    end_time,
    payment_mode,
  };
}

// ============================================
// STEP 2: VALIDATE DATA
// ============================================

function validateData(data) {
  const errors = [];
  const fields = [
    { key: 'customer_name', label: 'Customer Name' },
    { key: 'sport_type', label: 'Sport Type' },
    { key: 'venue_name', label: 'Venue Name' },
    { key: 'booking_date', label: 'Booking Date' },
    { key: 'start_time', label: 'Start Time' },
    { key: 'end_time', label: 'End Time' },
    { key: 'payment_mode', label: 'Payment Mode' },
  ];

  // Phone and email are optional — no error if missing

  fields.forEach(f => {
    if (!data[f.key]) {
      errors.push(f.label);
    }
  });

  if (data.start_time && data.end_time) {
    const [sh, sm] = data.start_time.split(':').map(Number);
    const [eh, em] = data.end_time.split(':').map(Number);
    const startMin = sh * 60 + sm;
    const endMin = eh * 60 + em;
    if (endMin <= startMin) {
      errors.push('End time must be after start time');
    }
  }

  return errors;
}

function highlightErrors(data) {
  document.querySelectorAll('.field-input').forEach(el => el.classList.remove('error'));
  if (!data.customer_name) document.getElementById('customer-name').classList.add('error');
  if (!data.sport_type) document.getElementById('sport-type').classList.add('error');
  if (!data.venue_name) document.getElementById('venue-name').classList.add('error');
  if (!data.booking_date) document.getElementById('booking-date').classList.add('error');
  if (!data.start_time) document.getElementById('start-time').classList.add('error');
  if (!data.end_time) document.getElementById('end-time').classList.add('error');
  // Phone and email are optional — no error highlighting for them
}

function clearErrors() {
  document.querySelectorAll('.field-input').forEach(el => el.classList.remove('error'));
}

// ============================================
// STEP 3 & 4: CHECK AVAILABILITY & VALIDATE SLOT
// ============================================

async function checkSlotAvailabilityAsync(data, bookingsList) {
  var existing = bookingsList || await getBookingsAsync();
  var startMinutes = timeToMinutes(data.start_time || data.preferred_time);
  var endMinutes = timeToMinutes(data.end_time);

  for (var i = 0; i < existing.length; i++) {
    var booking = existing[i];
    if (
      booking.venue_name && booking.venue_name.toLowerCase() === (data.venue_name || '').toLowerCase() &&
      (booking.preferred_date || booking.booking_date) === (data.preferred_date || data.booking_date) &&
      booking.status !== 'CANCELLED'
    ) {
      var bStart = timeToMinutes(booking.preferred_time || booking.start_time);
      var bEnd = timeToMinutes(booking.end_time);

      var overlaps =
        (startMinutes >= bStart && startMinutes < bEnd) ||
        (endMinutes > bStart && endMinutes <= bEnd) ||
        (startMinutes <= bStart && endMinutes >= bEnd);

      if (overlaps) {
        return {
          available: false,
          conflict: {
            customer: booking.client_name || booking.customer_name,
            start: booking.preferred_time || booking.start_time,
            end: booking.end_time,
          },
        };
      }
    }
  }

  return { available: true };
}

function timeToMinutes(t) {
  if (!t) return 0;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

// ============================================
// STEP 5: CALCULATE PRICE
// ============================================

function calculatePrice(data) {
  const sportKey = data.sport_type.toLowerCase();
  const ratePerHour = PRICING[sportKey] || DEFAULT_RATE;

  const [sh, sm] = data.start_time.split(':').map(Number);
  const [eh, em] = data.end_time.split(':').map(Number);
  const durationHours = (eh + em / 60) - (sh + sm / 60);

  const baseAmount = Math.round(ratePerHour * durationHours);
  const gstAmount = Math.round(baseAmount * GST_RATE);
  const totalAmount = Math.round(baseAmount + gstAmount);

  return {
    ...data,
    rate_per_hour: ratePerHour,
    duration: durationHours,
    base_amount: baseAmount,
    gst_amount: gstAmount,
    total_amount: totalAmount,
  };
}

// ============================================
// STEP 6: GENERATE BOOKING ID
// ============================================

function generateBooking(data) {
  const bookingId = generateBookingId();
  return {
    ...data,
    booking_id: bookingId,
    created_at: new Date().toISOString(),
  };
}

// ============================================
// STEP 7: PAYMENT HANDLING
// ============================================

function setPaymentStatus(data) {
  const isOnline = data.payment_mode.toLowerCase() === 'online';
  return {
    ...data,
    payment_status: isOnline ? 'Paid' : 'Pay at Venue',
  };
}

// ============================================
// STEP 8: STORE BOOKING
// ============================================

function storeBooking(data) {
  saveBooking(data);
  return data;
}

// ============================================
// STEP 9: RENDER INVOICE
// ============================================

function renderInvoice(data) {
  const dateObj = new Date(data.booking_date + 'T00:00:00');
  const formattedDate = dateObj.toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  const durationStr = data.duration % 1 === 0
    ? `${data.duration} hr`
    : `${data.duration} hrs`;

  invBookingId.textContent = data.booking_id;
  invCustomer.textContent = data.customer_name;
  invSport.textContent = data.sport_type;
  invVenue.textContent = data.venue_name;
  invDate.textContent = formattedDate;
  invTime.textContent = `${data.start_time} — ${data.end_time}`;
  invDuration.textContent = durationStr;

  invRate.textContent = `(₹${data.rate_per_hour}/hr × ${durationStr})`;
  invBase.textContent = `₹${data.base_amount}`;
  invGst.textContent = `₹${data.gst_amount}`;
  invTotal.textContent = `₹${data.total_amount}`;

  const isPaid = data.payment_status === 'Paid';
  invPaymentBadge.textContent = data.payment_status;
  invPaymentBadge.className = 'inv-badge ' + (isPaid ? 'status-paid' : 'status-venue');
}

// ============================================
// MAIN WORKFLOW EXECUTION (calls API)
// ============================================

async function executeWorkflow() {
  clearErrors();
  emptyState.style.display = 'none';
  invoiceContainer.style.display = 'none';
  errorCard.style.display = 'none';
  invActions.style.display = 'none';
  pipeline.style.display = 'block';
  resetPipeline();
  btnSubmit.disabled = true;
  btnSubmit.classList.add('loading');
  btnSubmit.querySelector('.btn-text').textContent = 'Processing...';
  if (resultsLoading) resultsLoading.classList.add('show');

  try {
    advancePipeline('parse');
    await sleep(200);
    const parsedData = parseInput();

    advancePipeline('validate');
    await sleep(200);
    const validationErrors = validateData(parsedData);

    if (validationErrors.length > 0) {
      highlightErrors(parsedData);
      failPipeline('validate');
      showToast(`Missing fields: ${validationErrors.join(', ')}`, 'error');
      resetUi();
      return;
    }

    // Check connectivity — try API if online, fall back to local if offline
    advancePipeline('availability');
    await sleep(200);

    // Sanitize phone: remove spaces, dashes, brackets — keep only digits and +
    const sanitizedPhone = (parsedData.client_phone || '').replace(/[^\d+]/g, '');

    const apiPayload = {
      name: parsedData.customer_name,
      email: parsedData.client_email || '',
      phone: sanitizedPhone,
      service_type: parsedData.sport_type,
      preferred_date: parsedData.booking_date,
      preferred_time: parsedData.start_time,
      end_time: parsedData.end_time || '',
      venue_name: parsedData.venue_name,
      payment_mode: parsedData.payment_mode,
      message: '',
    };

    if (isOnline()) {
      // ── ONLINE: Call the backend API ──
      const result = await apiPost('/api/bookings', apiPayload);

      if (!result.success) {
        failPipeline('availability');

        if (result.booking && result.booking.alternative_slots && result.booking.alternative_slots.length > 0) {
          const altSlots = result.booking.alternative_slots;
          const altList = altSlots.map(s => `  • ${s.start_time} - ${s.end_time}`).join('\n');
          errorMsg.textContent = `Sorry! This slot is already booked.\n\nAvailable alternatives:\n${altList}\n\nPlease try a different time.`;
        } else {
          errorMsg.textContent = `Booking failed: ${result.message || 'Slot not available'}`;
        }

        errorCard.style.display = 'block';
        showToast('Slot not available', 'error');
        resetUi();
        return;
      }

      advancePipeline('pricing');
      await sleep(200);
      advancePipeline('booking');
      await sleep(200);
      advancePipeline('invoice');
      await sleep(200);

      // Save to IndexedDB as backup
      const bookingData = {
        booking_id: result.booking_id || (result.booking && result.booking.booking_id),
        client_name: apiPayload.name,
        client_email: apiPayload.email,
        client_phone: apiPayload.phone,
        service_type: apiPayload.service_type,
        preferred_date: apiPayload.preferred_date,
        preferred_time: apiPayload.preferred_time,
        end_time: apiPayload.end_time,
        venue_name: apiPayload.venue_name,
        payment_mode: apiPayload.payment_mode,
        payment_status: result.booking && result.booking.payment_status ? result.booking.payment_status : (apiPayload.payment_mode === 'Online' ? 'Paid' : 'Pay at Venue'),
        total_amount: result.booking && result.booking.total_amount ? String(result.booking.total_amount) : '',
        rate_per_hour: result.booking && result.booking.rate_per_hour ? result.booking.rate_per_hour : 0,
        duration: result.booking && result.booking.duration ? result.booking.duration : 1,
        base_amount: result.booking && result.booking.base_amount ? result.booking.base_amount : 0,
        gst_amount: result.booking && result.booking.gst_amount ? result.booking.gst_amount : 0,
        status: 'CONFIRMED',
        created_at: new Date().toISOString(),
      };
      saveBooking(bookingData);

      // Use returned booking data for invoice
      const booking = result.booking || bookingData;
      renderInvoice({
        booking_id: result.booking_id || booking.booking_id,
        customer_name: booking.client_name || apiPayload.name,
        sport_type: booking.service_type || apiPayload.service_type,
        venue_name: booking.venue_name || apiPayload.venue_name,
        booking_date: booking.preferred_date || apiPayload.preferred_date,
        start_time: booking.preferred_time || apiPayload.preferred_time,
        end_time: booking.end_time || '',
        duration: booking.duration || 1,
        rate_per_hour: booking.rate_per_hour || 1000,
        base_amount: booking.base_amount || 0,
        gst_amount: booking.gst_amount || 0,
        total_amount: booking.total_amount || 0,
        payment_status: booking.payment_status || 'Paid',
      });
    } else {
      // ── OFFLINE: Process locally ──
      // Check availability from IndexedDB using shared helper
      var availabilityCheck = await checkSlotAvailabilityAsync({
        venue_name: apiPayload.venue_name,
        preferred_date: apiPayload.preferred_date,
        preferred_time: apiPayload.preferred_time,
        end_time: apiPayload.end_time,
      });

      if (!availabilityCheck.available) {
        failPipeline('availability');
        errorMsg.textContent = 'Sorry! This slot is already booked (offline mode). Please try a different time.';
        errorCard.style.display = 'block';
        showToast('Slot not available', 'error');
        resetUi();
        return;
      }

      advancePipeline('pricing');
      await sleep(200);

      // Calculate price locally
      var sportKey = apiPayload.service_type.toLowerCase();
      var ratePerHour = PRICING[sportKey] || DEFAULT_RATE;
      var sh2 = parseInt(apiPayload.preferred_time.split(':')[0]);
      var sm2 = parseInt(apiPayload.preferred_time.split(':')[1]);
      var eh2 = parseInt(apiPayload.end_time.split(':')[0]);
      var em2 = parseInt(apiPayload.end_time.split(':')[1]);
      var duration = Math.max((eh2 + em2 / 60) - (sh2 + sm2 / 60), 0.5);
      var baseAmount = Math.round(ratePerHour * duration);
      var gstAmount = Math.round(baseAmount * GST_RATE);
      var totalAmount = Math.round(baseAmount + gstAmount);

      // Generate booking ID
      var bookingId = 'BYP-' + Date.now();

      // Set payment status
      var paymentStatus = apiPayload.payment_mode === 'Online' ? 'Paid' : 'Pay at Venue';

      var offlineBooking = {
        booking_id: bookingId,
        client_name: apiPayload.name,
        client_email: apiPayload.email,
        client_phone: apiPayload.phone,
        service_type: apiPayload.service_type,
        preferred_date: apiPayload.preferred_date,
        preferred_time: apiPayload.preferred_time,
        end_time: apiPayload.end_time,
        venue_name: apiPayload.venue_name,
        payment_mode: apiPayload.payment_mode,
        payment_status: paymentStatus,
        total_amount: String(totalAmount),
        rate_per_hour: ratePerHour,
        duration: duration,
        base_amount: baseAmount,
        gst_amount: gstAmount,
        status: 'CONFIRMED',
        created_at: new Date().toISOString(),
      };

      // Save to IndexedDB
      saveBooking(offlineBooking);

      // Add to sync queue
      addToSyncQueue({
        type: 'create_booking',
        data: apiPayload,
      }).catch(function(err) {
        console.warn('Failed to enqueue sync item:', err);
      });

      advancePipeline('booking');
      await sleep(200);
      advancePipeline('invoice');
      await sleep(200);

      renderInvoice({
        booking_id: bookingId,
        customer_name: apiPayload.name,
        sport_type: apiPayload.service_type,
        venue_name: apiPayload.venue_name,
        booking_date: apiPayload.preferred_date,
        start_time: apiPayload.preferred_time,
        end_time: apiPayload.end_time,
        duration: duration,
        rate_per_hour: ratePerHour,
        base_amount: baseAmount,
        gst_amount: gstAmount,
        total_amount: totalAmount,
        payment_status: paymentStatus,
      });
    }

    // ── Common: Save to recent clients and show invoice ──
    saveRecentClient(
      parsedData.customer_name,
      sanitizedPhone,
      parsedData.client_email
    );

    invoiceContainer.style.display = 'block';
    invActions.style.display = 'flex';
    updateBookingCount();
    showToast('Booking confirmed! ✅', 'success');
  } catch (err) {
    console.error('Workflow error:', err);
    failPipeline('availability');
    errorMsg.textContent = `Something went wrong: ${err.message || 'Please try again.'}`;
    errorCard.style.display = 'block';
    showToast('Something went wrong — see error details below.', 'error');
  } finally {
    resetUi();
    if (resultsLoading) resultsLoading.classList.remove('show');
  }
}

function resetUi() {
  btnSubmit.disabled = false;
  btnSubmit.classList.remove('loading');
  btnSubmit.querySelector('.btn-text').textContent = 'Process Booking';
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================
// QUICK FILL
// ============================================

const SAMPLES = {
  cricket: {
    name: 'Rajesh Sharma',
    email: 'rajesh@example.com',
    phone: '+91 98765 43210',
    sport: 'Cricket',
    venue: 'Elite Turf',
    start: '18:00',
    end: '20:00',
    payment: 'Online',
  },
  football: {
    name: 'Amit Singh',
    email: 'amit@example.com',
    phone: '+91 87654 32109',
    sport: 'Football',
    venue: 'Stadium East',
    start: '16:00',
    end: '17:30',
    payment: 'Pay at Venue',
  },
  pickleball: {
    name: 'Priya Patel',
    email: 'priya@example.com',
    phone: '+91 76543 21098',
    sport: 'Pickleball',
    venue: 'The Pickle Hub',
    start: '10:00',
    end: '11:00',
    payment: 'Online',
  },
};

function applySample(key) {
  const sample = SAMPLES[key];
  if (!sample) return;

  document.getElementById('customer-name').value = sample.name;
  document.getElementById('client-email').value = sample.email || '';
  document.getElementById('client-phone').value = sample.phone || '';
  document.getElementById('sport-type').value = sample.sport;
  document.getElementById('venue-name').value = sample.venue;

  // Trigger sport filtering based on venue
  filterSportsByVenue();
  // Re-set sport type after filter (in case venue changed available sports)
  const sportOpt = sportSelect.querySelector(`option[value="${sample.sport}"]`);
  if (sportOpt) {
    sportSelect.value = sample.sport;
  } else {
    // If sport not in venue's available list, add it temporarily
    const opt = document.createElement('option');
    opt.value = sample.sport;
    opt.textContent = sample.sport;
    sportSelect.appendChild(opt);
    sportSelect.value = sample.sport;
  }

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  document.getElementById('booking-date').value = tomorrow.toISOString().split('T')[0];

  document.getElementById('start-time').value = sample.start;
  document.getElementById('end-time').value = sample.end;

  document.querySelectorAll('.toggle-option').forEach(el => {
    const radio = el.querySelector('input');
    if (radio.value === sample.payment) {
      el.classList.add('active');
      radio.checked = true;
    } else {
      el.classList.remove('active');
    }
  });

  clearErrors();

  // Trigger slot picker to refresh for the new sample data
  onSlotPickerInput();
}

// ============================================
// SEED DEFAULT VENUES
// ============================================

// ============================================
// SEED DEFAULT VENUES INTO LOCALSTORAGE
// ============================================

function seedDefaultVenues() {
  const venues = getVenues();
  if (venues.length === 0) {
    const defaults = [
      { name: 'Elite Turf', sports: ['Cricket', 'Football', 'Pickleball'] },
      { name: 'Stadium East', sports: ['Football', 'Tennis', 'Badminton'] },
      { name: 'The Pickle Hub', sports: ['Pickleball', 'Badminton'] },
      { name: 'Cricket Arena', sports: ['Cricket'] },
      { name: 'MultiSports Complex', sports: ['Cricket', 'Football', 'Badminton', 'Tennis', 'Pickleball'] },
    ];
    saveVenues(defaults);
  }
}

// ============================================
// BOOKING HELPERS (backed by IndexedDB)
// ============================================

function getBookings() {
  return [];
}

async function getBookingsAsync() {
  try {
    return await getLocalBookings();
  } catch (e) {
    console.warn('IndexedDB read failed:', e);
    return [];
  }
}

function saveBooking(data) {
  saveLocalBooking(data).catch(function(e) {
    console.warn('IndexedDB save failed:', e);
  });
  return data;
}

function generateBookingId() { return 'BYP-' + Date.now(); }

// ============================================
// EVENT LISTENERS
// ============================================

form.addEventListener('submit', (e) => {
  e.preventDefault();
  executeWorkflow();
});

document.querySelectorAll('.toggle-option').forEach(el => {
  el.addEventListener('click', () => {
    document.querySelectorAll('.toggle-option').forEach(o => o.classList.remove('active'));
    el.classList.add('active');
    el.querySelector('input').checked = true;
  });
});

document.querySelectorAll('.quick-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    applySample(btn.dataset.sample);
    showToast(`Sample "${btn.textContent}" loaded`, 'success');
  });
});

document.getElementById('btn-retry').addEventListener('click', () => {
  errorCard.style.display = 'none';
  resetPipeline();
  pipeline.style.display = 'none';
  emptyState.style.display = 'flex';
});

document.getElementById('btn-new').addEventListener('click', () => {
  invoiceContainer.style.display = 'none';
  errorCard.style.display = 'none';
  invActions.style.display = 'none';
  pipeline.style.display = 'none';
  emptyState.style.display = 'flex';
  resetPipeline();
  document.getElementById('form-panel').scrollIntoView({ behavior: 'smooth' });
});

// PDF download — uses native browser Print dialog (works on all devices)
document.getElementById('btn-pdf').addEventListener('click', () => {
  downloadInvoicePdf();
});

// Share Invoice via Web Share API (native share sheet on phones)
document.getElementById('btn-share').addEventListener('click', () => {
  shareInvoice();
});

function shareInvoice() {
  // Read invoice data from the DOM
  var shareText = [
    '🧾 *Book Your Pitch — Invoice*',
    '',
    'Booking ID: ' + invBookingId.textContent,
    'Customer: ' + invCustomer.textContent,
    'Sport: ' + invSport.textContent,
    'Venue: ' + invVenue.textContent,
    'Date: ' + invDate.textContent,
    'Time: ' + invTime.textContent,
    'Duration: ' + invDuration.textContent,
    '',
    'Base Amount: ' + invBase.textContent,
    'GST (18%): ' + invGst.textContent,
    '*Total: ' + invTotal.textContent + '*',
    'Payment: ' + invPaymentBadge.textContent,
    '',
    'Thank you for booking with us!',
  ].join('\n');

  // Check if Web Share API is available (mobile browsers)
  if (navigator.share) {
    navigator.share({
      title: 'Booking Invoice ' + invBookingId.textContent,
      text: shareText,
    }).then(function() {
      showToast('Invoice shared!', 'success');
    }).catch(function(err) {
      // User cancelled — don't show error
      if (err.name !== 'AbortError') {
        console.warn('Share failed:', err);
        fallbackShare(shareText);
      }
    });
  } else {
    // Web Share not available — copy to clipboard as fallback
    fallbackShare(shareText);
  }
}

function fallbackShare(text) {
  // Fallback: copy invoice details to clipboard
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(function() {
      showToast('Invoice copied to clipboard!', 'success');
    }).catch(function() {
      showToast('Could not share. Use screenshot instead.', 'warning');
    });
  } else {
    // Last resort: prompt the user to take a screenshot
    showToast('Take a screenshot to share the invoice', 'warning');
  }
}

function downloadInvoicePdf() {
  // Read invoice data from the DOM
  const bookingData = {
    bookingId: invBookingId.textContent,
    customer: invCustomer.textContent,
    sport: invSport.textContent,
    venue: invVenue.textContent,
    date: invDate.textContent,
    time: invTime.textContent,
    duration: invDuration.textContent,
    rateText: invRate.textContent,
    baseText: invBase.textContent,
    gstText: invGst.textContent,
    totalText: invTotal.textContent,
    paymentStatus: invPaymentBadge.textContent,
  };

  showToast('Opening print dialog...', 'success');

  // Build the standalone invoice HTML
  const invoiceHtml = buildInvoiceHtml(bookingData);

  // Hide all app content so the print view is clean
  var tabs = document.querySelectorAll('.tab-content');
  var nav = document.querySelector('nav');
  var hiddenElements = [];

  tabs.forEach(function(tc) {
    if (tc.style.display !== 'none') {
      hiddenElements.push({ el: tc, display: tc.style.display });
      tc.style.display = 'none';
    }
  });

  if (nav) {
    hiddenElements.push({ el: nav, display: nav.style.display });
    nav.style.display = 'none';
  }

  // Create a visible full-screen container with the invoice
  var container = document.createElement('div');
  container.id = 'pdf-print-content';
  container.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:999999;background:#fff;overflow:auto;-webkit-overflow-scrolling:touch;';
  document.body.appendChild(container);

  // Inject the standalone invoice HTML
  // (The html/head/body tags are stripped by the browser, but styles apply correctly)
  container.innerHTML = invoiceHtml;

  // Add print CSS overrides for clean print output
  var style = document.createElement('style');
  style.id = 'pdf-print-overrides';
  style.textContent = (
    '@media print {\n' +
    '  body > *:not(#pdf-print-content) { display: none !important; }\n' +
    '  #pdf-print-content {' +
    '    display: block !important;' +
    '    position: static !important;' +
    '    width: 100% !important;' +
    '    height: auto !important;' +
    '    overflow: visible !important;' +
    '  }\n' +
    '}'
  );
  document.head.appendChild(style);

  // Scroll to top so the invoice is at the top of the viewport
  window.scrollTo(0, 0);
  container.scrollTop = 0;

  // Wait for fonts and rendering to finish, then print
  // document.fonts.ready resolves immediately for system fonts but waits for any web fonts
  document.fonts.ready.then(function() {
    // Small extra delay to ensure layout is complete
    setTimeout(function() {
      window.print();

      function cleanup() {
        // Remove the print container and style
        if (container.parentNode) container.parentNode.removeChild(container);
        if (style.parentNode) style.parentNode.removeChild(style);

        // Restore all hidden elements
        hiddenElements.forEach(function(item) {
          item.el.style.display = item.display;
        });
      }

      // Listen for afterprint
      try {
        var mq = window.matchMedia('print');
        if (mq && mq.addListener) {
          mq.addListener(function handler(mql) {
            if (!mql.matches) {
              mq.removeListener(handler);
              setTimeout(cleanup, 300);
            }
          });
        }
      } catch (e) {}

      // Fallback cleanup
      setTimeout(cleanup, 15000);
    }, 200);
  });
}

function buildInvoiceHtml(data) {
  // Escape all text values to prevent XSS and HTML rendering issues
  const h = escapeHtml;
  const e = function(v) { return h(String(v || '')); };
  const isPaid = data.paymentStatus === 'Paid';
  const badgeClass = isPaid ? 'status-paid' : 'status-venue';

  return `<!DOCTYPE html>
<html>
<head>
  <title>Invoice ${data.bookingId}</title>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background: #ffffff;
      color: #0f172a;
      padding: 40px 24px;
      -webkit-font-smoothing: antialiased;
    }
    .invoice-container {
      max-width: 700px;
      margin: 0 auto;
      border: 1px solid rgba(14, 165, 233, 0.14);
      border-radius: 20px;
      padding: 32px;
      position: relative;
      overflow: hidden;
      box-shadow: 0 1px 3px rgba(14,165,233,0.06), 0 4px 16px rgba(14,165,233,0.08);
    }
    .invoice-container::before {
      content: '';
      position: absolute;
      top: 0; left: 0; right: 0;
      height: 3px;
      background: linear-gradient(90deg, #0ea5e9, #f59e0b, #0ea5e9);
      opacity: 0.6;
    }
    .inv-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 20px;
      border-bottom: 1px solid rgba(14, 165, 233, 0.08);
      margin-bottom: 20px;
    }
    .inv-brand {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .inv-logo {
      width: 40px;
      height: 40px;
      background: #0ea5e9;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-weight: 700;
      font-size: 18px;
    }
    .inv-brand-name {
      font-family: Georgia, 'Times New Roman', serif;
      font-size: 20px;
      font-weight: 700;
      letter-spacing: -0.3px;
      line-height: 1.2;
    }
    .inv-brand-tag {
      font-size: 11px;
      color: #64748b;
      letter-spacing: 0.3px;
    }
    .inv-badge {
      padding: 6px 16px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.3px;
      text-transform: uppercase;
    }
    .inv-badge.status-paid {
      background: rgba(20, 184, 166, 0.08);
      color: #0d9488;
      border: 1px solid rgba(20, 184, 166, 0.15);
    }
    .inv-badge.status-venue {
      background: rgba(245, 158, 11, 0.08);
      color: #d97706;
      border: 1px solid rgba(245, 158, 11, 0.15);
    }
    .inv-id-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 16px;
      background: #e8f0fa;
      border-radius: 10px;
      margin-bottom: 20px;
    }
    .inv-id-label {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #64748b;
    }
    .inv-id-value {
      font-size: 14px;
      font-weight: 600;
      letter-spacing: 0.3px;
      color: #0284c7;
    }
    .inv-details {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 16px;
      margin-bottom: 24px;
      padding: 16px;
      background: #f4f8fe;
      border-radius: 10px;
      border: 1px solid rgba(14, 165, 233, 0.08);
    }
    .inv-detail {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .inv-d-label {
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #64748b;
    }
    .inv-d-value {
      font-size: 14px;
      font-weight: 500;
      color: #0f172a;
    }
    .inv-pricing {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 20px;
    }
    .inv-pricing td {
      padding: 10px 0;
      font-size: 14px;
      color: #475569;
    }
    .inv-pricing tr:not(:last-child) {
      border-bottom: 1px solid rgba(14, 165, 233, 0.08);
    }
    .inv-rate {
      font-size: 12px;
      color: #64748b;
    }
    .inv-amount {
      text-align: right;
      font-weight: 500;
      color: #0f172a;
    }
    .inv-total-row td {
      padding-top: 14px;
      border-top: 2px solid #f59e0b;
    }
    .inv-total-row td strong {
      color: #0f172a;
    }
    .inv-total {
      font-size: 22px;
      font-weight: 700;
      color: #d97706 !important;
    }
    .inv-footer {
      text-align: center;
      padding-top: 20px;
      border-top: 1px solid rgba(14, 165, 233, 0.08);
    }
    .inv-footer p {
      font-size: 12px;
      color: #64748b;
      font-style: italic;
    }
    @media print {
      body { padding: 0; }
      .invoice-container {
        box-shadow: none;
        border: none;
        border-radius: 0;
        padding: 20px;
      }
    }
    @media (max-width: 600px) {
      .invoice-container { padding: 20px; }
      .inv-header { flex-direction: column; align-items: flex-start; gap: 10px; }
      .inv-details { grid-template-columns: 1fr 1fr; gap: 10px; padding: 12px; }
      .inv-d-value { font-size: 13px; }
      .inv-id-row { padding: 10px 14px; }
      .inv-pricing td { padding: 8px 0; font-size: 13px; }
      .inv-total { font-size: 20px; }
    }
    @media (max-width: 400px) {
      .inv-details { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="invoice-container">
    <div class="inv-header">
      <div class="inv-brand">
        <div class="inv-logo">BYP</div>
        <div>
          <div class="inv-brand-name">Book Your Pitch</div>
          <div class="inv-brand-tag">Sports Venue Booking</div>
        </div>
      </div>
      <div class="inv-badge ${badgeClass}">${e(data.paymentStatus)}</div>
    </div>

    <div class="inv-id-row">
      <span class="inv-id-label">Booking ID</span>
      <span class="inv-id-value">${e(data.bookingId)}</span>
    </div>

    <div class="inv-details">
      <div class="inv-detail">
        <span class="inv-d-label">Customer</span>
        <span class="inv-d-value">${e(data.customer)}</span>
      </div>
      <div class="inv-detail">
        <span class="inv-d-label">Sport</span>
        <span class="inv-d-value">${e(data.sport)}</span>
      </div>
      <div class="inv-detail">
        <span class="inv-d-label">Venue</span>
        <span class="inv-d-value">${e(data.venue)}</span>
      </div>
      <div class="inv-detail">
        <span class="inv-d-label">Date</span>
        <span class="inv-d-value">${e(data.date)}</span>
      </div>
      <div class="inv-detail">
        <span class="inv-d-label">Time</span>
        <span class="inv-d-value">${e(data.time)}</span>
      </div>
      <div class="inv-detail">
        <span class="inv-d-label">Duration</span>
        <span class="inv-d-value">${e(data.duration)}</span>
      </div>
    </div>

    <table class="inv-pricing">
      <tr>
        <td>Base Amount <span class="inv-rate">${e(data.rateText)}</span></td>
        <td class="inv-amount">${e(data.baseText)}</td>
      </tr>
      <tr>
        <td>GST (18%)</td>
        <td class="inv-amount">${e(data.gstText)}</td>
      </tr>
      <tr class="inv-total-row">
        <td><strong>Total Amount</strong></td>
        <td class="inv-amount inv-total">${e(data.totalText)}</td>
      </tr>
    </table>

    <div class="inv-footer">
      <p>Thank you for booking with us. See you at the venue!</p>
    </div>
  </div>

</body>
</html>`;
}



document.querySelectorAll('.field-input').forEach(el => {
  el.addEventListener('input', () => el.classList.remove('error'));
});

// ============================================
// SLOT PICKER
// ============================================

let _slotPickerTimer = null;
const slotPicker = document.getElementById('slot-picker');
const slotPickerGrid = document.getElementById('slot-picker-grid');
const slotPickerSub = document.getElementById('slot-picker-sub');
const slotPickerLoading = document.getElementById('slot-picker-loading');
const slotPickerError = document.getElementById('slot-picker-error');

/**
 * Fetch available slots from the API and render the picker grid.
 */
async function fetchAndRenderSlots() {
  const date = document.getElementById('booking-date').value;
  const venue = document.getElementById('venue-name').value;
  const sport = document.getElementById('sport-type').value;

  // Only show slot picker when all three are selected
  if (!date || !venue || !sport || venue === '__no_venues__') {
    slotPicker.style.display = 'none';
    return;
  }

  slotPicker.style.display = 'block';
  slotPickerGrid.style.display = 'none';
  slotPickerError.style.display = 'none';
  slotPickerLoading.classList.add('show');
  slotPickerSub.textContent = 'Checking...';

  try {
    const res = await fetch(`/api/slots?date=${encodeURIComponent(date)}&venue=${encodeURIComponent(venue)}&sport=${encodeURIComponent(sport)}`);
    const data = await res.json();

    slotPickerLoading.classList.remove('show');

    if (!data.success) {
      slotPickerError.textContent = data.message || 'Failed to load slots';
      slotPickerError.style.display = 'block';
      slotPickerGrid.style.display = 'none';
      return;
    }

    const slots = data.slots || [];
    const summary = data.summary || {};

    slotPickerSub.textContent = `${summary.available || 0} available of ${summary.total_slots || 0} slots`;

    if (slots.length === 0) {
      slotPickerGrid.innerHTML = '<div class="slot-picker-error" style="display:block;">No time slots available for this date.</div>';
      return;
    }

    // Render slot buttons
    let html = '';
    slots.forEach(function(s) {
      const statusClass = s.available ? 'available' : 'booked';
      const statusLabel = s.available ? 'Available' : 'Booked';
      html += `<button type="button" class="slot-btn ${statusClass}" data-start="${s.start_time}" data-end="${s.end_time}" ${s.available ? '' : 'disabled'}>
        <span class="slot-time">${s.start_time} — ${s.end_time}</span>
        <span class="slot-label">${statusLabel}</span>
      </button>`;
    });

    slotPickerGrid.innerHTML = html;
    slotPickerGrid.style.display = 'grid';

    // Attach click handlers to available slots
    slotPickerGrid.querySelectorAll('.slot-btn.available').forEach(function(btn) {
      btn.addEventListener('click', function() {
        // Deselect all
        slotPickerGrid.querySelectorAll('.slot-btn').forEach(function(b) {
          b.classList.remove('selected');
        });
        // Select this slot
        btn.classList.add('selected');
        // Fill in the time inputs
        document.getElementById('start-time').value = btn.dataset.start;
        document.getElementById('end-time').value = btn.dataset.end;
        // Clear errors
        document.getElementById('start-time').classList.remove('error');
        document.getElementById('end-time').classList.remove('error');
      });
    });
  } catch (err) {
    slotPickerLoading.classList.remove('show');
    slotPickerError.textContent = 'Could not load slots. ' + (err.message || '');
    slotPickerError.style.display = 'block';
    slotPickerGrid.style.display = 'none';
    console.warn('Slot picker error:', err);
  }
}

/**
 * Debounced version of fetchAndRenderSlots for form change events.
 */
function onSlotPickerInput() {
  clearTimeout(_slotPickerTimer);
  _slotPickerTimer = setTimeout(fetchAndRenderSlots, 300);
}

// Watch for changes on date, venue, and sport selects
if (document.getElementById('booking-date')) {
  document.getElementById('booking-date').addEventListener('change', onSlotPickerInput);
}
// The venue and sport select already have listeners; add slot picker trigger to them
document.getElementById('venue-name').addEventListener('change', function() {
  // Keep existing filterSportsByVenue behavior
  onSlotPickerInput();
});
document.getElementById('sport-type').addEventListener('change', onSlotPickerInput);

// ============================================
// CALENDAR CLEANUP
// ============================================

async function cleanupCalendar() {
  const btn = document.getElementById('btn-cleanup-calendar');
  if (!btn) return;

  btn.classList.add('cleaning');
  const originalText = btn.innerHTML;
  btn.innerHTML = '<span class="spinner"></span> Cleaning...';

  try {
    const res = await fetch('/api/cleanup/calendar', { method: 'POST' });
    const data = await res.json();

    if (data.success) {
      showToast(
        `🗑️ Cleaned ${data.deleted} past booking${data.deleted !== 1 ? 's' : ''} from Calendar`,
        'success'
      );
    } else {
      showToast('Calendar cleanup failed: ' + (data.message || 'Unknown error'), 'error');
    }
  } catch (err) {
    showToast('Calendar cleanup failed: ' + (err.message || 'Could not connect'), 'error');
    console.warn('Cleanup error:', err);
  } finally {
    btn.classList.remove('cleaning');
    btn.innerHTML = originalText;
  }
}

// Attach cleanup button handler
if (document.getElementById('btn-cleanup-calendar')) {
  document.getElementById('btn-cleanup-calendar').addEventListener('click', function() {
    cleanupCalendar();
  });
}

// ============================================
// EVENT LISTENERS (additional)
// ============================================

// Dark mode toggle
if (btnTheme) {
  btnTheme.addEventListener('click', toggleTheme);
}

// Clear recent clients
if (recentClientsClear) {
  recentClientsClear.addEventListener('click', function() {
    localStorage.removeItem(RECENT_CLIENTS_KEY);
    renderRecentClients();
    showToast('Recent clients cleared', 'success');
  });
}

// ============================================
// INIT (safe — wrapped in try-catch)
// ============================================
try {
  seedDefaultVenues();
  loadVenueSelect();
  filterSportsByVenue();
  updateBookingCount();
  loadTheme();
  initVoiceInput();
  renderRecentClients();
  createConnectivityIndicator();

  // Listen for connectivity changes
  window.addEventListener('online', function() {
    onConnectionRestored();
  });
  window.addEventListener('offline', function() {
    updateConnectivityStatus();
    showToast('📵 You are offline — bookings will be saved locally and synced when connection returns.', 'warning');
  });

  // Auto-sync pending items on startup
  if (isOnline()) {
    processSyncQueue().then(function(result) {
      if (result.synced > 0 || result.failed > 0) {
        console.log('Startup sync:', result.synced, 'synced,', result.failed, 'failed');
        updateBookingCount();
      }
    }).catch(function(e) {
      console.warn('Startup sync failed:', e);
    });
  }

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dateInput = document.getElementById('booking-date');
  if (dateInput) {
    dateInput.value = tomorrow.toISOString().split('T')[0];
  }
} catch (e) {
  console.error('Init error:', e);
  showToast('⚠️ Page initialization error: ' + (e.message || 'Unknown'), 'error');
}

// Log connection status
apiGet('/api/health')
  .then(data => {
    console.log('✅ Booking API connected:', data);
    const status = [
      `Sheets: ${data.sheets_configured ? '✅' : '❌'}`,
      `Twilio: ${data.twilio_configured ? '✅' : '❌'}`,
      `Email: ${data.email_configured ? '✅' : '❌'}`,
    ].join(' | ');
    showToast(`Server connected! ${status}`, 'success');
  })
  .catch(err => {
    console.warn('⚠️ Booking API not available:', err.message);
    // Still show connectivity indicator
    createConnectivityIndicator();
    updateConnectivityStatus();
    // Try to sync pending items anyway
    processSyncQueue().catch(function(e) {
      console.warn('Background sync failed:', e);
    });
  });
