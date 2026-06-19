"""Pydantic models for the Booking API — matching the n8n schema."""

from pydantic import BaseModel, Field
from typing import Optional
from datetime import date, time, datetime


# ── Incoming Booking Request ──────────────────────────────


class BookingRequest(BaseModel):
    """Matches the n8n webhook expected JSON body."""
    name: str = Field(..., description="Client full name")
    email: Optional[str] = Field(None, description="Client email address")
    phone: Optional[str] = Field("", description="Client mobile number — optional; frontend form doesn't collect this")
    service_type: str = Field(..., description="Type of service (e.g. Cricket, Football)")
    preferred_date: str = Field(..., description="Requested date in YYYY-MM-DD format")
    preferred_time: str = Field(..., description="Requested time in HH:MM format (24hr)")
    end_time: Optional[str] = Field(None, description="End time in HH:MM format (24hr). If omitted, uses slot_duration_hours from config")
    message: Optional[str] = Field("", description="Optional note from client")
    venue_name: Optional[str] = Field("", description="Venue name (from frontend)")
    payment_mode: Optional[str] = Field("Online", description="Online or Pay at Venue")


# ── Full Booking Record (matches Google Sheet row) ────────


class Booking(BaseModel):
    """Matches the n8n Google Sheet columns exactly."""
    booking_id: str = ""
    client_name: str = ""
    client_email: str = ""
    client_phone: str = ""
    service_type: str = ""
    preferred_date: str = ""
    preferred_time: str = ""
    message: str = ""
    status: str = "CONFIRMED"
    created_at: str = ""

    # Extended fields not in the n8n schema but used by the system
    venue_name: str = ""
    payment_mode: str = "Online"
    payment_status: str = "Paid"
    start_time: str = ""
    end_time: str = ""
    base_amount: int = 0
    gst_amount: int = 0
    total_amount: int = 0
    rate_per_hour: int = 0
    duration: float = 1.0
    is_conflict: bool = False
    conflict_with: Optional[dict] = None
    alternative_slots: list[dict] = []
    available: bool = True


# ── API Response Models ────────────────────────────────────


class BookingResponse(BaseModel):
    success: bool = True
    booking_id: Optional[str] = None
    message: str = ""
    booking: Optional[Booking] = None


class SlotCheckResult(BaseModel):
    available: bool
    alternative_slots: list[dict] = []
    conflict_with: Optional[dict] = None


class AvailableSlot(BaseModel):
    start_time: str
    end_time: str
    start_timestamp: str
    end_timestamp: str
