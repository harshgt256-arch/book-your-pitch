"""Scheduler service — runs daily reminders for tomorrow's bookings."""

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from apscheduler.schedulers.background import BackgroundScheduler

from services.sheets import get_bookings_by_date
from services.twilio_whatsapp import send_reminder


IST = ZoneInfo("Asia/Kolkata")

scheduler = BackgroundScheduler(timezone=IST)


def _send_daily_reminders():
    """Check for tomorrow's bookings and send WhatsApp reminders."""
    tomorrow = (datetime.now(IST) + timedelta(days=1)).strftime("%Y-%m-%d")
    print(f"⏰ Running daily reminder check for {tomorrow}...")

    try:
        bookings = get_bookings_by_date(tomorrow)
    except Exception as e:
        print(f"❌ Failed to read bookings for reminders: {e}")
        return

    if not bookings:
        print(f"📭 No bookings found for {tomorrow}")
        return

    sent = 0
    for booking in bookings:
        if send_reminder(booking):
            sent += 1

    print(f"✅ Sent {sent}/{len(bookings)} reminders for {tomorrow}")


def start_scheduler():
    """Start the background scheduler for daily reminders."""
    # Run every day at 9:00 AM IST
    scheduler.add_job(
        _send_daily_reminders,
        trigger="cron",
        hour=9,
        minute=0,
        id="daily_reminders",
        name="Send daily booking reminders",
        replace_existing=True,
    )
    scheduler.start()
    print("⏰ Scheduler started — daily reminders at 9:00 AM IST")


def stop_scheduler():
    """Shut down the scheduler gracefully."""
    if scheduler.running:
        scheduler.shutdown(wait=False)
        print("⏰ Scheduler stopped")
