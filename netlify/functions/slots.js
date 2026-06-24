/**
 * Available slots endpoint — GET /api/slots?date=YYYY-MM-DD&venue=xxx&sport=xxx
 * Returns all time slots for a given date/venue/sport, marked as available or booked.
 * Used by the frontend slot picker to show available times visually.
 */

const { getAllBookings, ensureHeaders, getSlotDurationHours } = require('./lib/sheets');

function parseTimeToMinutes(timeStr) {
  if (!timeStr) return -1;
  try {
    const [h, m] = timeStr.split(':').map(Number);
    if (isNaN(h) || isNaN(m)) return -1;
    return h * 60 + m;
  } catch {
    return -1;
  }
}

function formatMinutes(mins) {
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function slotsOverlap(s1, e1, s2, e2) {
  return (
    (s1 >= s2 && s1 < e2) ||
    (e1 > s2 && e1 <= e2) ||
    (s1 <= s2 && e1 >= e2)
  );
}

/**
 * Generate all possible time slots for a day, then check each against existing bookings.
 */
async function getAvailableSlots(date, venue, sport) {
  if (!date || !venue || !sport) {
    return { error: 'Missing required params: date, venue, sport' };
  }

  // Business hours from env vars (default 9 AM - 7 PM)
  const businessStart = parseInt(process.env.BUSINESS_START_HOUR || '9');
  const businessEnd = parseInt(process.env.BUSINESS_END_HOUR || '19');
  const slotDuration = getSlotDurationHours() || 1;

  const startMinutes = businessStart * 60;
  const endMinutes = businessEnd * 60;
  const slotSize = Math.round(slotDuration * 60); // slot duration in minutes

  // Generate all candidate slots
  const allSlots = [];
  for (let m = startMinutes; m + slotSize <= endMinutes; m += slotSize) {
    allSlots.push({
      start_minutes: m,
      end_minutes: m + slotSize,
      start_time: formatMinutes(m),
      end_time: formatMinutes(m + slotSize),
    });
  }

  // Fetch existing bookings for conflict detection
  let existingBookings = [];
  try {
    await ensureHeaders().catch(() => {});
    existingBookings = await getAllBookings();
  } catch (err) {
    console.log(`⚠️ Could not fetch bookings — all slots shown as available: ${err.message}`);
    return {
      slots: allSlots.map(s => ({
        start_time: s.start_time,
        end_time: s.end_time,
        available: true,
      })),
    };
  }

  // Filter bookings to only those on the same date, venue, and sport
  const relevantBookings = existingBookings.filter(b =>
    b.preferred_date === date &&
    b.venue_name &&
    b.venue_name.toLowerCase() === venue.toLowerCase() &&
    b.service_type === sport &&
    b.status !== 'CANCELLED'
  );

  // Check each slot for conflicts
  const resultSlots = allSlots.map(slot => {
    let conflict = false;

    for (const booking of relevantBookings) {
      const bStart = parseTimeToMinutes(booking.preferred_time || booking.start_time);
      if (bStart < 0) continue;

      let bEnd;
      if (booking.end_time) {
        bEnd = parseTimeToMinutes(booking.end_time);
      } else {
        bEnd = bStart + slotSize;
      }
      if (bEnd < 0) continue;

      if (slotsOverlap(slot.start_minutes, slot.end_minutes, bStart, bEnd)) {
        conflict = true;
        break;
      }
    }

    return {
      start_time: slot.start_time,
      end_time: slot.end_time,
      available: !conflict,
    };
  });

  // Also calculate what % is booked
  const bookedCount = resultSlots.filter(s => !s.available).length;

  return {
    slots: resultSlots,
    summary: {
      total_slots: resultSlots.length,
      booked: bookedCount,
      available: resultSlots.length - bookedCount,
      date,
      venue,
      sport,
    },
  };
}

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  };

  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ success: false, message: 'Use GET' }),
    };
  }

  const { date, venue, sport } = event.queryStringParameters || {};

  if (!date || !venue || !sport) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({
        success: false,
        message: 'Missing required params: date, venue, sport',
      }),
    };
  }

  try {
    const result = await getAvailableSlots(date, venue, sport);

    if (result.error) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, message: result.error }),
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, ...result }),
    };
  } catch (err) {
    console.error(`❌ Slots endpoint error: ${err.message}`);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, message: err.message }),
    };
  }
};
