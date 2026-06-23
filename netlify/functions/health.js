/**
 * Health check endpoint — GET /api/health
 * Returns service status and configuration state.
 */

exports.handler = async () => {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify({
      status: 'ok',
      timestamp: new Date().toISOString(),
      sheets_configured: !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON,
      twilio_configured: !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN),
      email_configured: !!(process.env.SMTP_USERNAME && process.env.SMTP_PASSWORD),
    }),
  };
};
