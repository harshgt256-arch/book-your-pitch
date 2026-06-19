"""Booking API — Configuration via environment variables."""

from pydantic_settings import BaseSettings
from typing import Optional


class Settings(BaseSettings):
    # ── Google Cloud ──────────────────────────────────
    google_service_account_file: str = "service-account-key.json"
    google_service_account_json: Optional[str] = None
    google_sheets_spreadsheet_id: str = ""
    google_calendar_id: str = "primary"

    # ── Twilio ────────────────────────────────────────
    twilio_account_sid: str = ""
    twilio_auth_token: str = ""
    twilio_whatsapp_number: str = "+14155238886"

    # ── Email (SMTP) ──────────────────────────────────
    smtp_host: str = "smtp.gmail.com"
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_from_name: str = "Book Your Pitch"

    # ── Deployed URL (set on Render) ──────────────────
    render_external_url: str = ""

    # ── API ───────────────────────────────────────────
    api_host: str = "0.0.0.0"
    api_port: int = 8000
    cors_origins: str = "http://localhost:5500,http://127.0.0.1:5500,http://localhost:8000"

    # ── Business Rules ────────────────────────────────
    business_start_hour: int = 9
    business_end_hour: int = 19
    slot_duration_hours: float = 1.0
    gst_rate: float = 0.18

    # ── Pricing (INR per hour) ────────────────────────
    price_cricket: int = 1500
    price_football: int = 1200
    price_pickleball: int = 800
    price_badminton: int = 600
    price_tennis: int = 1000
    price_default: int = 1000

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}

    @property
    def cors_origin_list(self) -> list[str]:
        origins = [o.strip() for o in self.cors_origins.split(",") if o.strip()]
        # Add the Render deployment URL if configured
        if self.render_external_url:
            origins.append(self.render_external_url.strip())
        return origins

    @property
    def pricing_map(self) -> dict[str, int]:
        return {
            "cricket": self.price_cricket,
            "football": self.price_football,
            "pickleball": self.price_pickleball,
            "badminton": self.price_badminton,
            "tennis": self.price_tennis,
        }

settings = Settings()
