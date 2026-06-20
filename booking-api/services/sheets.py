"""Google Sheets service — handles all Sheet CRUD operations."""

import os
import json
from typing import Optional

from google.auth.transport.requests import Request
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

from config import settings


# ── Auth ───────────────────────────────────────────────────


def _get_sheets_service():
    """Build and return an authenticated Google Sheets API service."""
    creds = None

    # Try service account JSON from env var first
    if settings.google_service_account_json:
        info = json.loads(settings.google_service_account_json)
        creds = service_account.Credentials.from_service_account_info(
            info,
            scopes=["https://www.googleapis.com/auth/spreadsheets"],
        )
    # Try service account file
    elif settings.google_service_account_file and os.path.exists(settings.google_service_account_file):
        creds = service_account.Credentials.from_service_account_file(
            settings.google_service_account_file,
            scopes=["https://www.googleapis.com/auth/spreadsheets"],
        )
    else:
        raise RuntimeError(
            "No Google service account credentials found. "
            "Set GOOGLE_SERVICE_ACCOUNT_FILE or GOOGLE_SERVICE_ACCOUNT_JSON in .env"
        )

    return build("sheets", "v4", credentials=creds)


# ── Sheet Operations ────────────────────────────────────────


def ensure_headers(spreadsheet_id: Optional[str] = None) -> list[str]:
    """Ensure the sheet has the required header row. Return the headers."""
    sid = spreadsheet_id or settings.google_sheets_spreadsheet_id
    if not sid:
        raise ValueError("GOOGLE_SHEETS_SPREADSHEET_ID is not configured in .env")

    service = _get_sheets_service()
    expected_headers = [
        "booking_id", "client_name", "client_email", "client_phone",
        "service_type", "preferred_date", "preferred_time", "message",
        "status", "created_at",
        # Extended columns (appended at end for backward compatibility)
        "end_time", "venue_name", "payment_mode", "total_amount",
    ]

    try:
        result = service.spreadsheets().values().get(
            spreadsheetId=sid, range="A:Z"
        ).execute()
        rows = result.get("values", [])
        if rows:
            existing_headers = [h.strip() for h in rows[0]]
            # Check if expected headers exist (allow extra columns)
            if all(h in existing_headers for h in expected_headers):
                return existing_headers

        # Write headers
        service.spreadsheets().values().update(
            spreadsheetId=sid,
            range="A1",
            valueInputOption="RAW",
            body={"values": [expected_headers]},
        ).execute()
        return expected_headers
    except HttpError as e:
        if e.resp.status == 404:
            raise RuntimeError(
                f"Sheet not found. Make sure the spreadsheet ID '{sid}' is correct "
                f"and shared with your service account email (Editor permission)."
            ) from e
        raise


def get_all_bookings(spreadsheet_id: Optional[str] = None) -> list[dict]:
    """Read all rows from the Bookings sheet and return as list of dicts.

    Strips whitespace from header names and computes missing total_amount
    values for older bookings that don't have pricing data stored in the sheet.
    """
    sid = spreadsheet_id or settings.google_sheets_spreadsheet_id
    if not sid:
        raise ValueError("GOOGLE_SHEETS_SPREADSHEET_ID not configured")

    service = _get_sheets_service()
    result = service.spreadsheets().values().get(
        spreadsheetId=sid, range="A:Z"
    ).execute()
    rows = result.get("values", [])

    if len(rows) < 2:
        return []

    # Strip whitespace from header names (Google Sheets sometimes adds leading spaces)
    raw_headers = rows[0]
    headers = [h.strip() for h in raw_headers]

    bookings = []
    for row in rows[1:]:
        booking = {}
        for i, header in enumerate(headers):
            booking[header] = row[i] if i < len(row) else ""
        bookings.append(booking)

    # ── Fill in missing values for older bookings ───────────────
    for booking in bookings:
        # payment_mode / payment_status fallback
        if not booking.get("payment_mode", ""):
            booking["payment_mode"] = "Pay at Venue"
        pm = (booking.get("payment_mode") or "").lower()
        if not booking.get("payment_status", ""):
            booking["payment_status"] = "Paid" if pm == "online" else "Pay at Venue"

        # total_amount and pricing fallback
        raw_amount = booking.get("total_amount", "")
        try:
            if raw_amount and int(str(raw_amount).strip()) > 0:
                continue  # Already has a valid amount
        except (ValueError, TypeError):
            pass  # Empty or invalid — compute below

        sport_key = (booking.get("service_type") or "").lower()
        rate_per_hour = settings.pricing_map.get(sport_key, settings.price_default)

        start_time = booking.get("preferred_time") or booking.get("start_time", "")
        end_time = booking.get("end_time", "")

        duration = float(settings.slot_duration_hours)
        if start_time and end_time:
            try:
                sh, sm = map(int, start_time.split(":"))
                eh, em = map(int, end_time.split(":"))
                duration = max((eh + em / 60) - (sh + sm / 60), 0.5)
            except (ValueError, TypeError):
                pass

        base_amount = round(rate_per_hour * duration)
        gst_amount = round(base_amount * settings.gst_rate)
        total_amount = base_amount + gst_amount

        booking["total_amount"] = str(total_amount)
        booking["rate_per_hour"] = rate_per_hour
        booking["duration"] = duration
        booking["base_amount"] = base_amount
        booking["gst_amount"] = gst_amount

    return bookings


def append_booking(booking: dict, spreadsheet_id: Optional[str] = None) -> bool:
    """Append a new booking row to the sheet."""
    sid = spreadsheet_id or settings.google_sheets_spreadsheet_id
    if not sid:
        raise ValueError("GOOGLE_SHEETS_SPREADSHEET_ID not configured")

    service = _get_sheets_service()

    # Map booking fields to the correct column order
    row = [
        booking.get("booking_id", ""),
        booking.get("client_name", ""),
        booking.get("client_email", ""),
        booking.get("client_phone", ""),
        booking.get("service_type", ""),
        booking.get("preferred_date", ""),
        booking.get("preferred_time", ""),
        booking.get("message", ""),
        booking.get("status", "CONFIRMED"),
        booking.get("created_at", ""),
        # Extended columns (appended at end for backward compatibility)
        booking.get("end_time", ""),
        booking.get("venue_name", ""),
        booking.get("payment_mode", ""),
        str(booking.get("total_amount", "")),
    ]

    try:
        service.spreadsheets().values().append(
            spreadsheetId=sid,
            range="A:N",
            valueInputOption="RAW",
            insertDataOption="INSERT_ROWS",
            body={"values": [row]},
        ).execute()
        return True
    except HttpError as e:
        print(f"❌ Sheets append error: {e}")
        return False


def get_bookings_by_date(target_date: str, spreadsheet_id: Optional[str] = None) -> list[dict]:
    """Get all bookings for a specific date."""
    all_bookings = get_all_bookings(spreadsheet_id)
    return [
        b for b in all_bookings
        if b.get("preferred_date") == target_date and b.get("status") != "CANCELLED"
    ]


def update_booking_status(
    booking_id: str, new_status: str, spreadsheet_id: Optional[str] = None
) -> bool:
    """Update the status column of a specific booking by booking_id."""
    sid = spreadsheet_id or settings.google_sheets_spreadsheet_id
    if not sid:
        raise ValueError("GOOGLE_SHEETS_SPREADSHEET_ID not configured")

    service = _get_sheets_service()
    result = service.spreadsheets().values().get(
        spreadsheetId=sid, range="A:Z"
    ).execute()
    rows = result.get("values", [])

    if len(rows) < 2:
        return False

    headers = [h.strip() for h in rows[0]]
    try:
        status_col = headers.index("status") + 1  # 1-indexed
        id_col = headers.index("booking_id") + 1
    except ValueError:
        return False

    for i, row in enumerate(rows[1:], start=2):
        if len(row) >= id_col and row[id_col - 1] == booking_id:
            col_letter = chr(64 + status_col)
            service.spreadsheets().values().update(
                spreadsheetId=sid,
                range=f"{col_letter}{i}",
                valueInputOption="RAW",
                body={"values": [[new_status]]},
            ).execute()
            return True

    return False
