/**
 * Availability service — checks slot conflicts and generates alternatives.
 * Ported from booking-api/workflow.py (check_availability function)
 */

const { getAllBookings, getSlotDurationHours } = require('./sheets');

/**
 * Convert HH:MM to minutes since midnight.
 */
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

/**
 * Get the end time in minutes for an existing booking.
 * Tries end_time first, falls back to start + slot_duration_hours.
 */
function getExistingEndMinutes(existing) {
  if (existing.end_time) {
    const mins = parseTimeToMinutes(existing.end_time);
    if (mins > 0) return mins;
  }
  const existingTime = existing.preferred_time || existing.start_time;
  const mins = parseTimeToMinutes(existingTime);
  if (mins < 0) return -1;
  return mins + Math.round(getSlotDurationHours() * 60);
}

/**
 * Check if two time ranges overlap.
 */
function slotsOverlap(newStart, newEnd, existingStart, existingEnd) {
  return (
    (newStart >= existingStart && newStart < existingEnd) ||
    (newEnd > existingStart && newEnd <= existingEnd) ||
    (newStart <= existingStart && newEnd >= existingEnd)
  );
}

/**
 * Check if an existing booking matches the given date and service.
 */
function bookingMatchesDateService(existing, date, service) {
  return (
    existing.preferred_date === date &&
    existing.service_type === service &&
    existing.status !== 'CANCELLED'
  );
}

/**
 * Check if the requested slot conflicts with existing bookings.
 * Returns { available, alternative_slots, conflict_with }
 */
async function checkAvailability(booking) {
  const slotDuration = getSlotDurationHours();

  let existingBookings;
  try {
    existingBookings = await getAllBookings();
  } catch (err) {
    console.log(`⚠️ Could not fetch existing bookings — assuming available: ${err.message}`);
    return { available: true, alternative_slots: [], conflict_with: null };
  }

  if (!existingBookings || existingBookings.length === 0) {
    return { available: true, alternative_slots: [], conflict_with: null };
  }

  const newDate = booking.preferred_date;
  const newService = booking.service_type;

  const startMinutes = parseTimeToMinutes(booking.preferred_time);
  if (startMinutes < 0) return { available: true, alternative_slots: [], conflict_with: null };

  let endMinutes;
  if (booking.end_time) {
    endMinutes = parseTimeToMinutes(booking.end_time);
    if (endMinutes < 0) endMinutes = startMinutes + Math.round(slotDuration * 60);
  } else {
    endMinutes = startMinutes + Math.round(slotDuration * 60);
  }

  let conflictFound = null;

  for (const existing of existingBookings) {
    if (!bookingMatchesDateService(existing, newDate, newService)) continue;

    const existingTime = existing.preferred_time || existing.start_time;
    const existingStart = parseTimeToMinutes(existingTime);
    if (existingStart < 0) continue;

    const existingEnd = getExistingEndMinutes(existing);
    if (existingEnd < 0) continue;

    if (slotsOverlap(startMinutes, endMinutes, existingStart, existingEnd)) {
      conflictFound = existing;
      break;
    }
  }

  if (!conflictFound) {
    return { available: true, alternative_slots: [], conflict_with: null };
  }

  // ── Generate alternatives ──────────────────────────
  const alternatives = [];
  const newDuration = endMinutes - startMinutes;
  const businessStart = parseInt(process.env.BUSINESS_START_HOUR || '9') * 60;
  const businessEnd = parseInt(process.env.BUSINESS_END_HOUR || '19') * 60;

  const offsets = [-120, -60, 60, 120]; // ±1h, ±2h

  for (const offset of offsets) {
    const altStart = startMinutes + offset;
    const altEnd = altStart + newDuration;

    if (altStart < businessStart || altEnd > businessEnd) continue;

    const altStartStr = `${String(Math.floor(altStart / 60)).padStart(2, '0')}:${String(altStart % 60).padStart(2, '0')}`;
    const altEndStr = `${String(Math.floor(altEnd / 60)).padStart(2, '0')}:${String(altEnd % 60).padStart(2, '0')}`;

    // Check if alternative conflicts with any existing booking
    let slotTaken = false;
    for (const existing of existingBookings) {
      if (!bookingMatchesDateService(existing, newDate, newService)) continue;

      const exTime = existing.preferred_time || existing.start_time;
      const exStart = parseTimeToMinutes(exTime);
      if (exStart < 0) continue;

      const exEnd = getExistingEndMinutes(existing);
      if (exEnd < 0) continue;

      if (slotsOverlap(altStart, altEnd, exStart, exEnd)) {
        slotTaken = true;
        break;
      }
    }

    if (!slotTaken) {
      alternatives.push({
        start_time: altStartStr,
        end_time: altEndStr,
        start_timestamp: `${newDate}T${altStartStr}:00+05:30`,
        end_timestamp: `${newDate}T${altEndStr}:00+05:30`,
      });
    }
  }

  return {
    available: false,
    alternative_slots: alternatives,
    conflict_with: {
      customer: conflictFound.client_name || 'Unknown',
      start: conflictFound.preferred_time || '',
      end: conflictFound.end_time || '',
    },
  };
}

module.exports = { checkAvailability };
