// Vercel serverless function — keeps all API keys server-side
// POST /api/scan-scorecard
// Body: { base64Image: string, mediaType: string }
// Fallback chain: gemini-2.0-flash → gemini-2.0-flash-lite → gemini-2.5-flash → Claude

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

// Each Gemini model has its own independent quota bucket
const GEMINI_MODELS = [
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-2.5-flash',
];

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

function isQuotaError(status, msg) {
  return status === 429 || /quota/i.test(msg) || /rate.?limit/i.test(msg) || /resource.?exhausted/i.test(msg);
}

// ── Try one Gemini model ─────────────────────────────────────────────────────
async function tryGeminiModel(model, base64Image, mediaType, apiKey) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
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
    const msg  = body?.error?.message || `Gemini ${model} error ${res.status}`;
    throw { quota: isQuotaError(res.status, msg), message: msg };
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

  const geminiKey = process.env.GEMINI_API_KEY;

  // 1. Try each Gemini model in order — each has its own quota bucket
  if (geminiKey) {
    for (const model of GEMINI_MODELS) {
      try {
        console.log(`Trying ${model}…`);
        const result = await tryGeminiModel(model, base64Image, mediaType, geminiKey);
        console.log(`Success with ${model}`);
        return res.status(200).json({ ...result, _provider: model });
      } catch (err) {
        if (err.quota) {
          console.log(`${model} quota hit, trying next…`);
          continue; // try next model
        }
        // Non-quota error (bad image, parse failure, etc.) — stop trying Gemini
        console.log(`${model} non-quota error: ${err.message}`);
        break;
      }
    }
  }

  // 2. Fall back to Claude
  console.log('All Gemini models exhausted — trying Claude…');
  try {
    const result = await tryClaude(base64Image, mediaType);
    return res.status(200).json({ ...result, _provider: 'claude' });
  } catch (claudeErr) {
    return res.status(500).json({
      error: claudeErr.message,
      hint: 'All AI providers failed. Gemini quota may be exhausted and Claude credits may need topping up at console.anthropic.com.'
    });
  }
};
