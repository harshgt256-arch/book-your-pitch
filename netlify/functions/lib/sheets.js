/**
 * Google Sheets service — handles all Sheet CRUD operations.
 * Ported from booking-api/services/sheets.py
 */

const { GoogleAuth } = require('google-auth-library');
const { sheets: sheetsFactory } = require('@googleapis/sheets');

// ── Auth ───────────────────────────────────────────────────

function getAuth() {
  const jsonStr = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!jsonStr) {
    throw new Error(
      'GOOGLE_SERVICE_ACCOUNT_JSON not set. Paste your service account JSON as a single env var.'
    );
  }
  const credentials = JSON.parse(jsonStr);
  return new GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

/** @type {import('@googleapis/sheets').sheets_v4.Sheets | null} */
let _sheetsClient = null;

async function getSheetsService() {
  if (_sheetsClient) return _sheetsClient;
  const auth = getAuth();
  _sheetsClient = sheetsFactory({ version: 'v4', auth });
  return _sheetsClient;
}

// ── Helpers ─────────────────────────────────────────────────

function getSpreadsheetId() {
  const sid = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  if (!sid) throw new Error('GOOGLE_SHEETS_SPREADSHEET_ID not set');
  return sid;
}

function getPricingMap() {
  return {
    cricket: parseInt(process.env.PRICE_CRICKET || '1500'),
    football: parseInt(process.env.PRICE_FOOTBALL || '1200'),
    pickleball: parseInt(process.env.PRICE_PICKLEBALL || '800'),
    badminton: parseInt(process.env.PRICE_BADMINTON || '600'),
    tennis: parseInt(process.env.PRICE_TENNIS || '1000'),
  };
}

function getDefaultPrice() {
  return parseInt(process.env.PRICE_DEFAULT || '1000');
}

function getGstRate() {
  return parseFloat(process.env.GST_RATE || '0.18');
}

function getSlotDurationHours() {
  return parseFloat(process.env.SLOT_DURATION_HOURS || '1');
}

// ── Sheet Operations ────────────────────────────────────────

const EXPECTED_HEADERS = [
  'booking_id', 'client_name', 'client_email', 'client_phone',
  'service_type', 'preferred_date', 'preferred_time', 'message',
  'status', 'created_at',
  'end_time', 'venue_name', 'payment_mode', 'total_amount',
];

async function ensureHeaders() {
  const sid = getSpreadsheetId();
  const service = await getSheetsService();

  const result = await service.spreadsheets.values.get({
    spreadsheetId: sid,
    range: 'A:Z',
  });

  const rows = result.data.values || [];

  if (rows.length > 0) {
    const existingHeaders = rows[0].map(h => String(h).trim());
    const allPresent = EXPECTED_HEADERS.every(h => existingHeaders.includes(h));
    if (allPresent) return existingHeaders;
  }

  // Write headers
  await service.spreadsheets.values.update({
    spreadsheetId: sid,
    range: 'A1',
    valueInputOption: 'RAW',
    requestBody: { values: [EXPECTED_HEADERS] },
  });

  return EXPECTED_HEADERS;
}

async function getAllBookings() {
  const sid = getSpreadsheetId();
  const service = await getSheetsService();

  const result = await service.spreadsheets.values.get({
    spreadsheetId: sid,
    range: 'A:Z',
  });

  const rows = result.data.values || [];

  if (rows.length < 2) return [];

  // Strip whitespace from header names
  const headers = rows[0].map(h => String(h).trim());

  const bookings = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const booking = {};
    headers.forEach((header, idx) => {
      booking[header] = row[idx] !== undefined ? String(row[idx]) : '';
    });
    bookings.push(booking);
  }

  // ── Fill in missing values for older bookings ───────
  const pricingMap = getPricingMap();
  const defaultPrice = getDefaultPrice();
  const gstRate = getGstRate();
  const slotDuration = getSlotDurationHours();

  for (const booking of bookings) {
    // payment_mode / payment_status fallback
    if (!booking.payment_mode) booking.payment_mode = 'Pay at Venue';
    const pm = (booking.payment_mode || '').toLowerCase();
    if (!booking.payment_status) {
      booking.payment_status = pm === 'online' ? 'Paid' : 'Pay at Venue';
    }

    // total_amount and pricing fallback
    const rawAmount = booking.total_amount;
    let hasValidAmount = false;
    if (rawAmount) {
      const trimmed = String(rawAmount).trim();
      if (trimmed && parseInt(trimmed) > 0) hasValidAmount = true;
    }
    if (hasValidAmount) continue;

    const sportKey = (booking.service_type || '').toLowerCase();
    const ratePerHour = pricingMap[sportKey] || defaultPrice;

    const startTime = booking.preferred_time || booking.start_time || '';
    const endTime = booking.end_time || '';

    let duration = slotDuration;
    if (startTime && endTime) {
      const [sh, sm] = startTime.split(':').map(Number);
      const [eh, em] = endTime.split(':').map(Number);
      if (!isNaN(sh) && !isNaN(sm) && !isNaN(eh) && !isNaN(em)) {
        duration = Math.max((eh + em / 60) - (sh + sm / 60), 0.5);
      }
    }

    const baseAmount = Math.round(ratePerHour * duration);
    const gstAmount = Math.round(baseAmount * gstRate);
    const totalAmount = baseAmount + gstAmount;

    booking.total_amount = String(totalAmount);
    booking.rate_per_hour = ratePerHour;
    booking.duration = duration;
    booking.base_amount = baseAmount;
    booking.gst_amount = gstAmount;
  }

  return bookings;
}

async function appendBooking(booking) {
  const sid = getSpreadsheetId();
  const service = await getSheetsService();

  const row = [
    booking.booking_id || '',
    booking.client_name || '',
    booking.client_email || '',
    booking.client_phone || '',
    booking.service_type || '',
    booking.preferred_date || '',
    booking.preferred_time || '',
    booking.message || '',
    booking.status || 'CONFIRMED',
    booking.created_at || '',
    booking.end_time || '',
    booking.venue_name || '',
    booking.payment_mode || '',
    String(booking.total_amount || ''),
  ];

  await service.spreadsheets.values.append({
    spreadsheetId: sid,
    range: 'A:N',
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] },
  });

  return true;
}

async function getBookingsByDate(targetDate) {
  const all = await getAllBookings();
  return all.filter(b =>
    b.preferred_date === targetDate && b.status !== 'CANCELLED'
  );
}

async function updateBookingStatus(bookingId, newStatus) {
  const sid = getSpreadsheetId();
  const service = await getSheetsService();

  const result = await service.spreadsheets.values.get({
    spreadsheetId: sid,
    range: 'A:Z',
  });

  const rows = result.data.values || [];
  if (rows.length < 2) return false;

  const headers = rows[0].map(h => String(h).trim());
  const statusCol = headers.indexOf('status');
  const idCol = headers.indexOf('booking_id');

  if (statusCol === -1 || idCol === -1) return false;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row[idCol] === bookingId) {
      const colLetter = String.fromCharCode(65 + statusCol);
      await service.spreadsheets.values.update({
        spreadsheetId: sid,
        range: `${colLetter}${i + 1}`,
        valueInputOption: 'RAW',
        requestBody: { values: [[newStatus]] },
      });
      return true;
    }
  }

  return false;
}

module.exports = {
  ensureHeaders,
  getAllBookings,
  appendBooking,
  getBookingsByDate,
  updateBookingStatus,
  getPricingMap,
  getDefaultPrice,
  getGstRate,
  getSlotDurationHours,
};
