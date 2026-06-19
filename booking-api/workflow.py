"""Booking Workflow Pipeline — mirrors the n8n automation flow.

Flow: Parse → Validate → Check Availability → Calculate Price
      → Generate Booking ID → Store in Sheets → Create Calendar Event
      → Send WhatsApp → Send Email → Return Response
"""

from datetime import datetime
from typing import Optional

from config import settings
from models import BookingRequest, Booking, SlotCheckResult
from services.sheets import get_all_bookings, append_booking
from services.calendar import create_booking_event
from services.twilio_whatsapp import send_booking_confirmation, send_alternative_slots
from services.email_service import send_confirmation_email


# ── Step 1: Parse ──────────────────────────────────────────


def parse_request(data: BookingRequest) -> Booking:
    """Map incoming request fields to a Booking record."""
    return Booking(
        client_name=data.name.strip(),
        client_email=(data.email or "").strip(),
        client_phone=(data.phone or "").strip(),
        service_type=data.service_type.strip(),
        preferred_date=data.preferred_date.strip(),
        preferred_time=data.preferred_time.strip(),
        message=(data.message or "").strip(),
        venue_name=(data.venue_name or "").strip(),
        payment_mode=(data.payment_mode or "Online").strip(),
        start_time=data.preferred_time.strip(),
        end_time=data.end_time or "",
        booking_id=f"BK{int(datetime.now().timestamp() * 1000)}",
        created_at=datetime.now().isoformat(),
        status="CONFIRMED",
    )


# ── Step 2: Validate ────────────────────────────────────────


def validate(booking: Booking) -> list[str]:
    """Validate required fields and business rules. Return list of error messages."""
    errors = []

    # Required fields
    if not booking.client_name:
        errors.append("Customer name is required")
    if not booking.preferred_date:
        errors.append("Preferred date is required")
    if not booking.preferred_time:
        errors.append("Preferred time is required")
    if not booking.service_type:
        errors.append("Service type is required")

    # Validate time format
    if booking.preferred_time:
        try:
            h, m = map(int, booking.preferred_time.split(":"))
            if h < 0 or h > 23 or m < 0 or m > 59:
                errors.append("Invalid time format (HH:MM)")
        except (ValueError, TypeError):
            errors.append("Invalid time format (use HH:MM)")

    # Validate date format
    if booking.preferred_date:
        try:
            datetime.strptime(booking.preferred_date, "%Y-%m-%d")
        except ValueError:
            errors.append("Invalid date format (use YYYY-MM-DD)")

    return errors


# ── Step 3 & 4: Check Availability + Find Alternatives ──────


def _parse_time_to_minutes(time_str: str) -> int:
    """Convert HH:MM to minutes since midnight."""
    try:
        h, m = map(int, time_str.split(":"))
        return h * 60 + m
    except (ValueError, TypeError, AttributeError):
        return -1


def _get_existing_end_minutes(existing: dict) -> int:
    """Get the end time in minutes for an existing booking.

    Tries end_time first (newer schema), falls back to start + slot_duration_hours.
    """
    existing_end = existing.get("end_time")
    if existing_end:
        minutes = _parse_time_to_minutes(existing_end)
        if minutes > 0:
            return minutes

    # Fall back: start + default duration
    existing_time = existing.get("preferred_time") or existing.get("start_time")
    mins = _parse_time_to_minutes(existing_time)
    if mins < 0:
        return -1
    return mins + int(settings.slot_duration_hours * 60)


def _get_new_end_minutes(booking: Booking) -> int:
    """Get the end time in minutes for the new booking request.

    Uses end_time from request, falls back to start + slot_duration_hours.
    """
    if booking.end_time:
        mins = _parse_time_to_minutes(booking.end_time)
        if mins > 0:
            return mins

    start_mins = _parse_time_to_minutes(booking.preferred_time)
    if start_mins < 0:
        return -1
    return start_mins + int(settings.slot_duration_hours * 60)


def _slots_overlap(
    new_start: int, new_end: int,
    existing_start: int, existing_end: int,
) -> bool:
    """Check if two time ranges overlap."""
    return (
        (new_start >= existing_start and new_start < existing_end)
        or (new_end > existing_start and new_end <= existing_end)
        or (new_start <= existing_start and new_end >= existing_end)
    )


def _booking_matches_date_service(existing: dict, date: str, service: str) -> bool:
    """Check if an existing booking matches the given date and service."""
    return (
        existing.get("preferred_date") == date
        and existing.get("service_type") == service
        and existing.get("status") != "CANCELLED"
    )


def check_availability(booking: Booking) -> SlotCheckResult:
    """Check if the requested slot conflicts with existing bookings.

    Uses actual end_time from the booking request and existing bookings.
    Falls back to slot_duration_hours from config when end_time is unavailable.
    Returns availability status and alternative slots if conflict exists.
    """
    try:
        existing_bookings = get_all_bookings()
    except Exception as e:
        print(f"⚠️ Could not fetch existing bookings — assuming available: {e}")
        return SlotCheckResult(available=True)

    if not existing_bookings:
        return SlotCheckResult(available=True)

    new_date = booking.preferred_date
    new_service = booking.service_type

    start_minutes = _parse_time_to_minutes(booking.preferred_time)
    if start_minutes < 0:
        return SlotCheckResult(available=True)

    end_minutes = _get_new_end_minutes(booking)
    if end_minutes < 0:
        return SlotCheckResult(available=True)

    conflict_found = None

    for existing in existing_bookings:
        if not _booking_matches_date_service(existing, new_date, new_service):
            continue

        existing_time = existing.get("preferred_time") or existing.get("start_time")
        existing_start = _parse_time_to_minutes(existing_time)
        if existing_start < 0:
            continue

        existing_end = _get_existing_end_minutes(existing)
        if existing_end < 0:
            continue

        if _slots_overlap(start_minutes, end_minutes, existing_start, existing_end):
            conflict_found = existing
            break

    if not conflict_found:
        return SlotCheckResult(available=True)

    # ── Generate alternatives ──────────────────────────
    alternatives = []
    new_duration = end_minutes - start_minutes
    business_start = settings.business_start_hour * 60
    business_end = settings.business_end_hour * 60

    for offset in [-120, -60, 60, 120]:  # ±1h, ±2h
        alt_start = start_minutes + offset
        alt_end = alt_start + new_duration

        if alt_start < business_start or alt_end > business_end:
            continue

        alt_start_str = f"{alt_start // 60:02d}:{alt_start % 60:02d}"
        alt_end_str = f"{alt_end // 60:02d}:{alt_end % 60:02d}"

        # Check if alternative conflicts with any existing booking
        slot_taken = False
        for existing in existing_bookings:
            if not _booking_matches_date_service(existing, new_date, new_service):
                continue

            existing_time = existing.get("preferred_time") or existing.get("start_time")
            ex_start = _parse_time_to_minutes(existing_time)
            if ex_start < 0:
                continue

            ex_end = _get_existing_end_minutes(existing)
            if ex_end < 0:
                continue

            if _slots_overlap(alt_start, alt_end, ex_start, ex_end):
                slot_taken = True
                break

        if not slot_taken:
            alternatives.append({
                "start_time": alt_start_str,
                "end_time": alt_end_str,
                "start_timestamp": f"{new_date}T{alt_start_str}:00+05:30",
                "end_timestamp": f"{new_date}T{alt_end_str}:00+05:30",
            })

    return SlotCheckResult(
        available=False,
        alternative_slots=alternatives,
        conflict_with={
            "customer": conflict_found.get("client_name", "Unknown"),
            "start": conflict_found.get("preferred_time", ""),
            "end": conflict_found.get("end_time", ""),
        },
    )


# ── Step 5: Calculate Price ─────────────────────────────────


def calculate_price(booking: Booking) -> Booking:
    """Calculate pricing based on sport type and duration."""
    sport_key = booking.service_type.lower()
    pricing = settings.pricing_map
    rate_per_hour = pricing.get(sport_key, settings.price_default)

    try:
        sh, sm = map(int, booking.preferred_time.split(":"))

        # Use provided end_time, or default to slot_duration_hours from config
        if booking.end_time:
            eh, em = map(int, booking.end_time.split(":"))
        else:
            eh = sh + int(settings.slot_duration_hours)
            em = sm

        duration = (eh + em / 60) - (sh + sm / 60)
        if duration <= 0:
            duration = settings.slot_duration_hours
            eh = sh + int(settings.slot_duration_hours)
            em = sm

        end_time = f"{eh:02d}:{em:02d}"
    except (ValueError, TypeError, AttributeError):
        duration = settings.slot_duration_hours
        end_time = ""

    base_amount = round(rate_per_hour * duration)
    gst_amount = round(base_amount * settings.gst_rate)
    total_amount = base_amount + gst_amount

    booking.rate_per_hour = rate_per_hour
    booking.duration = duration
    booking.base_amount = base_amount
    booking.gst_amount = gst_amount
    booking.total_amount = total_amount
    booking.end_time = end_time
    booking.payment_status = "Paid" if booking.payment_mode.lower() == "online" else "Pay at Venue"

    return booking


# ── Full Pipeline ────────────────────────────────────────────


def run_workflow(request: BookingRequest) -> Booking:
    """Execute the complete booking workflow pipeline."""
    # Step 1: Parse
    booking = parse_request(request)

    # Step 2: Validate
    errors = validate(booking)
    if errors:
        booking.status = "REJECTED"
        booking.is_conflict = True
        booking.available = False
        return booking

    # Step 3: Check availability
    slot_check = check_availability(booking)
    if not slot_check.available:
        booking.is_conflict = True
        booking.available = False
        booking.conflict_with = slot_check.conflict_with
        booking.alternative_slots = slot_check.alternative_slots

        # Send WhatsApp with alternative slot suggestions
        try:
            booking_dict = booking.model_dump()
            send_alternative_slots(booking_dict, slot_check.alternative_slots)
        except Exception as e:
            print(f"❌ Alternative slots WhatsApp send failed: {e}")

        return booking

    booking.available = True

    # Step 4: Calculate price
    booking = calculate_price(booking)

    # Step 5: Update end_time based on start_time + duration
    booking.end_time = booking.end_time or ""

    # Step 6: Store in Google Sheets
    try:
        append_booking({
            "booking_id": booking.booking_id,
            "client_name": booking.client_name,
            "client_email": booking.client_email,
            "client_phone": booking.client_phone,
            "service_type": booking.service_type,
            "preferred_date": booking.preferred_date,
            "preferred_time": booking.preferred_time,
            "end_time": booking.end_time,
            "venue_name": booking.venue_name,
            "payment_mode": booking.payment_mode,
            "total_amount": booking.total_amount,
            "message": booking.message,
            "status": booking.status,
            "created_at": booking.created_at,
        })
        print(f"✅ Booking saved to sheet: {booking.booking_id}")
    except Exception as e:
        print(f"❌ Failed to save booking to sheet: {e}")

    # Step 7: Create Calendar Event
    try:
        booking_dict = booking.model_dump()
        create_booking_event(booking_dict)
    except Exception as e:
        print(f"❌ Calendar event creation failed: {e}")

    # Step 8: Send WhatsApp Confirmation
    try:
        booking_dict = booking.model_dump()
        send_booking_confirmation(booking_dict)
    except Exception as e:
        print(f"❌ WhatsApp send failed: {e}")

    # Step 9: Send Email Confirmation
    try:
        booking_dict = booking.model_dump()
        send_confirmation_email(booking_dict)
    except Exception as e:
        print(f"❌ Email send failed: {e}")

    return booking
