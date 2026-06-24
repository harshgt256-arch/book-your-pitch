/**
 * Calendar cleanup endpoint — POST /api/cleanup/calendar
 * Deletes calendar events that are in the past, keeping the Google Sheet records intact.
 * Call this to clean up old test bookings from the Calendar without losing data.
 */

const { listCalendarEvents, deleteCalendarEvent } = require('./lib/calendar');

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  };

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ success: false, message: 'Use POST' }),
    };
  }

  try {
    if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
      return {
        statusCode: 503,
        headers,
        body: JSON.stringify({
          success: false,
          message: 'GOOGLE_SERVICE_ACCOUNT_JSON not configured',
        }),
      };
    }

    // Calculate the current time in IST for filtering past events
    const now = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000;
    const istNow = new Date(now.getTime() + istOffset);

    // List all events up to now (past events)
    const events = await listCalendarEvents({
      timeMax: istNow.toISOString(),
    });

    // Filter events that look like they were created by our booking system
    // Our events have title format: "{Sport} — {Customer Name}"
    const bookingEvents = events.filter(e =>
      e.summary && e.summary.includes(' — ')
    );

    console.log(`📋 Found ${bookingEvents.length} booking events to potentially clean up`);

    let deleted = 0;
    const errors = [];

    for (const event of bookingEvents) {
      // Double-check it's really in the past by end time
      const eventEnd = event.end?.dateTime || event.end?.date;
      if (!eventEnd) continue;

      const eventEndTime = new Date(eventEnd);
      if (eventEndTime <= istNow) {
        const ok = await deleteCalendarEvent(event.id);
        if (ok) {
          deleted++;
        } else {
          errors.push(event.id);
        }
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        deleted,
        total_found: bookingEvents.length,
        errors: errors.length > 0 ? errors : undefined,
        message: `Deleted ${deleted} past booking event${deleted !== 1 ? 's' : ''} from the calendar.`,
      }),
    };
  } catch (err) {
    console.error(`❌ Calendar cleanup error: ${err.message}`);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, message: err.message }),
    };
  }
};
