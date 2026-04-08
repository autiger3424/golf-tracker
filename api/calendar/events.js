// Vercel serverless function — Google Calendar proxy
// Passes the user's OAuth access token (from Authorization header) to Google's API
// GET  /api/calendar/events — list upcoming golf events (next 6 months, query="golf")
// POST /api/calendar/events — create a new calendar event

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No access token provided' });

  // ── GET: list upcoming golf events ───────────────────────────
  if (req.method === 'GET') {
    const now = new Date().toISOString();
    const sixMonths = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString();
    const params = new URLSearchParams({
      timeMin: now,
      timeMax: sixMonths,
      q: 'golf',
      maxResults: '20',
      singleEvents: 'true',
      orderBy: 'startTime',
    });
    const r = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const data = await r.json();
    return res.status(r.status).json(data);
  }

  // ── POST: create a new event ──────────────────────────────────
  if (req.method === 'POST') {
    const r = await fetch(
      'https://www.googleapis.com/calendar/v3/calendars/primary/events',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(req.body),
      }
    );
    const data = await r.json();
    return res.status(r.status).json(data);
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
