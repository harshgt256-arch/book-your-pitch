/**
 * Pricing service — calculates booking cost based on sport type and duration.
 * Ported from booking-api/workflow.py (calculate_price function)
 */

const { getPricingMap, getDefaultPrice, getGstRate, getSlotDurationHours } = require('./sheets');

/**
 * Calculate pricing for a booking.
 * Returns the booking object with pricing fields filled in.
 */
function calculatePrice(booking) {
  const pricingMap = getPricingMap();
  const defaultPrice = getDefaultPrice();
  const gstRate = getGstRate();
  const slotDuration = getSlotDurationHours();

  const sportKey = (booking.service_type || '').toLowerCase();
  const ratePerHour = pricingMap[sportKey] || defaultPrice;

  let duration = slotDuration;
  let endTime = booking.end_time || '';

  try {
    const [sh, sm] = (booking.preferred_time || '10:00').split(':').map(Number);

    if (endTime) {
      const [eh, em] = endTime.split(':').map(Number);
      duration = Math.max((eh + em / 60) - (sh + sm / 60), 0.5);
    } else {
      const totalMinutes = sh * 60 + sm + slotDuration * 60;
      const eh = Math.floor(totalMinutes / 60);
      const em = Math.round(totalMinutes % 60);
      endTime = `${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}`;
      duration = slotDuration;
    }
  } catch (err) {
    console.warn('Pricing calculation error:', err.message);
    duration = slotDuration;
    endTime = '';
  }

  const baseAmount = Math.round(ratePerHour * duration);
  const gstAmount = Math.round(baseAmount * gstRate);
  const totalAmount = baseAmount + gstAmount;

  booking.rate_per_hour = ratePerHour;
  booking.duration = duration;
  booking.base_amount = baseAmount;
  booking.gst_amount = gstAmount;
  booking.total_amount = totalAmount;
  booking.end_time = endTime;
  booking.payment_status =
    (booking.payment_mode || '').toLowerCase() === 'online' ? 'Paid' : 'Pay at Venue';

  return booking;
}

module.exports = { calculatePrice };
