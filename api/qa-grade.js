import { ANTHROPIC_API_KEY, ANTHROPIC_MODEL, languageDirective } from './_shared.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!ANTHROPIC_API_KEY) {
    res.status(500).json({ error: 'ANTHROPIC_API_KEY is not configured on the server.' });
    return;
  }

  try {
    const { question, answer, scenario, transcript, language } = req.body || {};
    const cleanA = (answer || '').trim();
    const words  = cleanA ? cleanA.split(/\s+/).filter(w => w.length > 1).length : 0;
    if (!cleanA || words < 5) {
      res.status(200).json({ error: 'insufficient_answer', message: `Need at least 5 words. Got ${words}.` });
      return;
    }

    const langDirective = languageDirective(language);
    const systemPrompt = `You are "The Shark" grading a single founder Q&A answer in an investor pitch. Score on five dimensions, each on a 0–10 scale.

DIMENSIONS:
- direct  — answered the literal question without dodging
- evid    — concrete evidence: numbers, specific examples, named entities
- clarity — single clear thesis, not vague waffle
- conf    — confident delivery, no hedge words ("kinda", "I guess", "maybe")
- pers    — persuasive, made the investor more likely to invest

CONSISTENCY CHECK: if the answer contradicts a number, claim, or commitment the founder made in their original pitch (provided in <pitch_transcript>), penalize "direct" and "conf" and call it out in the note.

Return STRICT JSON only. Schema:
{ "scores": { "direct": 0-10, "evid": 0-10, "clarity": 0-10, "conf": 0-10, "pers": 0-10 }, "note": "one-sentence critique under 30 words" }

No preamble. Start with {.${langDirective}`;

    const transcriptBlock = transcript
      ? `\n\n<pitch_transcript>\n${String(transcript).slice(0, 3000)}\n</pitch_transcript>`
      : '';
    const userMsg = `<scenario>\nInvestor: ${scenario?.investor || 'Sarah Chen — Partner @ Vanguard Capital'}\nContext: ${scenario?.title || 'Seed pitch Q&A'}\n</scenario>${transcriptBlock}\n\n<question>\n${question}\n</question>\n\n<answer>\n${cleanA.slice(0, 3000)}\n</answer>\n\nGrade this answer. Return JSON only.`;

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 400,
        system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: userMsg }]
      })
    });
    if (!r.ok) {
      const err = await r.text();
      console.error('[qa-grade Anthropic]', r.status, err);
      res.status(r.status).json({ error: `Anthropic: ${err}` });
      return;
    }
    const data = await r.json();
    const text = data?.content?.[0]?.text || '';
    let parsed;
    try {
      const m = text.match(/\{[\s\S]*\}/);
      parsed = m ? JSON.parse(m[0]) : null;
    } catch (e) {
      console.error('[qa-grade parse]', e, text.slice(0, 400));
    }
    if (!parsed?.scores) {
      res.status(502).json({ error: 'no_structured_output', raw: text.slice(0, 400) });
      return;
    }
    res.status(200).json(parsed);
  } catch (err) {
    console.error('[qa-grade handler]', err);
    res.status(500).json({ error: err.message });
  }
}
