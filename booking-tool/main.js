/* ============================================
   BOOK YOUR PITCH — Booking Automation Engine
   ============================================
   Replicates the n8n workflow:
   Parse → Validate → Check Availability → Calculate Price
   → Generate Booking ID → Store (API) → Notify → Invoice
   ============================================ */

'use strict';

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

// ============================================
// STATE
// ============================================
const VENUES_KEY = 'byp_venues';

const ALL_SPORTS = ['Cricket', 'Football', 'Pickleball', 'Badminton', 'Tennis', 'Other'];

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
  // Fetch count from API
  apiGet('/api/bookings')
    .then(data => {
      totalBookingsEl.textContent = data.count || 0;
    })
    .catch(() => {
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

async function renderBookingsList(filterText) {
  const search = (filterText || bookingsSearch.value || '').toLowerCase().trim();

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
    console.error('Failed to fetch bookings:', err);
    showToast('Could not connect to server. Is the API running?', 'error');
    bookingsTbody.innerHTML = '';
    tableEmpty.style.display = 'flex';
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

function checkSlotAvailability(data) {
  const existing = getBookings();
  const startMinutes = timeToMinutes(data.start_time);
  const endMinutes = timeToMinutes(data.end_time);

  for (const booking of existing) {
    if (
      booking.venue_name?.toLowerCase() === data.venue_name.toLowerCase() &&
      booking.booking_date === data.booking_date
    ) {
      const bStart = timeToMinutes(booking.start_time);
      const bEnd = timeToMinutes(booking.end_time);

      const overlaps =
        (startMinutes >= bStart && startMinutes < bEnd) ||
        (endMinutes > bStart && endMinutes <= bEnd) ||
        (startMinutes <= bStart && endMinutes >= bEnd);

      if (overlaps) {
        return {
          available: false,
          conflict: {
            customer: booking.customer_name,
            start: booking.start_time,
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

    // Call the backend API
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

    // Use returned booking data for invoice
    const booking = result.booking;
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
}

// ============================================
// SEED DEFAULT VENUES
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

// PDF download
document.getElementById('btn-pdf').addEventListener('click', () => {
  const element = document.getElementById('invoice-card');
  const btn = document.getElementById('btn-pdf');
  const filename = `invoice-${invBookingId.textContent}.pdf`;

  if (typeof html2pdf !== 'undefined') {
    const opt = {
      margin:        [0.5, 0.5, 0.5, 0.5],
      filename:      filename,
      image:         { type: 'jpeg', quality: 0.98 },
      html2canvas:   { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
      jsPDF:         { unit: 'in', format: 'a4', orientation: 'portrait' },
      pagebreak:     { mode: 'avoid-all' },
    };

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Generating...';

    html2pdf().set(opt).from(element).save().then(() => {
      btn.disabled = false;
      restorePdfButton(btn);
      showToast('PDF downloaded!', 'success');
    }).catch((err) => {
      console.error('html2pdf error:', err);
      btn.disabled = false;
      restorePdfButton(btn);
      showToast('PDF failed — trying print instead.', 'error');
      printInvoice();
    });
  } else {
    printInvoice();
  }
});

function restorePdfButton(btn) {
  btn.innerHTML = `
    <svg viewBox="0 0 20 20" fill="currentColor" width="18"><path d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z"/></svg>
    Download PDF
  `;
}

function printInvoice() {
  const printWin = window.open('', '_blank');
  if (!printWin) {
    showToast('Please allow pop-ups to print the invoice.', 'error');
    return;
  }

  const card = document.getElementById('invoice-card');
  const clone = card.cloneNode(true);

  printWin.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Invoice ${invBookingId.textContent}</title>
      <link rel="preconnect" href="https://fonts.googleapis.com">
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
      <link href="https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600;700&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
      <style>
        body { background: #ffffff; font-family: 'DM Sans', sans-serif; padding: 40px; }
        ${Array.from(document.styleSheets).reduce((css, sheet) => {
          try {
            const rules = sheet.cssRules || sheet.rules;
            if (rules) {
              for (let r of rules) css += r.cssText;
            }
          } catch(e) {}
          return css;
        }, '')}
        .inv-card-print { max-width: 700px; margin: auto; }
        .inv-actions, .pipeline, .error-card, .toast { display: none !important; }
      </style>
    </head>
    <body>
      <div class="inv-card-print">${clone.outerHTML}</div>
      <script>window.onload = function() { window.print(); window.close(); }<\\/script>
    </body>
    </html>
  `);
  printWin.document.close();
}

document.querySelectorAll('.field-input').forEach(el => {
  el.addEventListener('input', () => el.classList.remove('error'));
});

// ============================================
// INIT
// ============================================

seedDefaultVenues();
loadVenueSelect();
filterSportsByVenue();
updateBookingCount();

const tomorrow = new Date();
tomorrow.setDate(tomorrow.getDate() + 1);
document.getElementById('booking-date').value = tomorrow.toISOString().split('T')[0];

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
    showToast(`API not reachable at ${API_BASE_URL}. Start the server with: cd booking-api && python main.py`, 'error');
  });
