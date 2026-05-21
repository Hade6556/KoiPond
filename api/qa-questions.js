import { ANTHROPIC_API_KEY, ANTHROPIC_MODEL, languageDirective } from './_shared.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const FALLBACK = [
    { q: 'Walk me through how you get the first 100 customers. Distribution is where most of these die.' },
    { q: 'What stops three other founders from launching the same thing next quarter?' },
    { q: 'Why now? Why has no one with more capital and distribution already done this?' }
  ];

  try {
    const { transcript, scenario, weakArea, language } = req.body || {};
    const langDirective = languageDirective(language);
    const cleanedT = (transcript || '').trim();
    const wordCount = cleanedT ? cleanedT.split(/\s+/).filter(w => w.length > 1).length : 0;

    if (wordCount < 30) {
      res.status(200).json({ questions: FALLBACK, source: 'fallback' });
      return;
    }
    if (!ANTHROPIC_API_KEY) {
      res.status(200).json({ questions: FALLBACK, source: 'fallback', warning: 'anthropic_unconfigured' });
      return;
    }

    const investor = scenario?.investor || 'Sarah Chen — Partner @ Vanguard Capital';
    const style    = scenario?.style    || 'Direct · interruptive';
    const stage    = scenario?.title    || 'Seed pitch';
    const weakLine = weakArea ? `\nThe pitch was weakest on: ${weakArea}. Drill that.` : '';

    const systemPrompt = `You are "${investor}". Your style: ${style}.

After hearing a 2-minute founder pitch, you ask EXACTLY 3 follow-up questions designed to expose what's weakest about the pitch.

ABSOLUTE RULES:
1. Each question MUST anchor to something specific the founder actually said. Quote one of their phrases or numbers verbatim inside the question, in quotes. If they used no specific numbers/names, name the slot they skipped ("you didn't mention competition — name your top 3").
2. NEVER ask generic textbook questions like "what is your business model?" — only ask things the actual pitch invites.
3. Each question is answerable in 30–60 seconds out loud.
4. Order hardest-first: Q1 punctures the wedge, Q2 attacks distribution/traction, Q3 forces a commitment (timing, ask, close).
5. Stay in character — match the persona's style.${weakLine}

OUTPUT — STRICT JSON, no markdown, no preamble:
{ "questions": [ { "q": "..." }, { "q": "..." }, { "q": "..." } ] }
Start with { immediately.${langDirective}`;

    const userMsg = `<scenario>
Investor: ${investor}
Style: ${style}
Stage: ${stage}
</scenario>

<pitch_transcript>
${cleanedT.slice(0, 6000)}
</pitch_transcript>

Generate 3 personalized follow-up questions tied to this specific pitch. Return JSON only.`;

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 800,
        system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: userMsg }]
      })
    });

    if (!r.ok) {
      const err = await r.text();
      console.error('[qa-questions Anthropic]', r.status, err.slice(0, 300));
      res.status(200).json({ questions: FALLBACK, source: 'fallback', warning: `anthropic_${r.status}` });
      return;
    }

    const data = await r.json();
    const text = data?.content?.[0]?.text || '';
    let parsed;
    try {
      const m = text.match(/\{[\s\S]*\}/);
      parsed = m ? JSON.parse(m[0]) : null;
    } catch (e) {
      console.error('[qa-questions parse]', e?.message, text.slice(0, 300));
    }

    const items = Array.isArray(parsed?.questions) ? parsed.questions.filter(x => x && typeof x.q === 'string' && x.q.trim().length >= 12) : [];
    while (items.length < 3) items.push(FALLBACK[items.length]);

    res.status(200).json({ questions: items.slice(0, 3), source: 'ai' });
  } catch (err) {
    console.error('[qa-questions handler]', err);
    res.status(500).json({ error: err.message });
  }
}
