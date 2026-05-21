// Shared Supabase client for the Koi Pond prototype.
// Browser-side SDK loaded from an ESM CDN so the static HTML pages don't need a build step.
// In production: bundle from npm and move SUPABASE_URL / key into env injected at build time.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const SUPABASE_URL = 'https://xnbhzvrchacmgxvlhztg.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_ULBuVqi8EhwM8nVEQU8q5Q_ePqZBslP';

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: 'koipond-auth'
  }
});

/* ---------- helpers ---------- */

export async function getSession() {
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}

export async function getUser() {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export async function getProfile() {
  const user = await getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();
  if (error) console.warn('[supabase] profile fetch:', error.message);
  return data;
}

/** Redirect to landing if no session. Returns the session if present. */
export async function requireAuth(redirectTo = './index.html') {
  const session = await getSession();
  if (!session) {
    window.location.href = redirectTo;
    return null;
  }
  return session;
}

export async function signOut() {
  await supabase.auth.signOut();
  window.location.href = './index.html';
}

/* ---------- profile mutations ---------- */

/** Update profile fields. Returns the updated row. */
export async function updateProfile(patch) {
  const user = await getUser();
  if (!user) throw new Error('Not signed in');
  const allowed = ['name', 'company', 'stage', 'language', 'avatar_url', 'display_handle', 'country', 'leaderboard_opt_in'];
  const clean = Object.fromEntries(
    Object.entries(patch).filter(([k, v]) => allowed.includes(k) && v !== undefined)
  );
  const { data, error } = await supabase
    .from('profiles')
    .update(clean)
    .eq('id', user.id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Update auth email — requires email confirmation flow. */
export async function updateEmail(newEmail) {
  const { data, error } = await supabase.auth.updateUser({ email: newEmail });
  if (error) throw error;
  return data;
}

/** Current language preference. Falls back to 'en'. */
export async function getLanguage() {
  const p = await getProfile();
  return p?.language || 'en';
}

/* ---------- session persistence ---------- */

/** Save a completed practice session and its Q&A turns.
 *  scorecard: optional object { 'Skill name': 0-100, ... } — feeds the Progress page per-skill breakdown.
 *  coachFeedback: optional string — The Shark's script for the next session's insight.
 *  presenceScore: optional 0-100 — Gemini's body-language read; folded into scorecard JSON.
 *  verdict: optional 'Build it' | 'Maybe' | 'Skip it' — folded into scorecard JSON. */
export async function savePitchSession({
  scenarioId, scenarioTitle, transcript, durationSec,
  pitchScore, qaScore, totalScore, weakArea,
  audioUrl = null, qa = [], scorecard = null, coachFeedback = null,
  presenceScore = null, verdict = null
}) {
  const user = await getUser();
  if (!user) throw new Error('Not signed in');

  // Normalize scorecard arrays (e.g. [{name, score}]) into a plain object
  let scorecardJson = scorecard;
  if (Array.isArray(scorecard)) {
    scorecardJson = {};
    scorecard.forEach(s => {
      if (s && typeof s.name === 'string' && typeof s.score === 'number') {
        scorecardJson[s.name] = s.score;
      }
    });
  }
  // Fold AI extras into the same JSONB blob so the Progress page can surface them
  // without a schema change. Numeric scores live alongside string-tagged metadata.
  if (presenceScore != null && (scorecardJson || presenceScore != null)) {
    scorecardJson = scorecardJson || {};
    scorecardJson.Presence = presenceScore;
  }
  if (verdict) {
    scorecardJson = scorecardJson || {};
    scorecardJson.__verdict = verdict;
  }

  const { data: session, error } = await supabase
    .from('pitch_sessions')
    .insert({
      user_id: user.id,
      scenario_id: scenarioId,
      scenario_title: scenarioTitle,
      transcript,
      duration_sec: durationSec,
      pitch_score: pitchScore,
      qa_score: qaScore,
      total_score: totalScore,
      weak_area: weakArea,
      audio_url: audioUrl,
      scorecard: scorecardJson,
      coach_feedback: coachFeedback
    })
    .select()
    .single();

  if (error) throw error;

  if (qa.length) {
    const rows = qa.map((t, i) => ({
      session_id: session.id,
      position: i + 1,
      question: t.question,
      answer_transcript: t.answer,
      scores: t.scores || null,
      feedback_note: t.note || null
    }));
    const { error: qaErr } = await supabase.from('pitch_qa').insert(rows);
    if (qaErr) throw qaErr;
  }

  return session;
}

export async function listSessions({ limit = 25 } = {}) {
  const { data, error } = await supabase
    .from('pitch_sessions')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}
