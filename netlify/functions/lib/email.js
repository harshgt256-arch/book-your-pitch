/**
 * Email service — sends HTML email confirmations via SMTP (nodemailer).
 * Ported from booking-api/services/email_service.py
 */

const nodemailer = require('nodemailer');

function getTransporter() {
  const user = process.env.SMTP_USERNAME;
  const pass = process.env.SMTP_PASSWORD;
  if (!user || !pass) {
    console.log('⚠️ SMTP credentials not configured — skipping email');
    return null;
  }

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: false,
    auth: { user, pass },
  });
}

function getFromName() {
  return process.env.SMTP_FROM_NAME || 'Book Your Pitch';
}

/**
 * Build the HTML email body for a booking confirmation.
 */
function buildConfirmationHtml(booking) {
  const name = booking.client_name || '';
  const bookingId = booking.booking_id || '';
  const service = booking.service_type || '';
  const date = booking.preferred_date || '';
  const time = booking.preferred_time || booking.start_time || '';
  const created_at = booking.created_at || '';

  return `
    <div style="font-family:Arial,sans-serif;max-width:500px;margin:auto;padding:24px;border:1px solid #e0e0e0;border-radius:8px">
      <h2 style="color:#0ea5e9">✅ Booking Confirmed!</h2>
      <p>Hi <strong>${escapeHtml(name)}</strong>,</p>
      <p>Your appointment has been successfully scheduled.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0">
        <tr style="background:#f5f5f5">
          <th style="padding:8px;text-align:left;border:1px solid #ddd">Booking ID</th>
          <td style="padding:8px;border:1px solid #ddd"><strong>${escapeHtml(bookingId)}</strong></td>
        </tr>
        <tr>
          <th style="padding:8px;text-align:left;border:1px solid #ddd">Service</th>
          <td style="padding:8px;border:1px solid #ddd">${escapeHtml(service)}</td>
        </tr>
        <tr style="background:#f5f5f5">
          <th style="padding:8px;text-align:left;border:1px solid #ddd">Date</th>
          <td style="padding:8px;border:1px solid #ddd">${escapeHtml(date)}</td>
        </tr>
        <tr>
          <th style="padding:8px;text-align:left;border:1px solid #ddd">Time</th>
          <td style="padding:8px;border:1px solid #ddd">${escapeHtml(time)}</td>
        </tr>
      </table>
      <p>📅 A <strong>Google Calendar invite</strong> has been sent to this email.</p>
      <p>Need to reschedule? Simply reply to this email.</p>
      <hr style="border:none;border-top:1px solid #eee;margin:20px 0">
      <p style="font-size:12px;color:#888">Booking ID: ${escapeHtml(bookingId)} | Booked: ${escapeHtml(created_at)}</p>
      <p style="font-size:11px;color:#aaa"><em>Powered by Book Your Pitch</em></p>
    </div>
  `;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Send an HTML confirmation email to the client.
 */
async function sendConfirmationEmail(booking) {
  const toEmail = booking.client_email || '';
  if (!toEmail) {
    console.log('⚠️ No email address provided — skipping email confirmation');
    return false;
  }

  const transporter = getTransporter();
  if (!transporter) return false;

  const fromName = getFromName();
  const fromUser = process.env.SMTP_USERNAME;

  const html = buildConfirmationHtml(booking);

  try {
    await transporter.sendMail({
      from: `"${fromName}" <${fromUser}>`,
      to: toEmail,
      subject: `✅ Booking Confirmed — ${booking.service_type || 'Booking'} on ${booking.preferred_date || ''}`,
      html,
    });
    console.log(`✅ Email sent to ${toEmail}`);
    return true;
  } catch (err) {
    console.error(`❌ Email send failed: ${err.message}`);
    return false;
  }
}

module.exports = { sendConfirmationEmail };
