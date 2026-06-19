"""Booking API Server — FastAPI application.

Endpoints:
  POST /api/bookings       — Create a booking (full workflow)
  GET  /api/bookings        — List all bookings
  GET  /api/bookings/{id}   — Get booking details
  DELETE /api/bookings/{id} — Cancel a booking
  GET  /api/health          — Health check
  GET  /api/setup/guide     — Returns the setup guide
"""

import os
import sys
from contextlib import asynccontextmanager
from datetime import datetime

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from config import settings
from models import BookingRequest, BookingResponse
from workflow import run_workflow
from services.sheets import get_all_bookings, update_booking_status
from services.scheduler import start_scheduler, stop_scheduler


# ── Lifespan ─────────────────────────────────────────────────


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown events."""
    print("🚀 Booking API starting...")
    print(f"📋 CORS origins: {settings.cors_origin_list}")

    # Check if essential credentials are configured
    if not settings.google_sheets_spreadsheet_id:
        print("⚠️  GOOGLE_SHEETS_SPREADSHEET_ID not set — sheets disabled")
    if not settings.twilio_account_sid:
        print("⚠️  Twilio credentials not set — WhatsApp disabled")
    if not settings.smtp_username:
        print("⚠️  SMTP credentials not set — Email disabled")

    # Start the daily reminder scheduler
    try:
        start_scheduler()
    except Exception as e:
        print(f"⚠️  Scheduler start failed: {e}")

    yield

    # Shutdown
    stop_scheduler()
    print("👋 Booking API shutting down...")


# ── App ──────────────────────────────────────────────────────

app = FastAPI(
    title="Book Your Pitch — Booking API",
    description="Sports venue booking automation server. Mirrors the n8n workflow.",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS — allow frontend origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Routes ───────────────────────────────────────────────────


@app.get("/api/health")
async def health_check():
    """Health check endpoint."""
    return {
        "status": "ok",
        "timestamp": datetime.now().isoformat(),
        "sheets_configured": bool(settings.google_sheets_spreadsheet_id),
        "twilio_configured": bool(settings.twilio_account_sid),
        "email_configured": bool(settings.smtp_username),
    }


@app.post("/api/bookings", response_model=BookingResponse)
async def create_booking(request: BookingRequest):
    """Create a new booking.

    Runs the full workflow: Parse → Validate → Check Availability
    → Calculate Price → Store in Sheets → Calendar Event → Notifications
    """
    if not settings.google_sheets_spreadsheet_id:
        raise HTTPException(
            status_code=503,
            detail="Server not configured: GOOGLE_SHEETS_SPREADSHEET_ID is missing"
        )

    try:
        result = run_workflow(request)
    except Exception as e:
        print(f"❌ Workflow error: {e}")
        import traceback
        traceback.print_exc()
        return BookingResponse(
            success=False,
            message=f"Something went wrong during processing. Please try again.",
        )

    if result.status == "REJECTED":
        return BookingResponse(
            success=False,
            message="Validation failed. Check that all required fields are filled correctly.",
            booking=result,
        )

    if not result.available:
        return BookingResponse(
            success=False,
            message=f"Slot not available. {len(result.alternative_slots)} alternative(s) suggested.",
            booking=result,
        )

    return BookingResponse(
        success=True,
        booking_id=result.booking_id,
        message="Booking confirmed! Check your WhatsApp and email for details.",
        booking=result,
    )


@app.get("/api/bookings")
async def list_bookings():
    """List all bookings from Google Sheets."""
    try:
        bookings = get_all_bookings()
        return {"success": True, "count": len(bookings), "bookings": bookings}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/bookings/{booking_id}")
async def get_booking(booking_id: str):
    """Get a single booking by ID."""
    bookings = get_all_bookings()
    for b in bookings:
        if b.get("booking_id") == booking_id:
            return {"success": True, "booking": b}
    raise HTTPException(status_code=404, detail=f"Booking {booking_id} not found")


@app.delete("/api/bookings/{booking_id}")
async def cancel_booking(booking_id: str):
    """Cancel a booking (set status to CANCELLED)."""
    success = update_booking_status(booking_id, "CANCELLED")
    if success:
        return {"success": True, "message": f"Booking {booking_id} cancelled"}
    raise HTTPException(status_code=404, detail=f"Booking {booking_id} not found")


@app.get("/api/setup/guide")
async def setup_guide():
    """Return the setup credentials guide."""
    return {
        "message": "See the .env.example file and the README for setup instructions.",
        "services_required": [
            {
                "name": "Google Cloud (Sheets + Calendar)",
                "steps": [
                    "1. Go to https://console.cloud.google.com/ and create a new project",
                    "2. Enable Google Sheets API and Google Calendar API",
                    "3. Go to IAM & Admin → Service Accounts → Create service account",
                    "4. Generate a JSON key and download it",
                    "5. Share your Google Sheet with the service account email (Editor)",
                    "6. Set GOOGLE_SERVICE_ACCOUNT_FILE or paste JSON in GOOGLE_SERVICE_ACCOUNT_JSON",
                ],
                "env_vars": ["GOOGLE_SERVICE_ACCOUNT_FILE", "GOOGLE_SHEETS_SPREADSHEET_ID", "GOOGLE_CALENDAR_ID"],
            },
            {
                "name": "Twilio (WhatsApp)",
                "steps": [
                    "1. Sign up at https://www.twilio.com/try-twilio",
                    "2. Get Account SID and Auth Token from Twilio Console",
                    "3. Enable WhatsApp Sandbox or request production access",
                ],
                "env_vars": ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_WHATSAPP_NUMBER"],
            },
            {
                "name": "Gmail (Email)",
                "steps": [
                    "1. Enable 2-Factor Authentication on your Gmail account",
                    "2. Generate an App Password at https://myaccount.google.com/apppasswords",
                    "3. Use the app password in .env",
                ],
                "env_vars": ["SMTP_USERNAME", "SMTP_PASSWORD"],
            },
        ],
    }


# ── Frontend static files ────────────────────────────────────

# Serve the booking-tool frontend at the root (/) so the tool works
# without CORS issues. API routes under /api/ take priority.
_frontend_dir = os.path.join(os.path.dirname(__file__), "..", "booking-tool")
if os.path.isdir(_frontend_dir):
    app.mount("/", StaticFiles(directory=_frontend_dir, html=True), name="frontend")
    print(f"🌐 Frontend served at http://localhost:{settings.api_port}/")


# ── Main ─────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host=settings.api_host,
        port=settings.api_port,
        reload=True,
    )
