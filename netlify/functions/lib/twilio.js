/**
 * Twilio WhatsApp service — sends booking confirmations and reminders.
 * Ported from booking-api/services/twilio_whatsapp.py
 */

const twilio = require('twilio');

function getClient() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) {
    console.log('⚠️ Twilio credentials not configured — skipping WhatsApp');
    return null;
  }
  return twilio(sid, token);
}

/**
 * Sanitize phone: remove spaces, dashes, brackets — keep only digits and +
 */
function sanitizePhone(phone) {
  return String(phone).replace(/[^\d+]/g, '');
}

/**
 * Send a WhatsApp message to a phone number.
 */
async function sendWhatsapp(toPhone, messageBody) {
  const client = getClient();
  if (!client) return false;

  const cleanPhone = sanitizePhone(toPhone);
  const fromWhatsapp = `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER || '+14155238886'}`;
  const toWhatsapp = `whatsapp:${cleanPhone}`;

  try {
    const message = await client.messages.create({
      from: fromWhatsapp,
      to: toWhatsapp,
      body: messageBody,
    });
    console.log(`✅ WhatsApp sent: ${message.sid}`);
    return true;
  } catch (err) {
    console.error(`❌ WhatsApp send failed: ${err.message}`);
    return false;
  }
}

/**
 * Send a booking confirmation WhatsApp message.
 */
async function sendBookingConfirmation(booking) {
  const name = booking.client_name || 'Valued Customer';
  const bookingId = booking.booking_id || 'N/A';
  const service = booking.service_type || 'Booking';
  const date = booking.preferred_date || 'N/A';
  const time = booking.preferred_time || booking.start_time || 'N/A';
  const phone = booking.client_phone || '';

  if (!phone) {
    console.log('⚠️ No phone number provided — cannot send WhatsApp');
    return false;
  }

  const message =
    `🎉 *Booking Confirmed!*\n\n` +
    `Hello *${name}*,\n\n` +
    `Your appointment has been successfully confirmed.\n\n` +
    `📋 *Booking Details*\n` +
    `• Booking ID: ${bookingId}\n` +
    `• Service: ${service}\n` +
    `• Date: ${date}\n` +
    `• Time: ${time}\n\n` +
    `We look forward to serving you.\n\n` +
    `If you need to reschedule, simply reply to this message.\n\n` +
    `Thank you,`;

  return sendWhatsapp(phone, message);
}

/**
 * Send a reminder WhatsApp for tomorrow's booking.
 */
async function sendReminder(booking) {
  const name = booking.client_name || 'Valued Customer';
  const bookingId = booking.booking_id || 'N/A';
  const service = booking.service_type || 'Booking';
  const date = booking.preferred_date || 'N/A';
  const time = booking.preferred_time || booking.start_time || 'N/A';
  const phone = booking.client_phone || '';

  if (!phone) return false;

  const message =
    `Hello ${name}! 👋\n\n` +
    `This is a reminder for your upcoming appointment:\n\n` +
    `📋 *Service:* ${service}\n` +
    `📅 *Date:* ${date}\n` +
    `⏰ *Time:* ${time}\n` +
    `🔖 *Booking ID:* ${bookingId}\n\n` +
    `Please be available at the scheduled time.\n\n` +
    `Thank you for choosing us! 🙏`;

  return sendWhatsapp(phone, message);
}

/**
 * Notify client that their slot is taken and suggest alternatives.
 */
async function sendAlternativeSlots(booking, alternatives) {
  const name = booking.client_name || 'Valued Customer';
  const date = booking.preferred_date || 'N/A';
  const time = booking.preferred_time || 'N/A';
  const phone = booking.client_phone || '';

  if (!phone) return false;

  let altText;
  if (alternatives && alternatives.length > 0) {
    altText = alternatives.map(a => `  • ${a.start_time} - ${a.end_time}`).join('\n');
  } else {
    altText = '  No alternatives available right now.';
  }

  const message =
    `Hi ${name},\n\n` +
    `Sorry, the ${time} slot on ${date} is already booked.\n\n` +
    `*Available alternatives:*\n` +
    `${altText}\n\n` +
    `Reply with your preferred time or call us to rebook.\n\n` +
    `Thank you for your understanding!`;

  return sendWhatsapp(phone, message);
}

module.exports = {
  sendWhatsapp,
  sendBookingConfirmation,
  sendReminder,
  sendAlternativeSlots,
};
