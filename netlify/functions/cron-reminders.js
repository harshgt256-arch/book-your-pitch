/**
 * Cron reminders endpoint — GET /api/cron/reminders
 * Call this daily via cron-job.org or GitHub Actions to send WhatsApp reminders.
 * Checks for tomorrow's bookings and sends reminders.
 */

const { getBookingsByDate, ensureHeaders } = require('./lib/sheets');
const { sendReminder } = require('./lib/twilio');

exports.handler = async () => {
  try {
    await ensureHeaders().catch(() => {});

    // Calculate tomorrow's date in IST
    const now = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000;
    const istNow = new Date(now.getTime() + istOffset);
    const tomorrow = new Date(istNow);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const targetDate = tomorrow.toISOString().split('T')[0];

    console.log(`⏰ Running reminder check for ${targetDate}...`);

    const bookings = await getBookingsByDate(targetDate);

    if (!bookings || bookings.length === 0) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ success: true, sent: 0, total: 0, message: `No bookings found for ${targetDate}` }),
      };
    }

    let sent = 0;
    for (const booking of bookings) {
      if (await sendReminder(booking)) {
        sent++;
      }
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        success: true,
        sent,
        total: bookings.length,
        date: targetDate,
        message: `Sent ${sent}/${bookings.length} reminders for ${targetDate}`,
      }),
    };
  } catch (err) {
    console.error(`❌ Cron reminders error: ${err.message}`);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ success: false, message: err.message }),
    };
  }
};
