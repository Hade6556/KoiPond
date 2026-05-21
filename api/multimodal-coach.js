import {
  GEMINI_API_KEY,
  GEMINI_MODEL,
  GEMINI_FALLBACK_MODEL,
  SHARK_VISUAL_PROMPT,
  languageDirective
} from './_shared.js';

// Vercel's POST body cap is 4.5 MB on Hobby & Pro. We used to inline a full
// WebM camera recording (multi-MB) and got rejected with HTTP 413 before this
// handler ran. The browser now samples small JPEG keyframes during the pitch
// and POSTs an array of {t, b64} — ~30 frames × ~50 KB ≈ 1.5 MB max, well
// inside the limit. Gemini analyzes posture, eye contact, reading-from-script
// etc. fine from a sparse frame sequence; we trade continuous motion for
// shipability on serverless.
export const config = {
  api: {
    bodyParser: { sizeLimit: '4.5mb' }
  }
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!GEMINI_API_KEY) {
    res.status(500).json({ error: 'GEMINI_API_KEY is not configured on the server.' });
    return;
  }

  try {
    const { camera_frames, transcript, scenario, slides, timings, language } = req.body || {};
    const langDirective = languageDirective(language);

    const frames = Array.isArray(camera_frames)
      ? camera_frames.filter(f => f && typeof f.b64 === 'string' && f.b64.length > 0)
      : [];

    if (frames.length < 3) {
      res.status(200).json({
        error: 'insufficient_video',
        message: `Only ${frames.length} keyframes received. Pitch for at least 30 seconds with the camera on.`
      });
      return;
    }

    // Cap on server side too — protects Gemini from a misbehaving client and
    // keeps total inline part bytes well under Gemini's 20 MB request ceiling.
    const MAX_FRAMES_SERVER = 32;
    const capped = frames.length > MAX_FRAMES_SERVER
      ? frames.filter((_, i) => i % Math.ceil(frames.length / MAX_FRAMES_SERVER) === 0).slice(0, MAX_FRAMES_SERVER)
      : frames;

    // Sort by timestamp so Gemini sees the pitch in temporal order regardless
    // of how the client packed them.
    capped.sort((a, b) => (a.t || 0) - (b.t || 0));

    const parts = [];
    let runningInline = 0;
    const frameTimes = [];

    for (const f of capped) {
      const fBytes = Math.ceil(f.b64.length * 0.75);
      if (runningInline + fBytes > 18 * 1024 * 1024) {
        console.warn('[Gemini] frame budget hit, dropping remaining frames');
        break;
      }
      parts.push({ inline_data: { mime_type: 'image/jpeg', data: f.b64 } });
      runningInline += fBytes;
      frameTimes.push(Math.round((f.t || 0) / 1000));
    }
    console.log(`[Gemini] sending ${parts.length} camera frames at t=${frameTimes.join(',')}s · ${(runningInline/1024/1024).toFixed(2)}MB`);

    const slideList = Array.isArray(slides) ? slides.filter(s => s && s.b64).slice(0, 12) : [];
    const sentSlides = [];
    for (const s of slideList) {
      const sBytes = Math.ceil(s.b64.length * 0.75);
      if (runningInline + sBytes > 19 * 1024 * 1024) break;
      parts.push({ inline_data: { mime_type: 'image/jpeg', data: s.b64 } });
      runningInline += sBytes;
      sentSlides.push(s.page);
    }
    console.log('[Gemini] sending', sentSlides.length, 'slides:', sentSlides);

    const frameContext = frameTimes.length
      ? `\nThe first ${frameTimes.length} attached images are CAMERA KEYFRAMES of the founder taken during the pitch at timestamps (seconds from start): ${frameTimes.join(', ')}. Read posture, eye contact, reading-from-script, and overall presence from this sparse sequence — motion is unavailable, but composition is.`
      : '';
    const slideContext = sentSlides.length
      ? `\nThe ${sentSlides.length} images AFTER the camera frames are SLIDE THUMBNAILS from the founder's deck, in order (pages ${sentSlides.join(', ')}). Critique each slide individually in slide_analysis.`
      : '';
    const timingContext = (timings && timings.length)
      ? `\nSlide navigation timing (ms from pitch start): ${timings.map(t => `p${t.page}@${Math.round(t.t/1000)}s`).join(', ')}.`
      : '';

    parts.push({
      text:
`<scenario>
Investor persona: ${scenario?.investor || 'Sarah Chen — Partner @ Vanguard Capital'}
Stage: ${scenario?.title || 'Seed pitch'}
Style: ${scenario?.style || 'Direct · interruptive'}
</scenario>

<transcript>
${(transcript || '(no transcript)').slice(0, 4000)}
</transcript>
${frameContext}${slideContext}${timingContext}

Analyze the founder's pitch DELIVERY based on the camera keyframes, the transcript, and any slide thumbnails above. Return your structured visual feedback as JSON. Start with { immediately.`
    });

    const callGemini = async (model) => {
      const generationConfig = {
        temperature: 0.55,
        maxOutputTokens: 6000,
        responseMimeType: 'application/json'
      };
      if (model.includes('2.5')) {
        generationConfig.thinkingConfig = { thinkingBudget: 0 };
      }
      return fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SHARK_VISUAL_PROMPT + langDirective }] },
          contents: [{ role: 'user', parts }],
          generationConfig
        })
      });
    };

    let geminiRes = await callGemini(GEMINI_MODEL);
    let usedModel = GEMINI_MODEL;
    if (geminiRes.status === 503 || geminiRes.status === 429) {
      console.warn(`[Gemini] ${geminiRes.status} on ${GEMINI_MODEL} — retrying in 1.5s`);
      await new Promise(r => setTimeout(r, 1500));
      geminiRes = await callGemini(GEMINI_MODEL);
    }
    if (geminiRes.status === 503 || geminiRes.status === 429) {
      console.warn(`[Gemini] still ${geminiRes.status} — falling back to ${GEMINI_FALLBACK_MODEL}`);
      geminiRes = await callGemini(GEMINI_FALLBACK_MODEL);
      usedModel = GEMINI_FALLBACK_MODEL;
    }

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error('[Gemini]', geminiRes.status, 'model:', usedModel, errText.slice(0, 500));
      res.status(geminiRes.status).json({ error: `Gemini (${usedModel}): ${errText.slice(0, 500)}` });
      return;
    }
    console.log(`[Gemini] OK on ${usedModel}`);
    console.log(`[multimodal] received: cam=${(camBytes/1024/1024).toFixed(2)}MB, slides=${sentSlides.length}, transcript=${(transcript||'').length}ch`);

    const data = await geminiRes.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    console.log(`[multimodal] Gemini response: ${text.length} chars, finishReason=${data?.candidates?.[0]?.finishReason || '?'}`);
    if (data?.promptFeedback?.blockReason) {
      console.warn('[multimodal] Gemini blocked:', data.promptFeedback);
    }

    const finishReason = data?.candidates?.[0]?.finishReason;
    let visual;
    try {
      const m = text.match(/\{[\s\S]*\}/);
      visual = m ? JSON.parse(m[0]) : null;
    } catch (e) {
      console.error('[multimodal] JSON parse failed:', e.message, '· text head:', text.slice(0, 300));
    }
    if (!visual) {
      console.warn('[multimodal] no structured output. finishReason=', finishReason, '· raw head:', text.slice(0, 400));
      res.status(200).json({
        error:   finishReason === 'MAX_TOKENS' ? 'truncated' : 'no_structured_output',
        message: finishReason === 'MAX_TOKENS'
          ? 'Gemini ran out of output budget mid-response — the visual analysis was cut off. Retry the pitch.'
          : `Gemini returned an unparseable response (finishReason=${finishReason || 'unknown'}).`,
        finishReason,
        raw: text.slice(0, 600)
      });
      return;
    }
    console.log(`[multimodal] parsed OK. fields: ${Object.keys(visual).join(', ')}, presence=${visual.overall_presence}, slides=${visual.slide_analysis?.length || 0}`);

    res.status(200).json(visual);
  } catch (err) {
    console.error('[multimodal handler]', err);
    res.status(500).json({ error: err.message });
  }
}
