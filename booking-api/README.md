# Book Your Pitch — Booking API Server

A FastAPI-based backend booking automation server that mirrors the n8n workflow.
Handles bookings from validation through to notifications (WhatsApp, Email, Calendar).

## Quick Start

### 1. Install dependencies
```bash
cd booking-api
pip install -r requirements.txt
```

### 2. Configure environment
```bash
cp .env.example .env
# Edit .env with your credentials (see Setup Guide below)
```

### 3. Initialize your Google Sheet
```bash
python sheet_setup.py
```

### 4. Run the server
```bash
python main.py
# Server starts at http://localhost:8000
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check + service status |
| POST | `/api/bookings` | Create booking (full workflow) |
| GET | `/api/bookings` | List all bookings |
| GET | `/api/bookings/{id}` | Get booking details |
| DELETE | `/api/bookings/{id}` | Cancel booking |
| GET | `/api/setup/guide` | Setup instructions |

## Setup Guide

### Google Cloud (Sheets + Calendar)
1. Go to [Google Cloud Console](https://console.cloud.google.com/) → Create a new project
2. Enable **Google Sheets API** and **Google Calendar API**
3. Go to **IAM & Admin** → **Service Accounts** → Create a new service account
4. Generate a **JSON key** and download it as `service-account-key.json`
5. Place the file in the `booking-api/` folder
6. **Share your Google Sheet** with the service account email (as Editor)

### Twilio (WhatsApp)
1. Sign up at [Twilio](https://www.twilio.com/try-twilio)
2. Get **Account SID** and **Auth Token** from the Console
3. Enable WhatsApp Sandbox (or request production access)
4. Set your Twilio WhatsApp number in `.env`

### Gmail (Email)
1. Enable **2-Factor Authentication** on your Gmail account
2. Generate an **App Password** at https://myaccount.google.com/apppasswords
3. Use the 16-character app password in `.env`

## Workflow Pipeline

```
Input → Parse → Validate → Check Availability → Calculate Price 
→ Generate Booking ID → Store in Sheets → Create Calendar Event 
→ Send WhatsApp → Send Email → Return Response
```

Daily reminders are sent at 9:00 AM IST for the next day's bookings.
