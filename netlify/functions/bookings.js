/**
 * Bookings handler — /api/bookings
 * GET  → List all bookings
 * POST → Create a new booking (full workflow pipeline)
 */

const { getAllBookings, appendBooking, ensureHeaders } = require('./lib/sheets');
const { createBookingEvent } = require('./lib/calendar');
const { sendBookingConfirmation, sendAlternativeSlots } = require('./lib/twilio');
const { sendConfirmationEmail } = require('./lib/email');
const { calculatePrice } = require('./lib/pricing');
const { checkAvailability } = require('./lib/availability');

// ── Helpers ─────────────────────────────────────────────────

function generateBookingId() {
  return `BK${Date.now()}`;
}

function parseBody(body) {
  const data = typeof body === 'string' ? JSON.parse(body) : body;
  return {
    booking_id: generateBookingId(),
    client_name: (data.name || '').trim(),
    client_email: (data.email || '').trim(),
    client_phone: (data.phone || '').trim(),
    service_type: (data.service_type || '').trim(),
    preferred_date: (data.preferred_date || '').trim(),
    preferred_time: (data.preferred_time || '').trim(),
    end_time: (data.end_time || '').trim(),
    venue_name: (data.venue_name || '').trim(),
    payment_mode: (
      data.payment_mode === 'Online' || data.payment_mode === 'Pay at Venue'
    ) ? data.payment_mode : 'Online',
    message: (data.message || '').trim(),
    status: 'CONFIRMED',
    created_at: new Date().toISOString(),
    name: (data.name || '').trim(),
  };
}

function validateBooking(booking) {
  const errors = [];
  if (!booking.client_name) errors.push('Customer name is required');
  if (!booking.preferred_date) errors.push('Preferred date is required');
  if (!booking.preferred_time) errors.push('Preferred time is required');
  if (!booking.service_type) errors.push('Service type is required');

  if (booking.preferred_time) {
    const match = /^([0-1]\d|2[0-3]):([0-5]\d)$/.test(booking.preferred_time);
    if (!match) errors.push('Invalid time format (use HH:MM)');
  }
  if (booking.preferred_date) {
    const match = /^\d{4}-\d{2}-\d{2}$/.test(booking.preferred_date);
    if (!match) errors.push('Invalid date format (use YYYY-MM-DD)');
  }
  if (booking.preferred_time && booking.end_time) {
    const [sh, sm] = booking.preferred_time.split(':').map(Number);
    const [eh, em] = booking.end_time.split(':').map(Number);
    if (eh * 60 + em <= sh * 60 + sm) {
      errors.push('End time must be after start time');
    }
  }

  return errors;
}

// ── GET /api/bookings — List all bookings ────────────────────

async function handleList() {
  try {
    await ensureHeaders().catch(() => {});
    const bookings = await getAllBookings();
    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, count: bookings.length, bookings }),
    };
  } catch (err) {
    console.error('List bookings error:', err.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, message: err.message || 'Failed to fetch bookings' }),
    };
  }
}

// ── POST /api/bookings — Create booking (full pipeline) ─────

async function handleCreate(rawBody) {
  if (!process.env.GOOGLE_SHEETS_SPREADSHEET_ID) {
    return {
      statusCode: 503,
      body: JSON.stringify({
        success: false,
        message: 'Server not configured: GOOGLE_SHEETS_SPREADSHEET_ID is missing',
      }),
    };
  }

  let booking;
  try {
    booking = parseBody(rawBody);
  } catch (err) {
    return {
      statusCode: 400,
      body: JSON.stringify({ success: false, message: `Invalid request body: ${err.message}` }),
    };
  }

  // ── Validate ──
  const errors = validateBooking(booking);
  if (errors.length > 0) {
    return {
      statusCode: 200,
      body: JSON.stringify({
        success: false,
        message: `Validation failed: ${errors.join(', ')}`,
        booking: { ...booking, status: 'REJECTED' },
      }),
    };
  }

  // ── Check availability ──
  await ensureHeaders().catch(() => {});
  const slotCheck = await checkAvailability(booking);

  if (!slotCheck.available) {
    try { await sendAlternativeSlots(booking, slotCheck.alternative_slots); } catch (e) {
      console.error(`❌ Alternative slots WhatsApp failed: ${e.message}`);
    }
    return {
      statusCode: 200,
      body: JSON.stringify({
        success: false,
        message: `Slot not available. ${slotCheck.alternative_slots.length} alternative(s) suggested.`,
        booking: { ...booking, is_conflict: true, available: false, conflict_with: slotCheck.conflict_with, alternative_slots: slotCheck.alternative_slots },
      }),
    };
  }

  // ── Calculate price ──
  calculatePrice(booking);

  // ── Store in Google Sheets ──
  try { await appendBooking(booking); console.log(`✅ Booking saved: ${booking.booking_id}`); } catch (e) {
    console.error(`❌ Sheets save failed: ${e.message}`);
  }

  // ── Calendar + WhatsApp + Email ──
  await Promise.allSettled([
    createBookingEvent(booking),
    sendBookingConfirmation(booking),
    sendConfirmationEmail(booking),
  ]);

  return {
    statusCode: 200,
    body: JSON.stringify({
      success: true,
      booking_id: booking.booking_id,
      message: 'Booking confirmed! Check your WhatsApp and email for details.',
      booking,
    }),
  };
}

// ── Handler ──────────────────────────────────────────────────

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  };

  let result;
  switch (event.httpMethod) {
    case 'GET':
      result = await handleList();
      break;
    case 'POST':
      result = await handleCreate(event.body);
      break;
    case 'OPTIONS':
      result = { statusCode: 204, body: '' };
      break;
    default:
      result = {
        statusCode: 405,
        body: JSON.stringify({ success: false, message: `Method ${event.httpMethod} not allowed` }),
      };
  }

  return { ...result, headers };
};
