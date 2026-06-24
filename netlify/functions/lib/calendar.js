/**
 * Google Calendar service — creates calendar events for confirmed bookings.
 * Ported from booking-api/services/calendar.py
 */

const { GoogleAuth } = require('google-auth-library');
const { calendar: calendarFactory } = require('@googleapis/calendar');

function getAuth() {
  const jsonStr = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!jsonStr) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON not set');
  }
  const credentials = JSON.parse(jsonStr);
  return new GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/calendar'],
  });
}

/** @type {import('@googleapis/calendar').calendar_v3.Calendar | null} */
let _calendarClient = null;

async function getCalendarService() {
  if (_calendarClient) return _calendarClient;
  const auth = getAuth();
  _calendarClient = calendarFactory({ version: 'v3', auth });
  return _calendarClient;
}

function getSlotDurationHours() {
  return parseFloat(process.env.SLOT_DURATION_HOURS || '1');
}

/**
 * Check if the booking is for a past date — skip Calendar event if so.
 */
function isPastBooking(preferredDate) {
  if (!preferredDate) return false;
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istNow = new Date(now.getTime() + istOffset);
  const todayStr = istNow.toISOString().split('T')[0];
  return preferredDate < todayStr;
}

/**
 * Create a Google Calendar event for a confirmed booking.
 * Returns the created event object, or null on failure.
 */
async function createBookingEvent(booking) {
  // Only create Calendar events for future or today's bookings
  if (isPastBooking(booking.preferred_date)) {
    console.log(`⏭️ Skipping Calendar event for past booking ${booking.booking_id} (${booking.preferred_date})`);
    return null;
  }

  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    console.log('⚠️ GOOGLE_SERVICE_ACCOUNT_JSON not set — skipping calendar event');
    return null;
  }

  const service = await getCalendarService();
  const calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';

  const preferredDate = booking.preferred_date || '';
  const startTime = booking.preferred_time || booking.start_time || '10:00';

  // Use end_time from booking if provided, otherwise calculate
  let endTime;
  if (booking.end_time) {
    endTime = booking.end_time;
  } else {
    const [sh, sm] = startTime.split(':').map(Number);
    const durationH = getSlotDurationHours();
    let eh = sh + Math.floor(durationH);
    let em = sm + Math.round((durationH % 1) * 60);
    if (eh >= 24) { eh = 23; em = 59; }
    endTime = `${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}`;
  }

  // Format as ISO 8601 with IST offset
  const startIso = `${preferredDate}T${startTime}:00+05:30`;
  const endIso = `${preferredDate}T${endTime}:00+05:30`;

  // Build description
  const descriptionParts = [
    `Booking ID: ${booking.booking_id || 'N/A'}`,
    `Customer: ${booking.client_name || 'N/A'}`,
    `Phone: ${booking.client_phone || 'N/A'}`,
    `Email: ${booking.client_email || 'N/A'}`,
    `Service: ${booking.service_type || 'N/A'}`,
    `Venue: ${booking.venue_name || 'N/A'}`,
    `Payment: ${booking.payment_status || 'N/A'}`,
    `Amount: ₹${booking.total_amount || 'N/A'}`,
    `Message: ${booking.message || 'N/A'}`,
  ];

  const event = {
    summary: `${booking.service_type || 'Booking'} — ${booking.client_name || ''}`,
    description: descriptionParts.join('\n'),
    start: {
      dateTime: startIso,
      timeZone: 'Asia/Kolkata',
    },
    end: {
      dateTime: endIso,
      timeZone: 'Asia/Kolkata',
    },
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'email', minutes: 60 },
        { method: 'popup', minutes: 30 },
      ],
    },
  };

  try {
    const created = await service.events.insert({
      calendarId,
      requestBody: event,
      sendUpdates: 'none',
    });
    console.log(`✅ Calendar event created: ${created.data.htmlLink || created.data.id || ''}`);
    return created.data;
  } catch (err) {
    console.error(`❌ Calendar event creation failed: ${err.message}`);
    return null;
  }
}

/**
 * List calendar events from a date range.
 * Returns events created by our service account or matching our naming pattern.
 */
async function listCalendarEvents(options = {}) {
  const {
    calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary',
    timeMin = null,
    timeMax = null,
  } = options;

  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    console.log('⚠️ GOOGLE_SERVICE_ACCOUNT_JSON not set — cannot list calendar events');
    return [];
  }

  const service = await getCalendarService();

  const params = {
    calendarId,
    singleEvents: true,
    orderBy: 'startTime',
  };
  if (timeMin) params.timeMin = timeMin;
  if (timeMax) params.timeMax = timeMax;

  try {
    const response = await service.events.list(params);
    const events = response.data.items || [];
    console.log(`📅 Found ${events.length} events in calendar`);
    return events;
  } catch (err) {
    console.error(`❌ Failed to list calendar events: ${err.message}`);
    return [];
  }
}

/**
 * Delete a calendar event by its ID.
 */
async function deleteCalendarEvent(eventId, calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary') {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) return false;

  const service = await getCalendarService();

  try {
    await service.events.delete({ calendarId, eventId });
    console.log(`🗑️ Deleted calendar event: ${eventId}`);
    return true;
  } catch (err) {
    console.error(`❌ Failed to delete calendar event ${eventId}: ${err.message}`);
    return false;
  }
}

module.exports = { createBookingEvent, listCalendarEvents, deleteCalendarEvent };
