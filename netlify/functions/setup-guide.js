/**
 * Setup guide — GET /api/setup/guide
 * Returns instructions for configuring the required services.
 */

exports.handler = async () => {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify({
      message: 'Set the following environment variables in your Netlify dashboard.',
      services_required: [
        {
          name: 'Google Cloud (Sheets + Calendar)',
          steps: [
            '1. Go to https://console.cloud.google.com/ and create a new project',
            '2. Enable Google Sheets API and Google Calendar API',
            '3. Go to IAM & Admin → Service Accounts → Create service account',
            '4. Generate a JSON key and download it',
            '5. Share your Google Sheet with the service account email (Editor)',
            '6. Set GOOGLE_SERVICE_ACCOUNT_JSON to the full JSON contents',
          ],
          env_vars: ['GOOGLE_SERVICE_ACCOUNT_JSON', 'GOOGLE_SHEETS_SPREADSHEET_ID', 'GOOGLE_CALENDAR_ID'],
        },
        {
          name: 'Twilio (WhatsApp)',
          steps: [
            '1. Sign up at https://www.twilio.com/try-twilio',
            '2. Get Account SID and Auth Token from Twilio Console',
            '3. Enable WhatsApp Sandbox or request production access',
          ],
          env_vars: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_WHATSAPP_NUMBER'],
        },
        {
          name: 'Email (Gmail SMTP)',
          steps: [
            '1. Enable 2-Factor Authentication on your Gmail account',
            '2. Generate an App Password at https://myaccount.google.com/apppasswords',
            '3. Use the app password in .env',
          ],
          env_vars: ['SMTP_USERNAME', 'SMTP_PASSWORD'],
        },
        {
          name: 'Business Configuration',
          steps: [
            '1. Set pricing per sport',
            '2. Set business hours and GST rate',
          ],
          env_vars: [
            'BUSINESS_START_HOUR', 'BUSINESS_END_HOUR', 'SLOT_DURATION_HOURS', 'GST_RATE',
            'PRICE_CRICKET', 'PRICE_FOOTBALL', 'PRICE_PICKLEBALL', 'PRICE_BADMINTON',
            'PRICE_TENNIS', 'PRICE_DEFAULT',
          ],
        },
      ],
    }),
  };
};
