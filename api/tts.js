import { FISH_API_KEY, FISH_VOICE_ID } from './_shared.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!FISH_API_KEY) {
    res.status(500).json({ error: 'FISH_API_KEY is not configured on the server.' });
    return;
  }

  try {
    const { text } = req.body || {};
    if (!text || typeof text !== 'string' || text.length > 4000) {
      res.status(400).json({ error: 'Provide a "text" string up to 4000 chars.' });
      return;
    }

    const fishRes = await fetch('https://api.fish.audio/v1/tts', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${FISH_API_KEY}`,
        'Content-Type':  'application/json',
        'model':         's2-pro'
      },
      body: JSON.stringify({
        text,
        reference_id: FISH_VOICE_ID,
        format: 'mp3',
        prosody: { speed: 1.0, normalize_loudness: true },
        mp3_bitrate: 128
      })
    });

    if (!fishRes.ok) {
      const err = await fishRes.text();
      console.error('[Fish TTS]', fishRes.status, err);
      res.status(fishRes.status).json({ error: `Fish Audio: ${err}` });
      return;
    }

    const buf = Buffer.from(await fishRes.arrayBuffer());
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', buf.length);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).send(buf);
  } catch (err) {
    console.error('[TTS handler]', err);
    res.status(500).json({ error: err.message });
  }
}
