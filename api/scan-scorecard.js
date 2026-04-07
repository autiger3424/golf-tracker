// Vercel serverless function — keeps the Gemini API key server-side
// POST /api/scan-scorecard
// Body: { base64Image: string, mediaType: string }

const PROMPT = `Read this golf scorecard. Return ONLY valid JSON with no other text:
{"courseName": "string", "tees": [{"name": "string", "color": "string", "holes": [{"hole": 1, "par": 4, "yards": 400}]}]}
Include every tee box visible. Each tee must have exactly 18 holes. color should be one of: black/blue/white/red/gold/green/silver.`;

module.exports = async function handler(req, res) {
  // CORS for local dev (vercel dev)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { base64Image, mediaType } = req.body || {};
  if (!base64Image || !mediaType) {
    return res.status(400).json({ error: 'Missing base64Image or mediaType' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY not configured on server' });
  }

  let geminiRes;
  try {
    geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [
            { text: PROMPT },
            { inlineData: { mimeType: mediaType, data: base64Image } }
          ]}],
          generationConfig: { temperature: 0.1, maxOutputTokens: 4000 }
        })
      }
    );
  } catch (err) {
    return res.status(502).json({ error: 'Failed to reach Gemini API: ' + err.message });
  }

  if (!geminiRes.ok) {
    const errBody = await geminiRes.json().catch(() => ({}));
    return res.status(geminiRes.status).json({
      error: errBody?.error?.message || `Gemini API error ${geminiRes.status}`
    });
  }

  const data = await geminiRes.json();
  const raw = (data.candidates?.[0]?.content?.parts?.[0]?.text || '')
    .replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return res.status(500).json({ error: 'Gemini returned non-JSON: ' + raw.slice(0, 200) });
  }

  // Normalize: prompt uses "hole" field; app expects "number"
  if (parsed.tees) {
    parsed.tees = parsed.tees.map(tee => ({
      name: tee.name || 'Unknown',
      color: tee.color || 'white',
      holes: (tee.holes || []).map((h, i) => ({
        number: h.hole || h.number || (i + 1),
        par: h.par || 4,
        yards: h.yards || 0
      }))
    }));
  }

  return res.status(200).json(parsed);
};
