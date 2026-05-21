import {
  GEMINI_API_KEY,
  GEMINI_MODEL,
  GEMINI_FALLBACK_MODEL,
  SHARK_VISUAL_PROMPT,
  languageDirective
} from './_shared.js';

// IMPORTANT: Vercel's platform body limit is 4.5 MB on Hobby & Pro
// (Enterprise can lift it). The original Node server allowed 40 MB. Anything
// larger than ~4.5 MB will be rejected by the platform with HTTP 413 BEFORE
// this function executes — no code change can fix that. Future work: have the
// browser upload videos directly to Supabase Storage and POST a signed URL
// here instead of inline base64. For now this works for short clips only.
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
    const { camera_b64, screen_b64, transcript, scenario, slides, timings, language } = req.body || {};
    const langDirective = languageDirective(language);

    if (!camera_b64) {
      res.status(200).json({ error: 'insufficient_video', message: 'No camera recording was captured.' });
      return;
    }
    const camBytes = Math.ceil(camera_b64.length * 0.75);
    if (camBytes < 400 * 1024) {
      res.status(200).json({
        error: 'insufficient_video',
        message: `Camera clip too short to analyze (${(camBytes/1024).toFixed(0)} KB). Pitch for at least 30 seconds with the camera on.`
      });
      return;
    }
    if (camBytes > 18 * 1024 * 1024) {
      res.status(413).json({ error: `Camera video too large (${(camBytes/1024/1024).toFixed(1)}MB). Inline limit is ~18MB.` });
      return;
    }

    const parts = [
      { inline_data: { mime_type: 'video/webm', data: camera_b64 } }
    ];
    let runningInline = camBytes;

    if (screen_b64) {
      const scrBytes = Math.ceil(screen_b64.length * 0.75);
      if (runningInline + scrBytes < 17 * 1024 * 1024) {
        parts.push({ inline_data: { mime_type: 'video/webm', data: screen_b64 } });
        runningInline += scrBytes;
      } else {
        console.warn('[Gemini] dropping screen video to fit inline budget:', (scrBytes/1024/1024).toFixed(1) + 'MB');
      }
    }

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

    const slideContext = sentSlides.length
      ? `\nThe founder is presenting a slide deck. ${sentSlides.length} slide thumbnails are attached as images, in order (pages ${sentSlides.join(', ')}). Critique each slide individually in slide_analysis.`
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
${slideContext}${timingContext}

Analyze the founder's pitch DELIVERY based on the video(s) and any slide thumbnails above. Return your structured visual feedback as JSON. Start with { immediately.`
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
