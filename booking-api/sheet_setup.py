#!/usr/bin/env python3
"""Initialize your Google Sheet with the correct headers for the booking system.

Usage:
    python sheet_setup.py

Prerequisites:
    1. Create a Google Sheet and copy its ID from the URL
    2. Rename the sheet tab to "Bookings" (or the default Sheet1)
    3. Share the sheet with your service account email (Editor)
    4. Set GOOGLE_SHEETS_SPREADSHEET_ID in .env
"""

import sys
import os

# Add parent directory to path to find config
sys.path.insert(0, os.path.dirname(__file__))

from config import settings
from services.sheets import ensure_headers


def main():
    spreadsheet_id = settings.google_sheets_spreadsheet_id

    if not spreadsheet_id or spreadsheet_id == "your_google_sheet_id_here":
        print("❌ Please set GOOGLE_SHEETS_SPREADSHEET_ID in your .env file first.")
        print("   Copy .env.example to .env and edit it.")
        sys.exit(1)

    print(f"📋 Connecting to sheet: {spreadsheet_id}")
    print("   Make sure the sheet is shared with your service account email!")

    try:
        headers = ensure_headers(spreadsheet_id)
        print(f"✅ Headers verified/created: {', '.join(headers)}")
        print("🎉 Sheet is ready! The booking data will be written to this sheet.")
    except Exception as e:
        print(f"❌ Failed: {e}")
        print("\nTroubleshooting:")
        print("  1. Check that the spreadsheet ID is correct")
        print("  2. Make sure the service account email has Editor access")
        print("  3. Check that the sheet tab is named 'Bookings' or similar")
        sys.exit(1)


if __name__ == "__main__":
    main()
