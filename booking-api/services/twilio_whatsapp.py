"""Twilio WhatsApp service — sends booking confirmations and reminders."""

import re

from twilio.rest import Client
from twilio.base.exceptions import TwilioRestException

from config import settings


def _get_client() -> Client | None:
    """Return a Twilio client if credentials are configured."""
    if not settings.twilio_account_sid or not settings.twilio_auth_token:
        print("⚠️ Twilio credentials not configured in .env — skipping WhatsApp")
        return None
    return Client(settings.twilio_account_sid, settings.twilio_auth_token)


def send_whatsapp(to_phone: str, message_body: str) -> bool:
    """Send a WhatsApp message to a phone number.

    Args:
        to_phone: Phone number (with country code, e.g. +919876543210)
        message_body: The message text to send

    Returns:
        True if sent successfully, False otherwise.
    """
    client = _get_client()
    if not client:
        return False

    # Sanitize phone: remove spaces, dashes, brackets etc. Keep only + and digits
    clean_phone = re.sub(r'[^\d+]', '', to_phone)
    
    # Format phone numbers
    from_whatsapp = f"whatsapp:{settings.twilio_whatsapp_number}"
    to_whatsapp = f"whatsapp:{clean_phone}"

    try:
        message = client.messages.create(
            from_=from_whatsapp,
            to=to_whatsapp,
            body=message_body,
        )
        print(f"✅ WhatsApp sent: {message.sid}")
        return True
    except TwilioRestException as e:
        print(f"❌ WhatsApp send failed: {e}")
        return False


def send_booking_confirmation(booking: dict) -> bool:
    """Send a booking confirmation WhatsApp message."""
    name = booking.get("client_name", "Valued Customer")
    booking_id = booking.get("booking_id", "N/A")
    service = booking.get("service_type", "Booking")
    date = booking.get("preferred_date", "N/A")
    time = booking.get("preferred_time", booking.get("start_time", "N/A"))
    phone = booking.get("client_phone", "")

    if not phone:
        print("⚠️ No phone number provided — cannot send WhatsApp")
        return False

    message = (
        f"🎉 *Booking Confirmed!*\n\n"
        f"Hello *{name}*,\n\n"
        f"Your appointment has been successfully confirmed.\n\n"
        f"📋 *Booking Details*\n"
        f"• Booking ID: {booking_id}\n"
        f"• Service: {service}\n"
        f"• Date: {date}\n"
        f"• Time: {time}\n\n"
        f"We look forward to serving you.\n\n"
        f"If you need to reschedule, simply reply to this message.\n\n"
        f"Thank you,"
    )

    return send_whatsapp(phone, message)


def send_reminder(booking: dict) -> bool:
    """Send a reminder WhatsApp for tomorrow's booking."""
    name = booking.get("client_name", "Valued Customer")
    booking_id = booking.get("booking_id", "N/A")
    service = booking.get("service_type", "Booking")
    date = booking.get("preferred_date", "N/A")
    time = booking.get("preferred_time", booking.get("start_time", "N/A"))
    phone = booking.get("client_phone", "")

    if not phone:
        return False

    message = (
        f"Hello {name}! 👋\n\n"
        f"This is a reminder for your upcoming appointment:\n\n"
        f"📋 *Service:* {service}\n"
        f"📅 *Date:* {date}\n"
        f"⏰ *Time:* {time}\n"
        f"🔖 *Booking ID:* {booking_id}\n\n"
        f"Please be available at the scheduled time.\n\n"
        f"Thank you for choosing us! 🙏"
    )

    return send_whatsapp(phone, message)


def send_alternative_slots(booking: dict, alternatives: list[dict]) -> bool:
    """Notify client that their slot is taken and suggest alternatives."""
    name = booking.get("client_name", "Valued Customer")
    date = booking.get("preferred_date", "N/A")
    time = booking.get("preferred_time", "N/A")
    phone = booking.get("client_phone", "")

    if not phone:
        return False

    alt_text = "\n".join(
        [f"  • {a.get('start_time', '?')} - {a.get('end_time', '?')}" for a in alternatives]
    ) if alternatives else "  No alternatives available right now."

    message = (
        f"Hi {name},\n\n"
        f"Sorry, the {time} slot on {date} is already booked.\n\n"
        f"*Available alternatives:*\n"
        f"{alt_text}\n\n"
        f"Reply with your preferred time or call us to rebook.\n\n"
        f"Thank you for your understanding!"
    )

    return send_whatsapp(phone, message)
