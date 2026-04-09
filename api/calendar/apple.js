// Proxy to fetch an iCloud (or any webcal) ICS feed server-side,
// avoiding CORS restrictions in the browser.
module.exports = async function handler(req, res) {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'No URL provided' });

  // Convert webcal:// to https://
  const fetchUrl = url.replace(/^webcal:\/\//i, 'https://');

  try {
    const r = await fetch(fetchUrl, {
      headers: { 'User-Agent': 'Grady-GolfTrack/1.0' },
    });
    if (!r.ok) throw new Error(`Failed to fetch calendar: ${r.status}`);
    const text = await r.text();
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store');
    res.status(200).send(text);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
