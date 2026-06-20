"""Google Calendar service — creates calendar events for confirmed bookings."""

import json
import os
from datetime import datetime

from google.oauth2 import service_account
from googleapiclient.discovery import build

from config import settings


def _get_calendar_service():
    """Build and return an authenticated Google Calendar API service."""
    creds = None

    if settings.google_service_account_json:
        info = json.loads(settings.google_service_account_json)
        creds = service_account.Credentials.from_service_account_info(
            info,
            scopes=["https://www.googleapis.com/auth/calendar"],
        )
    elif settings.google_service_account_file and os.path.exists(settings.google_service_account_file):
        creds = service_account.Credentials.from_service_account_file(
            settings.google_service_account_file,
            scopes=["https://www.googleapis.com/auth/calendar"],
        )
    else:
        raise RuntimeError(
            "No Google service account credentials found. "
            "Set GOOGLE_SERVICE_ACCOUNT_FILE or GOOGLE_SERVICE_ACCOUNT_JSON in .env"
        )

    return build("calendar", "v3", credentials=creds)


def create_booking_event(booking: dict) -> dict | None:
    """Create a Google Calendar event for a confirmed booking.

    Returns the created event dict, or None on failure.
    """
    if not settings.google_sheets_spreadsheet_id:
        print("⚠️ GOOGLE_SHEETS_SPREADSHEET_ID not set — skipping calendar event")
        return None

    service = _get_calendar_service()
    calendar_id = settings.google_calendar_id or "primary"

    preferred_date = booking.get("preferred_date", "")
    start_time = booking.get("preferred_time", booking.get("start_time", "10:00"))

    # Use end_time from booking if provided, otherwise calculate (default 1 hour)
    end_time_from_booking = booking.get("end_time", "")
    if end_time_from_booking:
        end_time = end_time_from_booking
    else:
        start_h, start_m = map(int, start_time.split(":"))
        end_h = start_h + int(settings.slot_duration_hours)
        end_m = start_m
        if end_h >= 24:
            end_h = 23
            end_m = 59
        end_time = f"{end_h:02d}:{end_m:02d}"

    # Format as ISO 8601 with IST offset
    start_iso = f"{preferred_date}T{start_time}:00+05:30"
    end_iso = f"{preferred_date}T{end_time}:00+05:30"

    # Build description
    description_parts = [
        f"Booking ID: {booking.get('booking_id', 'N/A')}",
        f"Customer: {booking.get('client_name', 'N/A')}",
        f"Phone: {booking.get('client_phone', 'N/A')}",
        f"Email: {booking.get('client_email', 'N/A')}",
        f"Service: {booking.get('service_type', 'N/A')}",
        f"Venue: {booking.get('venue_name', 'N/A')}",
        f"Payment: {booking.get('payment_status', 'N/A')}",
        f"Message: {booking.get('message', 'N/A')}",
    ]

    event = {
        "summary": f"{booking.get('service_type', 'Booking')} — {booking.get('client_name', '')}",
        "description": "\n".join(description_parts),
        "start": {
            "dateTime": start_iso,
            "timeZone": "Asia/Kolkata",
        },
        "end": {
            "dateTime": end_iso,
            "timeZone": "Asia/Kolkata",
        },
        "reminders": {
            "useDefault": False,
            "overrides": [
                {"method": "email", "minutes": 60},
                {"method": "popup", "minutes": 30},
            ],
        },
    }

    try:
        created = service.events().insert(
            calendarId=calendar_id,
            body=event,
            sendUpdates="none",
        ).execute()
        print(f"✅ Calendar event created: {created.get('htmlLink', created.get('id', ''))}")
        return created
    except Exception as e:
        error_str = str(e)
        print(f"❌ Calendar event creation failed: {error_str[:200]}")
        return None
