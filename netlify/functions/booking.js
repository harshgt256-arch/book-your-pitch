/**
 * Single booking handler — /api/bookings/* (with ID param)
 * GET    → Get booking by ID
 * DELETE → Cancel booking by ID
 *
 * The booking ID is extracted from the request path.
 */

const { getAllBookings, updateBookingStatus } = require('./lib/sheets');

/**
 * Extract booking ID from the request.
 * Set by netlify.toml redirect: /api/bookings/:id → booking?id=:id
 */
function extractBookingId(event) {
  return event.queryStringParameters?.id || null;
}

async function handleGet(bookingId) {
  try {
    const bookings = await getAllBookings();
    const booking = bookings.find(b => b.booking_id === bookingId);
    if (!booking) {
      return {
        statusCode: 404,
        body: JSON.stringify({ success: false, message: `Booking ${bookingId} not found` }),
      };
    }
    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, booking }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, message: err.message }),
    };
  }
}

async function handleDelete(bookingId) {
  try {
    const success = await updateBookingStatus(bookingId, 'CANCELLED');
    if (!success) {
      return {
        statusCode: 404,
        body: JSON.stringify({ success: false, message: `Booking ${bookingId} not found` }),
      };
    }
    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, message: `Booking ${bookingId} cancelled` }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, message: err.message }),
    };
  }
}

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  };

  const bookingId = extractBookingId(event);
  if (!bookingId) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ success: false, message: 'Missing booking ID' }),
    };
  }

  let result;
  switch (event.httpMethod) {
    case 'GET':
      result = await handleGet(bookingId);
      break;
    case 'DELETE':
      result = await handleDelete(bookingId);
      break;
    case 'OPTIONS':
      result = { statusCode: 204, body: '' };
      break;
    default:
      result = {
        statusCode: 405,
        body: JSON.stringify({ success: false, message: `Method ${event.httpMethod} not allowed` }),
      };
  }

  return { ...result, headers };
};
