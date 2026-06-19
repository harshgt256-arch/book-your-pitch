"""Email service — sends HTML email confirmations using Gmail SMTP."""

import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

from config import settings


def _build_confirmation_html(booking: dict) -> str:
    """Build the HTML email body for a booking confirmation."""
    name = booking.get("client_name", "")
    booking_id = booking.get("booking_id", "")
    service = booking.get("service_type", "")
    date = booking.get("preferred_date", "")
    time = booking.get("preferred_time", booking.get("start_time", ""))
    created_at = booking.get("created_at", "")

    return f"""
    <div style="font-family:Arial,sans-serif;max-width:500px;margin:auto;padding:24px;border:1px solid #e0e0e0;border-radius:8px">
      <h2 style="color:#0ea5e9">✅ Booking Confirmed!</h2>
      <p>Hi <strong>{name}</strong>,</p>
      <p>Your appointment has been successfully scheduled.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0">
        <tr style="background:#f5f5f5">
          <th style="padding:8px;text-align:left;border:1px solid #ddd">Booking ID</th>
          <td style="padding:8px;border:1px solid #ddd"><strong>{booking_id}</strong></td>
        </tr>
        <tr>
          <th style="padding:8px;text-align:left;border:1px solid #ddd">Service</th>
          <td style="padding:8px;border:1px solid #ddd">{service}</td>
        </tr>
        <tr style="background:#f5f5f5">
          <th style="padding:8px;text-align:left;border:1px solid #ddd">Date</th>
          <td style="padding:8px;border:1px solid #ddd">{date}</td>
        </tr>
        <tr>
          <th style="padding:8px;text-align:left;border:1px solid #ddd">Time</th>
          <td style="padding:8px;border:1px solid #ddd">{time}</td>
        </tr>
      </table>
      <p>📅 A <strong>Google Calendar invite</strong> has been sent to this email.</p>
      <p>Need to reschedule? Simply reply to this email.</p>
      <hr style="border:none;border-top:1px solid #eee;margin:20px 0">
      <p style="font-size:12px;color:#888">Booking ID: {booking_id} | Booked: {created_at}</p>
      <p style="font-size:11px;color:#aaa"><em>Powered by Book Your Pitch</em></p>
    </div>
    """


def send_confirmation_email(booking: dict) -> bool:
    """Send an HTML confirmation email to the client.

    Args:
        booking: The booking record dict

    Returns:
        True if sent successfully, False otherwise.
    """
    to_email = booking.get("client_email", "")
    if not to_email:
        print("⚠️ No email address provided — skipping email confirmation")
        return False

    if not settings.smtp_username or not settings.smtp_password:
        print("⚠️ SMTP credentials not configured — skipping email")
        return False

    msg = MIMEMultipart("alternative")
    msg["Subject"] = (
        f"✅ Booking Confirmed — {booking.get('service_type', 'Booking')} "
        f"on {booking.get('preferred_date', '')}"
    )
    msg["From"] = f"{settings.smtp_from_name} <{settings.smtp_username}>"
    msg["To"] = to_email

    html = _build_confirmation_html(booking)
    msg.attach(MIMEText(html, "html"))

    try:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port) as server:
            server.starttls()
            server.login(settings.smtp_username, settings.smtp_password)
            server.send_message(msg)
        print(f"✅ Email sent to {to_email}")
        return True
    except smtplib.SMTPAuthenticationError:
        print(
            "❌ Gmail SMTP auth failed. Make sure you're using an App Password "
            "(not your regular password) and 2FA is enabled."
        )
        return False
    except smtplib.SMTPException as e:
        print(f"❌ Email send failed: {e}")
        return False
    except Exception as e:
        print(f"❌ Email error: {e}")
        return False
