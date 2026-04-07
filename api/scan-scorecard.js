// Vercel serverless function — keeps the Gemini API key server-side
// POST /api/scan-scorecard
// Body: { base64Image: string, mediaType: string }

// Increase body size limit for base64-encoded images (default is 1mb)
module.exports.config = { api: { bodyParser: { sizeLimit: '10mb' } } };

const PROMPT = `Read this golf scorecard image carefully.
Return ONLY a single valid JSON object with no markdown, no code fences, no explanation.
Use exactly this structure:
{"courseName":"string","tees":[{"name":"string","color":"string","holes":[{"hole":1,"par":4,"yards":400}]}]}
Rules:
- Include every tee box visible on the scorecard
- Every tee must have exactly 18 holes numbered 1-18
- color must be one of: black/blue/white/red/gold/green/silver
- Return ONLY the raw JSON, nothing else`;

// Try several strategies to pull a JSON object out of Gemini's reply
function extractJSON(text) {
  // 1. Strip markdown code fences then try direct parse
  const stripped = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  try { return JSON.parse(stripped); } catch {}

  // 2. Find the first { ... } block
  const start = stripped.indexOf('{');
  const end   = stripped.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try { return JSON.parse(stripped.slice(start, end + 1)); } catch {}
  }

  throw new Error('No valid JSON found. Raw reply: ' + text.slice(0, 300));
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

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
          generationConfig: { temperature: 0.1, maxOutputTokens: 4096 }
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
  const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

  let parsed;
  try {
    parsed = extractJSON(rawText);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }

  // Normalize: Gemini returns "hole" field; app expects "number"
  if (parsed.tees) {
    parsed.tees = parsed.tees.map(tee => ({
      name:  tee.name  || 'Unknown',
      color: tee.color || 'white',
      holes: (tee.holes || []).map((h, i) => ({
        number: h.hole || h.number || (i + 1),
        par:    h.par    || 4,
        yards:  h.yards  || 0
      }))
    }));
  }

  return res.status(200).json(parsed);
};
