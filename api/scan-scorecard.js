// Vercel serverless function — keeps all API keys server-side
// POST /api/scan-scorecard
// Body: { base64Image: string, mediaType: string }
// Strategy: try Gemini first; on quota/rate error fall back to Claude.

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

function extractJSON(text) {
  const stripped = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  try { return JSON.parse(stripped); } catch {}
  const start = stripped.indexOf('{');
  const end   = stripped.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try { return JSON.parse(stripped.slice(start, end + 1)); } catch {}
  }
  throw new Error('No valid JSON found in AI response: ' + text.slice(0, 300));
}

function normalizeTees(parsed) {
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
  return parsed;
}

// ── Gemini ──────────────────────────────────────────────────────────────────
async function tryGemini(base64Image, mediaType) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw { quota: false, message: 'GEMINI_API_KEY not set' };

  const res = await fetch(
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

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg  = body?.error?.message || `Gemini error ${res.status}`;
    // 429 = quota exceeded → signal caller to try fallback
    const quota = res.status === 429 || /quota/i.test(msg) || /rate/i.test(msg);
    throw { quota, message: msg };
  }

  const data    = await res.json();
  const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return normalizeTees(extractJSON(rawText));
}

// ── Claude fallback ──────────────────────────────────────────────────────────
async function tryClaude(base64Image, mediaType) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64Image } },
          { type: 'text',  text: PROMPT }
        ]
      }]
    })
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error?.message || `Claude error ${res.status}`);
  }

  const data    = await res.json();
  const rawText = data.content?.[0]?.text || '';
  return normalizeTees(extractJSON(rawText));
}

// ── Handler ──────────────────────────────────────────────────────────────────
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

  // 1. Try Gemini
  try {
    const result = await tryGemini(base64Image, mediaType);
    return res.status(200).json({ ...result, _provider: 'gemini' });
  } catch (geminiErr) {
    // Only fall back to Claude on quota/rate errors; hard-fail on others
    if (!geminiErr.quota) {
      return res.status(500).json({ error: 'Gemini: ' + geminiErr.message });
    }
    console.log('Gemini quota hit — falling back to Claude');
  }

  // 2. Fall back to Claude
  try {
    const result = await tryClaude(base64Image, mediaType);
    return res.status(200).json({ ...result, _provider: 'claude' });
  } catch (claudeErr) {
    return res.status(500).json({ error: 'Claude: ' + claudeErr.message });
  }
};
