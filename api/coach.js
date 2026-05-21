import {
  ANTHROPIC_API_KEY,
  ANTHROPIC_MODEL,
  SHARK_SYSTEM_PROMPT,
  languageDirective
} from './_shared.js';

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
    const { transcript, scenario, language } = req.body || {};
    const langDirective = languageDirective(language);
    const cleanedT = (transcript || '').trim();
    const wordCount = cleanedT ? cleanedT.split(/\s+/).filter(w => w.length > 1).length : 0;
    if (!cleanedT || cleanedT.length < 80 || wordCount < 30) {
      res.status(200).json({
        error: 'insufficient_pitch',
        message: `Need at least 30 words of pitch content. Got ${wordCount}. Try again with a real pitch.`
      });
      return;
    }

    const userMessage =
`<scenario>
Investor persona: ${scenario?.investor || 'Sarah Chen — Partner @ Vanguard Capital'}
Stage / scenario: ${scenario?.title || 'Seed pitch'}
Style: ${scenario?.style || 'Direct · interruptive'}
Focus: ${scenario?.focus || 'B2B SaaS · AI infra'}
</scenario>

<pitch_transcript>
${cleanedT.slice(0, 6000)}
</pitch_transcript>

Analyze this pitch as if YOU were ${scenario?.investor || 'Sarah Chen'} and return your structured Idea Validator feedback as JSON. Start your response with { immediately, no preamble.`;

    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 2000,
        system: [
          { type: 'text', text: SHARK_SYSTEM_PROMPT + langDirective, cache_control: { type: 'ephemeral' } }
        ],
        messages: [{ role: 'user', content: userMessage }]
      })
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      console.error('[Anthropic]', anthropicRes.status, errText);
      res.status(anthropicRes.status).json({ error: `Anthropic: ${errText}` });
      return;
    }

    const data = await anthropicRes.json();
    const text = data?.content?.[0]?.text || '';
    let coach;
    try {
      const m = text.match(/\{[\s\S]*\}/);
      coach = m ? JSON.parse(m[0]) : null;
    } catch (e) {
      console.error('[Coach JSON parse]', e, text.slice(0, 500));
    }
    if (!coach || !coach.script) {
      res.status(502).json({ error: 'Coach returned no structured output', raw: text.slice(0, 600) });
      return;
    }

    res.status(200).json(coach);
  } catch (err) {
    console.error('[coach handler]', err);
    res.status(500).json({ error: err.message });
  }
}
