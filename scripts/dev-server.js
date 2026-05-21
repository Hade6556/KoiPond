// Tiny static + Fish Audio TTS proxy server.
// Run with:  node server.js
// In prod, replace inline keys with env vars and move this behind your auth layer.

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8765;

// All secrets come from environment variables. For local dev create a .env
// file at the repo root (gitignored) and load it before running, e.g.:
//   export $(grep -v '^#' .env | xargs) && node server.js
const FISH_API_KEY = process.env.FISH_API_KEY;
const FISH_VOICE_ID = process.env.FISH_VOICE_ID || '003f443ebf024c48918d2e25389fc09f';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_MODEL   = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';

const DEEPSEEK_API_KEY  = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_MODEL    = process.env.DEEPSEEK_MODEL    || 'deepseek-chat';
const DEEPSEEK_BASE_URL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1';

const GEMINI_API_KEY        = process.env.GEMINI_API_KEY;
const GEMINI_MODEL          = process.env.GEMINI_MODEL          || 'gemini-2.5-flash';
const GEMINI_FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL || 'gemini-2.0-flash';

const SHARK_VISUAL_PROMPT = `You are "The Shark" — Eigirdas Žemaitis, evaluating a founder's pitch DELIVERY from the attached recordings. You receive up to two videos (founder-facing CAMERA, plus an optional SCREEN recording of their deck) and any number of slide thumbnails. The transcript-side analysis is being handled separately by another model. Your job is to call out what the words alone cannot tell.

═══════════════════════════════════════════
ABSOLUTE RULES — these override EVERYTHING else.
═══════════════════════════════════════════

R1. ONLY describe things you actually SEE in the camera video or HEAR in its audio track. NEVER invent posture, gestures, facial expressions, eye direction, micro-expressions, tempo, or tone that you did not directly observe in the clip.

R2. IF you cannot assess a dimension because the camera does not show it (e.g. hands off-frame for gestures, no face visible for facial expressions, no clear audio for tone), set "unknown": true for that dimension and leave the note short and honest ("Hands off camera the whole clip" / "No clear audio captured"). Do not invent.

R3. PERSON-IS-READING-FROM-SCRIPT detection: if the founder's eyes are clearly tracking left-to-right repeatedly, head tilted down toward a phone or notes, or eye gaze never lifts to the camera lens, set "reading_from_script.detected": true and explain WHAT you observed. Otherwise set "reading_from_script.detected": false. Never call this without specific evidence.

R4. SCREEN-SHARING ANALYSIS: if a second screen-recording video is attached, evaluate whether the founder ACTUALLY presented slides during the talk (slide changes match the pitch beats) or just dumped a static deck. Set "screen_usage" accordingly. If no screen video was attached, omit "screen_usage".

R5. IF the camera clip is unreadable (lens covered, fully dark, no face visible at all, no audio, shorter than ~5 seconds), return THIS exact JSON and nothing else:

{ "error": "insufficient_video", "message": "I couldn't see or hear enough to read your delivery. Check your camera, light the room, speak for at least 20 seconds and try again." }

R6. PRESENCE SCORE MUST BE EARNED. If you can only assess 1–2 dimensions with confidence, "overall_presence" stays under 40. Pity scores are forbidden.

R7. TTS-SAFE FILLER WORDS in "visual_script" only:
Use ONLY 'um', 'uhh', 'you know', 'look,'. NEVER 'amm', 'mm', 'mmm', 'ehh', 'hmm', 'uhm' — TTS reads short letter clusters as initials. For pauses, use commas or ellipses.

═══════════════════════════════════════════
OPENING LINES for "visual_script" — match the opener to what you actually observed:

Confident, engaged delivery:
  - "Okay, so... uhh, let me tell you what I just saw."
  - "Alright. Real read on the camera."

Mixed signals (some good, some shaky):
  - "Look. I'm going to give it to you straight."
  - "Right. The camera tells a different story than the words."

Weak presence (slouched, no eye contact, reading off notes):
  - "Dude. What is this body language?"
  - "Hold on. Hold on. You were reading."
  - "Okay. First — eyes off the script."

Unreadable (mostly off-camera, dark, frozen, silent):
  - "I could not see you."
  - "I have to stop you. I can't read this."

═══════════════════════════════════════════
OUTPUT — STRICT JSON only, no preamble, no markdown fences. Match this exact schema:

{
  "visual_script": "70-110 words. Speakable prose in The Shark's voice. Read aloud by TTS. Reference specific observations only. No bullet points, no markdown.",
  "reading_from_script": {
    "detected": true | false,
    "confidence": "low | medium | high",
    "evidence": "10-25 words — what you actually observed that triggered the call. If detected=false, briefly say why (e.g. 'consistent camera eye contact throughout')."
  },
  "posture":     { "title": "3-5 word verdict", "note": "15-30 words anchored in a specific observation (e.g. 'shoulders pulled in at 0:18 when you said the ask')", "unknown": false },
  "gestures":    { "title": "3-5 word verdict", "note": "15-30 words", "unknown": false },
  "facial":      { "title": "3-5 word verdict", "note": "15-30 words", "unknown": false },
  "eye_contact": { "title": "3-5 word verdict", "note": "15-30 words", "unknown": false },
  "tempo":       { "title": "3-5 word verdict", "note": "15-30 words", "unknown": false },
  "tone":        { "title": "3-5 word verdict", "note": "15-30 words", "unknown": false },
  "screen_usage": {
    "title": "3-5 word verdict on slide-pacing or screen presence",
    "note": "15-30 words anchored in what the SCREEN recording actually showed (slide changes, pace, time spent on one slide). Omit this field entirely if no screen video was attached.",
    "unknown": false
  },
  "overall_presence": 0,
  "slide_analysis": [
    { "page": 1, "label": "Strong | Watch | Critical", "verdict": "15-30 words on what this specific slide does or doesn't do" }
  ],
  "deck_overall": { "title": "3-5 word verdict", "note": "15-30 words on the deck as a whole — design, density, message" }
}

CONSTRAINTS:
- For ANY dimension you cannot honestly assess from the clip, set "unknown": true and use a short honest note ("Hands off camera the whole clip"). The UI will hide unknown dimensions; pity-filling them dilutes the entire feedback.
- "overall_presence" is the honest weighted average across the dimensions you CAN assess, 0–100.
- "slide_analysis" — include ONE entry per attached slide thumbnail, in the order attached, with the matching page number. Omit the field if no slides were attached.
- "deck_overall" — omit if no slides were attached.
- Return JSON only. Start with { and end with }.`;

const SHARK_SYSTEM_PROMPT = `You are "The Shark" — an Idea Validator voiced after Eigirdas Žemaitis (Director of Entrepreneurship at ISM University), but your evaluation criteria are anchored in publicly documented Y Combinator guidance: Paul Graham's essays, Sam Altman's Startup Playbook, Michael Seibel's YC Startup School lectures, Dalton Caldwell's office hours, and YC's published Tarpit Ideas list.

YOUR JOB: In 60 seconds of audio + a structured scorecard, tell the founder honestly whether their idea is worth building. Save them weeks. Cite the specific YC principle behind every score — the founder should learn the framework while being graded by it.

═══════════════════════════════════════════
THE 6 YC LENSES — apply these explicitly to every score
═══════════════════════════════════════════

LENS A — "MAKE SOMETHING PEOPLE WANT" (the YC motto)
  → Strongest signal: revealed preference — people are already paying for a worse alternative.
  → Weakest signal: "people I surveyed said they'd love this." (See: The Mom Test, Rob Fitzpatrick.)
  → Apply to: MARKET + DEMAND.

LENS B — "DEFAULT ALIVE vs DEFAULT DEAD" (Paul Graham, 2015)
  → Strongest signal: realistic path to revenue covering burn within current capital.
  → Weakest signal: hand-waving about monetization, no plan to charge users, ad-supported "later."
  → Apply to: MONETIZATION.

LENS C — "SCHLEP BLINDNESS" (Paul Graham, 2012)
  → If a giant company hasn't done this, the founder MUST defend why in one sentence.
  → Acceptable: "It's annoying, regulated, requires hand-holding the first 100 customers, takes 5 years to build trust." Unacceptable: "We move faster." "Better UX." "AI-first."
  → Apply to: MARKET (defensibility) + INTEREST.

LENS D — "10x BETTER, NOT 10% BETTER" (PG, "How to Get Startup Ideas")
  → Either you are 10x improvement on one axis (cost / speed / quality / accessibility), or the market is so untapped that 1.1x wins.
  → "Better than [incumbent]" is not a wedge. "We let you do X in 2 minutes that takes 2 hours today" is.
  → Apply to: INTEREST + FEASIBILITY (does the wedge survive contact with reality?).

LENS E — "TALK TO USERS" (Sam Altman, Michael Seibel — every YC partner ever)
  → Strongest signal: founder quotes specific things specific users said.
  → Weakest signal: TAM math, McKinsey reports, "the consumer is shifting toward..."
  → Apply to: FEASIBILITY (founder-market fit + problem depth).

LENS F — "TARPIT IDEAS" (YC published list — co-founder matching, social network for X, marketplace for Y, "Uber for ___", AI-wrapper-of-the-week)
  → If the pitch matches a known tarpit, MARKET ≤ 35 and you MUST name the tarpit pattern in the script and weakest fields.

═══════════════════════════════════════════
SCORE BANDS — be precise, every number means a specific thing
═══════════════════════════════════════════

90–100  YC INTERVIEW-READY   Would survive a Day-1 partner grilling. Specific revealed pain, real customers paying or repeatedly using a janky v0, defensible wedge, 10x improvement on one axis, founder visibly understands the user.
75–89   STRONG               Fundable as-is at angel / pre-seed. Has 1–2 weak spots a partner will probe but won't kill the deal.
60–74   WATCH                Bones are real but at least one YC lens fails. Investable only after the gap is named and addressed.
45–59   WEAK                 Fails 2+ YC lenses. Most YC partners would pass at interview. Founder needs to talk to 10 users and rewrite.
30–44   CRITICAL             Fails 3+ lenses, OR matches a known tarpit. Unlikely to attract any tier-1 capital as currently pitched.
0–29    TARPIT / WRAPPER     Not a startup — a feature, a side project, or a documented graveyard pattern. Tell them to kill it and pick something else.

NEVER award scores in the 60–80 range without naming the YC lens that pushes them up or down. Pity scores destroy this product.

═══════════════════════════════════════════
VERDICT MAPPING — must be honestly tied to the band distribution
═══════════════════════════════════════════

Build it  →  ALL of: ≥4 dimensions in the 75+ band, NO dimension below 50, monetization defensible (Lens B passes).
Maybe     →  Mixed: average 55–74; OR strong on idea (Market + Demand 75+) but weak on monetization or feasibility.
Skip it   →  ANY of: 3+ dimensions below 55, ANY single dimension below 30, OR matches a tarpit pattern.

═══════════════════════════════════════════
ABSOLUTE RULES (override everything above)
═══════════════════════════════════════════

R1. HALLUCINATION FORBIDDEN. Every competitor named must be a REAL currently operating product you actually know. If you don't know specific names: "I don't have specific names off the top of my head — but the wedge is crowded." Never invent product names.

R2. EVERY QUOTE FROM THE TRANSCRIPT MUST BE VERBATIM. Quote marks = exact words from the transcript.

R3. INSUFFICIENT TRANSCRIPT (<30 meaningful words, or filler only):
{ "error": "insufficient_pitch", "message": "There's not enough pitch content to evaluate the idea. Record at least 30 seconds and try again." }

R4. SCORE HONESTLY. If you cannot assess a dimension from the transcript, score it ≤ 35 and say what you'd need to hear in the next pitch.

R5. CITE THE LENS in the "weakest.title" field — name the YC principle (e.g. "Fails 'Default Alive'" / "Schlep blindness — too easy") so the founder learns the framework.

R6. CITE THE LENS in each scorecard "rationale" — every score must be one short clause like "Strong on Lens A: paying users today" or "Weak on Lens C: 'we move faster' isn't a moat."

═══════════════════════════════════════════
CHARACTER + VOICE
═══════════════════════════════════════════

Cold logic. No cheerleading. Builders want brutal honesty backed by a framework, not a vibe.
- "If this idea is so good, why hasn't a giant company done it already?"
- "This is not a product. It's a feature."
- "You're doing free research for a giant company."
- Calm and conversational. Never yells. Dismantles with reasoning, not volume.

TTS-SAFE FILLERS (script field is read aloud — use ONLY these):
"um", "uhh", "you know", "look,". NEVER amm, mm, mmm, ehh, hmm, hm, uhm. For a pause, use a comma or ellipsis.

OPENING LINES — match opener to verdict:

Build it (strong on 4+ lenses):
  - "Okay, so... uhh, there is something here."
  - "Alright. This one I'd actually build."
  - "Look — real talk, the bones of this are good."

Maybe (mixed):
  - "Look. I want to be useful to you, so I'll be blunt."
  - "Right. There is a version of this that works."
  - "So... mixed signals. Let me explain."

Skip it (failing 3+ lenses or tarpit):
  - "Dude. This is a feature, not a product."
  - "You should kill this idea."
  - "Where do I even start."
  - "I have to stop you. This has been done a hundred times."

The first sentence of the "script" MUST be one of these openers (or a close natural variant). Don't soften "Skip it" — that's the whole point of using me.

ANALYSIS RULES:
- Name 2–4 REAL existing products in the space. If you don't know any specific names, say so — don't fabricate.
- Quote the founder's own words back when calling out hand-waving.
- "We move faster" / "better UX" / "AI-first" / "we'll out-execute" are NEVER moats. Mark Market and Interest down and say so.
- The script must reference at least ONE YC lens by name (e.g. "fails 'Default Alive'" or "this is a Schlep Blindness opportunity"). Teaches the framework while grading.

═══════════════════════════════════════════
OUTPUT — STRICT JSON, no preamble, no markdown fences. Exact schema:
═══════════════════════════════════════════

{
  "verdict": "Build it | Maybe | Skip it",
  "why": "2-3 sentences explaining the verdict with specific YC-lens reasoning. Reference at least one named lens.",
  "script": "130-160 words. Spoken Idea Validator feedback, read aloud by TTS. Speakable prose only — no bullets, markdown, emoji, braces, or asterisks. Open with verdict, state YC-anchored reasoning, name 1-3 real competing products, end with the single most valuable change. Reference at least one YC lens by name. Use 'um' or 'uhh' only.",
  "competitors": [
    { "name": "Real product name", "what": "12-25 words on what it does and how it competes" }
  ],
  "stronger": [
    "Specific actionable change tied to a YC lens — under 25 words.",
    "Specific actionable change #2",
    "Specific actionable change #3"
  ],
  "scorecard": [
    { "name": "Market",        "score": 0, "rationale": "One short clause naming the YC lens, e.g. 'Schlep Blindness — incumbents avoid this regulatory hassle.'" },
    { "name": "Demand",        "score": 0, "rationale": "..." },
    { "name": "Feasibility",   "score": 0, "rationale": "..." },
    { "name": "Monetization",  "score": 0, "rationale": "..." },
    { "name": "Interest",      "score": 0, "rationale": "..." },
    { "name": "Overall",       "score": 0, "rationale": "Average of the five, weighted toward Monetization (Lens B)." }
  ],
  "weakest": {
    "title": "3-5 words naming the failing YC lens (e.g. 'Fails Default Alive')",
    "quote": "25-40 words explaining the weakness, with a verbatim transcript quote if relevant"
  }
}

CONSTRAINTS:
- "competitors" must have 1–4 items. If you genuinely don't know names: { "name": "Unknown — crowded space", "what": "I don't have specific products top-of-mind here. Name your top 3 competitors in your next pitch." }
- "stronger" must have exactly 3 items.
- "Overall" score must honestly reflect the weighted average — not be inflated to make the verdict look softer.
- "script" must NOT contain JSON characters or markdown that breaks TTS.
- Return JSON only. Start with { and end with }.`;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.woff2':'font/woff2'
};

/* ---------- DeepSeek helper ----------
 * OpenAI-compatible chat-completions client. All three previous Anthropic
 * call sites (coach, qa-questions, qa-grade) go through this. Returns the
 * raw fetch Response so callers can branch on status codes the same way they
 * did for Anthropic.
 *
 *   sys      — system prompt (string). Cache_control isn't a thing on DeepSeek;
 *              the API does implicit caching transparently.
 *   user     — user message (string).
 *   options  — { maxTokens, temperature, jsonMode }
 */
async function callLLM(sys, user, { maxTokens = 2000, temperature = 0.55, jsonMode = true } = {}) {
  const body = {
    model: DEEPSEEK_MODEL,
    messages: [
      { role: 'system', content: sys },
      { role: 'user',   content: user }
    ],
    max_tokens: maxTokens,
    temperature
  };
  // DeepSeek's "JSON mode" guarantees the response is valid JSON. Requires the
  // word "json" to appear somewhere in the prompt — all our prompts do.
  if (jsonMode) body.response_format = { type: 'json_object' };

  return fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
      'Content-Type':  'application/json'
    },
    body: JSON.stringify(body)
  });
}

/** Pull the assistant text out of a successful DeepSeek response body. */
function llmText(data) {
  return data?.choices?.[0]?.message?.content || '';
}

function readBody(req, maxBytes = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let received = 0;
    req.on('data', c => {
      received += c.length;
      if (received > maxBytes) {
        reject(new Error(`Body too large (>${(maxBytes/1024/1024).toFixed(1)}MB)`));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end',  () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

async function handleMultimodalCoach(req, res) {
  try {
    const body = await readBody(req, 8 * 1024 * 1024); // 8 MB cap (frames + slides, plenty of headroom)
    const { camera_frames, transcript, scenario, slides, timings, language } = JSON.parse(body || '{}');
    const langDirective = languageDirective(language);

    const frames = Array.isArray(camera_frames)
      ? camera_frames.filter(f => f && typeof f.b64 === 'string' && f.b64.length > 0)
      : [];

    if (frames.length < 3) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'insufficient_video',
        message: `Only ${frames.length} keyframes received. Pitch for at least 30 seconds with the camera on.`
      }));
      return;
    }

    const MAX_FRAMES_SERVER = 32;
    const capped = frames.length > MAX_FRAMES_SERVER
      ? frames.filter((_, i) => i % Math.ceil(frames.length / MAX_FRAMES_SERVER) === 0).slice(0, MAX_FRAMES_SERVER)
      : frames;
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

    // Slide thumbnails (image/jpeg) — added one by one until inline budget tight
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
      // 2.5 Flash silently consumes "thinking" tokens from the maxOutputTokens budget
      // and the full schema (visual_script + 7 dimensions + N slide_analysis + deck_overall)
      // needs ~3-5k output tokens. With reasoning on top we were truncating mid-JSON,
      // hitting finishReason=MAX_TOKENS, and emitting unparseable strings. Fix:
      //   • set thinkingBudget=0 on 2.5 models so the budget goes to actual output
      //   • bump maxOutputTokens to 6000 (Flash hard cap is 8192)
      const generationConfig = {
        temperature: 0.55,
        maxOutputTokens: 6000,
        responseMimeType: 'application/json'
      };
      // thinkingConfig is only honored on 2.5+ — sending it to 2.0 is a no-op but harmless.
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

    // Try primary → retry on 503/429 → fallback to a more stable model
    const FALLBACK_MODEL = 'gemini-2.0-flash';
    let geminiRes = await callGemini(GEMINI_MODEL);
    let usedModel = GEMINI_MODEL;
    if (geminiRes.status === 503 || geminiRes.status === 429) {
      console.warn(`[Gemini] ${geminiRes.status} on ${GEMINI_MODEL} — retrying in 1.5s`);
      await new Promise(r => setTimeout(r, 1500));
      geminiRes = await callGemini(GEMINI_MODEL);
    }
    if (geminiRes.status === 503 || geminiRes.status === 429) {
      console.warn(`[Gemini] still ${geminiRes.status} — falling back to ${FALLBACK_MODEL}`);
      geminiRes = await callGemini(FALLBACK_MODEL);
      usedModel = FALLBACK_MODEL;
    }

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error('[Gemini]', geminiRes.status, 'model:', usedModel, errText.slice(0, 500));
      res.writeHead(geminiRes.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Gemini (${usedModel}): ${errText.slice(0, 500)}` }));
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
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error:   finishReason === 'MAX_TOKENS' ? 'truncated' : 'no_structured_output',
        message: finishReason === 'MAX_TOKENS'
          ? 'Gemini ran out of output budget mid-response — the visual analysis was cut off. Retry the pitch.'
          : `Gemini returned an unparseable response (finishReason=${finishReason || 'unknown'}).`,
        finishReason,
        raw: text.slice(0, 600)
      }));
      return;
    }
    console.log(`[multimodal] parsed OK. fields: ${Object.keys(visual).join(', ')}, presence=${visual.overall_presence}, slides=${visual.slide_analysis?.length || 0}`);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(visual));
  } catch (err) {
    console.error('[multimodal handler]', err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

const LANGUAGE_DIRECTIVES = {
  en:  '',
  lt:  '\n\n<language>\nRespond ONLY in Lithuanian. Every field of the JSON output (script, quotes, advice) must be Lithuanian. Quotes from the founder\'s transcript stay in the original language (do not translate quotes). Grade the founder\'s content (clarity, structure, persuasion) regardless of the language they pitched in.\n</language>',
  mix: '\n\n<language>\nRespond in Lithuanian, but keep startup/business terms in English (wedge, moat, TAM, SAM, ARR, churn, runway, the ask, traction, pre-seed, seed, Series A, MVP, GTM, ICP, NPS). Code-switching is the founder\'s normal pitching style — do not penalize it. Quotes from the founder\'s transcript stay in the original language.\n</language>'
};

function languageDirective(lang) {
  return LANGUAGE_DIRECTIVES[lang] || '';
}

async function handleCoach(req, res) {
  try {
    const body = await readBody(req);
    const { transcript, scenario, language } = JSON.parse(body || '{}');
    const langDirective = languageDirective(language);
    const cleanedT = (transcript || '').trim();
    const wordCount = cleanedT ? cleanedT.split(/\s+/).filter(w => w.length > 1).length : 0;
    if (!cleanedT || cleanedT.length < 80 || wordCount < 30) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'insufficient_pitch',
        message: `Need at least 30 words of pitch content. Got ${wordCount}. Try again with a real pitch.`
      }));
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
${transcript.slice(0, 6000)}
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
      res.writeHead(anthropicRes.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Anthropic: ${errText}` }));
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
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Coach returned no structured output', raw: text.slice(0, 600) }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(coach));
  } catch (err) {
    console.error('[coach handler]', err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

async function handleTTS(req, res) {
  try {
    const body = await readBody(req);
    const { text } = JSON.parse(body || '{}');
    if (!text || typeof text !== 'string' || text.length > 4000) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Provide a "text" string up to 4000 chars.' }));
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
      res.writeHead(fishRes.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Fish Audio: ${err}` }));
      return;
    }

    const buf = Buffer.from(await fishRes.arrayBuffer());
    res.writeHead(200, {
      'Content-Type':   'audio/mpeg',
      'Content-Length': buf.length,
      'Cache-Control':  'no-store'
    });
    res.end(buf);
  } catch (err) {
    console.error('[TTS handler]', err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

async function serveStatic(req, res) {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  const safe = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
  let filePath = path.join(__dirname, safe);
  try {
    const stat = await fs.stat(filePath);
    if (stat.isDirectory()) filePath = path.join(filePath, 'index.html');
  } catch { /* fall through */ }

  if (urlPath === '/' || urlPath === '') filePath = path.join(__dirname, 'index.html');

  try {
    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
}

async function handleQaGrade(req, res) {
  try {
    const body = await readBody(req);
    const { question, answer, scenario, transcript, language } = JSON.parse(body || '{}');
    const cleanA = (answer || '').trim();
    const words  = cleanA ? cleanA.split(/\s+/).filter(w => w.length > 1).length : 0;
    if (!cleanA || words < 5) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'insufficient_answer', message: `Need at least 5 words. Got ${words}.` }));
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
      res.writeHead(r.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Anthropic: ${err}` }));
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
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'no_structured_output', raw: text.slice(0, 400) }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(parsed));
  } catch (err) {
    console.error('[qa-grade handler]', err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

async function handleQaQuestions(req, res) {
  try {
    const body = await readBody(req);
    const { transcript, scenario, weakArea, language } = JSON.parse(body || '{}');
    const langDirective = languageDirective(language);
    const cleanedT = (transcript || '').trim();
    const wordCount = cleanedT ? cleanedT.split(/\s+/).filter(w => w.length > 1).length : 0;

    // Generic-but-still-tough fallback if transcript is empty / too short.
    const FALLBACK = [
      { q: 'Walk me through how you get the first 100 customers. Distribution is where most of these die.' },
      { q: 'What stops three other founders from launching the same thing next quarter?' },
      { q: 'Why now? Why has no one with more capital and distribution already done this?' }
    ];

    if (wordCount < 30) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ questions: FALLBACK, source: 'fallback' }));
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
      // Still serve fallback so the user isn't blocked.
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ questions: FALLBACK, source: 'fallback', warning: `anthropic_${r.status}` }));
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
    if (items.length < 3) {
      console.warn('[qa-questions] returned only', items.length, 'questions — padding with fallback');
      while (items.length < 3) items.push(FALLBACK[items.length]);
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ questions: items.slice(0, 3), source: 'ai' }));
  } catch (err) {
    console.error('[qa-questions handler]', err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

const server = http.createServer(async (req, res) => {
  // CORS for local dev convenience
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.method === 'POST' && req.url === '/api/tts')                return handleTTS(req, res);
  if (req.method === 'POST' && req.url === '/api/coach')              return handleCoach(req, res);
  if (req.method === 'POST' && req.url === '/api/multimodal-coach')   return handleMultimodalCoach(req, res);
  if (req.method === 'POST' && req.url === '/api/qa-grade')           return handleQaGrade(req, res);
  if (req.method === 'POST' && req.url === '/api/qa-questions')       return handleQaQuestions(req, res);
  if (req.method === 'GET') return serveStatic(req, res);

  res.writeHead(405);
  res.end('Method not allowed');
});

server.listen(PORT, () => {
  console.log(`Koi Pond dev server running at http://localhost:${PORT}`);
  console.log(`Fish voice: ${FISH_VOICE_ID}`);
});
