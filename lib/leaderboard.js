// Leaderboard helpers — submissions + reads + ranking math.
// All anti-gaming gates live here so server.js / session.html / leaderboard.html
// can stay thin.

import { supabase, getUser, getProfile } from './supabase.js';
import { SCENARIOS } from './scenarios.js';

// Persona difficulty multiplier — applied to Career Score so a 75 on
// Pricing Pushback is worth more than a 75 on Friendly Pre-Seed Angel.
// Sourced from each scenario's `diff` label.
const DIFF_MULTIPLIER = {
  easy:      1.00,
  medium:    1.15,
  hard:      1.30,
  challenge: 1.45
};

/* ============================================================
 * MOCK LEADERBOARD DATA
 *   Pads the boards while real entries are sparse. Each row is flagged
 *   __mock: true so the UI can mark it as "DEMO" and so dedup logic can
 *   never overwrite a real entry. Mock rows are appended BELOW any real
 *   rows; as real users opt in and submit, mock rows naturally drop off
 *   the bottom of the top-15 view.
 * ============================================================ */

const MOCK_USERS = [
  { user_id: '__mock_1',  handle: 'mayap42',     country: 'LT', skill: 0.94 },
  { user_id: '__mock_2',  handle: 'karl_b',      country: 'DE', skill: 0.89 },
  { user_id: '__mock_3',  handle: 'yamamoto88',  country: 'JP', skill: 0.86 },
  { user_id: '__mock_4',  handle: 'raviml',      country: 'IN', skill: 0.83 },
  { user_id: '__mock_5',  handle: 'linaba',      country: 'LT', skill: 0.81 },
  { user_id: '__mock_6',  handle: 'sashas',      country: 'UA', skill: 0.78 },
  { user_id: '__mock_7',  handle: 'elenav',      country: 'EE', skill: 0.76 },
  { user_id: '__mock_8',  handle: 'thomasm',     country: 'NL', skill: 0.73 },
  { user_id: '__mock_9',  handle: 'sofiaz',      country: 'ES', skill: 0.71 },
  { user_id: '__mock_10', handle: 'zoe_b',       country: 'US', skill: 0.69 },
  { user_id: '__mock_11', handle: 'rmehta22',    country: 'IN', skill: 0.66 },
  { user_id: '__mock_12', handle: 'pdragou',     country: 'GR', skill: 0.62 },
  { user_id: '__mock_13', handle: 'lukasv',      country: 'LT', skill: 0.59 },
  { user_id: '__mock_14', handle: 'okonkwoa',    country: 'NG', skill: 0.55 },
  { user_id: '__mock_15', handle: 'fhassan',     country: 'AE', skill: 0.51 }
];

// How many of the 10 scenarios each mock user attempted (deterministic, by index).
// Higher-skill users have tried more — they're the engaged power users.
const MOCK_ATTEMPTS_PER_USER = [10, 9, 8, 7, 7, 6, 6, 5, 5, 4, 4, 3, 3, 2, 2];

// Difficulty offset per scenario_id — harder scenarios have lower top scores.
// Matches the difficulty bands in scenarios.js.
const SCENARIO_DIFFICULTY_OFFSET = {
  'eigirdas-zemaitis':   -8,   // challenge + academic razor — tough
  'demo-day-90sec':      -7,
  'why-now-attack':      -7,
  'skeptical-seed':      -4,
  'analytical-series-a': -4,
  'pricing-pushback':    -5,
  'angel-syndicate':     -2,
  'hackathon-jury':      -1,
  'friendly-preseed':    +2,   // easier
  'university-class':    +3
};

// Deterministic PRNG so mock rankings don't reshuffle on every page load.
function seededRand(seed) {
  let s = seed | 0;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}

// Build the full mock entry table at module load. Each (user, scenario)
// combination produces one row with realistic pitch/qa/presence/total scores.
// The cross-scenario distribution honors persona difficulty so harder boards
// have visibly lower top scores — same shape the real data will have.
function buildMockEntries() {
  const entries = [];
  // Hardcoded scenario_id list (don't import SCENARIOS — it'd create a circular dep).
  const SCENARIO_IDS = [
    'eigirdas-zemaitis', 'skeptical-seed', 'analytical-series-a',
    'friendly-preseed',  'demo-day-90sec', 'hackathon-jury',
    'university-class',  'angel-syndicate', 'pricing-pushback',
    'why-now-attack'
  ];
  const SCENARIO_TITLE = {
    'eigirdas-zemaitis':   'The Eigirdas Test',
    'skeptical-seed':      'The Skeptical Seed Partner',
    'analytical-series-a': 'The Analytical Series A',
    'friendly-preseed':    'The Friendly Pre-Seed Angel',
    'demo-day-90sec':      'Demo Day: 90 Seconds',
    'hackathon-jury':      'Hackathon Jury Panel',
    'university-class':    'University Pitch Class',
    'angel-syndicate':     'Angel Syndicate Lead',
    'pricing-pushback':    'Pricing Pushback Drill',
    'why-now-attack':      '"Why Now?" Attack'
  };

  MOCK_USERS.forEach((u, i) => {
    const attempts = MOCK_ATTEMPTS_PER_USER[i] || 1;
    // Pick the first N scenarios deterministically (no shuffle — keeps numbers stable across reloads)
    const userScenarios = SCENARIO_IDS.slice(0, attempts);
    const rng = seededRand(i * 7919 + 1);

    userScenarios.forEach(scenarioId => {
      const offset = SCENARIO_DIFFICULTY_OFFSET[scenarioId] ?? 0;
      // Base 100 × skill + offset + ±3 noise → realistic spread
      const noise  = (rng() - 0.5) * 6;
      const pitch  = clamp(Math.round(100 * u.skill + offset + noise), 25, 99);
      const qa     = clamp(Math.round(pitch + (rng() - 0.5) * 12), 25, 99);
      const total  = Math.round(pitch * 0.6 + qa * 0.4);
      const presence = scenarioId === 'eigirdas-zemaitis'
        ? null  // Eigirdas-test mock users are audio-only-ish
        : clamp(Math.round(pitch + (rng() - 0.6) * 10), 25, 99);
      const verdict = total >= 80 ? 'Build it' : total >= 60 ? 'Maybe' : 'Skip it';

      entries.push({
        __mock: true,
        user_id:        u.user_id,
        handle:         u.handle,
        country:        u.country,
        scenario_id:    scenarioId,
        scenario_title: SCENARIO_TITLE[scenarioId],
        pitch_score:    pitch,
        qa_score:       qa,
        total_score:    total,
        presence_score: presence,
        verdict,
        duration_sec:   90 + Math.round(rng() * 90),
        created_at:     new Date(Date.now() - (i * 86400000 + rng() * 3600000 * 24)).toISOString()
      });
    });
  });
  return entries;
}
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

const MOCK_ENTRIES = buildMockEntries();

/* ---------------- Submission ---------------- */

/** Returns true if a session passes all anti-gaming gates. */
export function isLeaderboardEligible(session, qaTurns = []) {
  if (!session) return false;
  if ((session.duration_sec ?? session.durationSec ?? 0) < 30) return false;
  // Need a real coach score
  const total = session.total_score ?? session.totalScore;
  if (typeof total !== 'number' || total <= 0) return false;
  // Must have answered ≥ 2 of 3 Q&A turns
  const answeredCount = qaTurns.filter(t => t && (t.answer || t.answer_transcript || '').trim().split(/\s+/).length >= 5).length;
  if (answeredCount < 2) return false;
  return true;
}

/** Cheap stable hash for transcript dup-detection. Not cryptographic. */
function hashTranscript(text) {
  const t = (text || '').toLowerCase().replace(/\s+/g, ' ').trim();
  let h = 5381;
  for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) | 0;
  return `h${(h >>> 0).toString(36)}`;
}

/** Submit (upsert-best) a session to the leaderboard.
 *  Only writes if the new total_score beats the existing entry for (user, scenario).
 *  Returns: { written: bool, currentBest, reason } */
export async function submitToLeaderboard(session, qaTurns = []) {
  const user = await getUser();
  if (!user) return { written: false, reason: 'not_signed_in' };

  // Respect opt-in. We could write rows regardless and just hide them via RLS,
  // but writing nothing keeps the DB cleaner if a user opts in later.
  const profile = await getProfile().catch(() => null);
  if (!profile?.leaderboard_opt_in) return { written: false, reason: 'opt_out' };

  // Anti-gaming gate
  if (!isLeaderboardEligible(session, qaTurns)) {
    return { written: false, reason: 'ineligible' };
  }

  const total = session.total_score ?? session.totalScore;
  const pitch = session.pitch_score ?? session.pitchScore;
  const qa    = session.qa_score    ?? session.qaScore;

  // Check current best for this (user, scenario)
  const { data: existing, error: readErr } = await supabase
    .from('leaderboard_entries')
    .select('id, total_score, transcript_hash')
    .eq('user_id', user.id)
    .eq('scenario_id', session.scenario_id ?? session.scenarioId)
    .maybeSingle();
  if (readErr) {
    console.warn('[leaderboard] read existing failed:', readErr.message);
    // Don't block on read failure — just attempt the upsert.
  }

  const newHash = hashTranscript(session.transcript || '');

  // Same transcript as the existing entry → silent no-op (dup-detection).
  if (existing && existing.transcript_hash === newHash) {
    return { written: false, reason: 'duplicate_transcript', currentBest: existing.total_score };
  }

  // New score doesn't beat existing → no-op (best-of-N enforcement).
  if (existing && total <= existing.total_score) {
    return { written: false, reason: 'not_a_pb', currentBest: existing.total_score };
  }

  const row = {
    user_id:         user.id,
    session_id:      session.id,
    scenario_id:     session.scenario_id ?? session.scenarioId,
    scenario_title:  session.scenario_title ?? session.scenarioTitle,
    pitch_score:     pitch,
    qa_score:        qa,
    total_score:     total,
    presence_score:  session.presence_score ?? session.presenceScore ?? null,
    verdict:         session.verdict || (session.scorecard?.__verdict ?? null),
    duration_sec:    session.duration_sec ?? session.durationSec ?? null,
    transcript_hash: newHash
  };

  // Upsert by (user_id, scenario_id) unique key
  const { error: writeErr } = await supabase
    .from('leaderboard_entries')
    .upsert(row, { onConflict: 'user_id,scenario_id' });
  if (writeErr) {
    console.warn('[leaderboard] upsert failed:', writeErr.message);
    return { written: false, reason: 'write_failed', error: writeErr.message };
  }
  return { written: true, currentBest: total, previousBest: existing?.total_score ?? null };
}

/* ---------------- Reads ---------------- */

/** Top N entries for a single scenario, joined with public profile data.
 *  Public-readable (only opted-in rows are visible per RLS).
 *  Pads with __mock: true demo entries when real entries are sparse so the
 *  page never looks empty on a fresh deploy. */
export async function fetchTopForScenario(scenarioId, limit = 100) {
  const { data, error } = await supabase
    .from('leaderboard_entries')
    .select('id, user_id, total_score, pitch_score, qa_score, presence_score, verdict, duration_sec, created_at')
    .eq('scenario_id', scenarioId)
    .order('total_score', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) throw error;
  const real = await enrichWithHandles(data || []);
  return padWithMockScenario(real, scenarioId, limit);
}

/** Pad a real result list with mock entries (sorted by score) until the
 *  list reaches the target size — but never insert mocks above real entries. */
function padWithMockScenario(real, scenarioId, limit) {
  const TARGET = Math.min(limit, 15);
  if (real.length >= TARGET) return real;
  const mocks = MOCK_ENTRIES
    .filter(e => e.scenario_id === scenarioId)
    .sort((a, b) => b.total_score - a.total_score);
  // Real entries always rank by their own score; mocks fill below them.
  // We DON'T sort mocks above real even if a mock score is higher — real users
  // who opted in always sit above demos.
  return [...real, ...mocks.slice(0, TARGET - real.length)];
}

/** Career Score = avg(best per scenario × difficulty multiplier).
 *  Ranks users globally on a single number that rewards both breadth and quality.
 *  Pads with __mock: true demo entries when real ranks are sparse. */
export async function fetchCareerLeaders(limit = 100) {
  const { data, error } = await supabase
    .from('leaderboard_entries')
    .select('user_id, scenario_id, total_score');
  if (error) throw error;

  const realRanked = aggregateCareer(data || []);
  const enriched   = await enrichWithHandles(realRanked);

  const TARGET = Math.min(limit, 15);
  if (enriched.length >= TARGET) return enriched.slice(0, limit);

  // Pad with mock career rankings — same aggregation, mock dataset.
  const mockRanked = aggregateCareer(MOCK_ENTRIES, /* mockMode */ true);
  // Inline the handle/country since mock entries already carry them.
  const mockEnriched = mockRanked.map(r => ({
    ...r,
    handle:  MOCK_USERS.find(u => u.user_id === r.user_id)?.handle  || 'demo',
    country: MOCK_USERS.find(u => u.user_id === r.user_id)?.country || null
  }));

  // Real always sits above mocks even if a mock career_score is higher —
  // we never want a demo entry to outrank a real opted-in user.
  return [...enriched, ...mockEnriched].slice(0, TARGET);
}

/** Pure aggregation — used for both real and mock data so the career formula
 *  stays single-source. */
function aggregateCareer(rows, mockMode = false) {
  const byUser = new Map();
  for (const row of rows) {
    const sc = SCENARIOS[row.scenario_id];
    const mult = DIFF_MULTIPLIER[sc?.diff || 'medium'] || 1.0;
    if (!byUser.has(row.user_id)) byUser.set(row.user_id, { totalWeighted: 0, scenariosAttempted: 0 });
    const u = byUser.get(row.user_id);
    u.totalWeighted += row.total_score * mult;
    u.scenariosAttempted += 1;
  }
  return [...byUser.entries()]
    .map(([user_id, agg]) => ({
      user_id,
      scenarios_attempted: agg.scenariosAttempted,
      career_score: Math.round(
        (agg.totalWeighted / agg.scenariosAttempted) *
        (1 + Math.log10(Math.max(1, agg.scenariosAttempted)) * 0.15)
      ),
      ...(mockMode ? { __mock: true } : {})
    }))
    .sort((a, b) => b.career_score - a.career_score);
}

/** Bulk-fetch the public profiles for a set of rows and inline `handle` + `country`. */
async function enrichWithHandles(rows) {
  if (!rows.length) return rows;
  const userIds = [...new Set(rows.map(r => r.user_id))];
  const { data: profiles, error } = await supabase
    .from('public_profiles')
    .select('id, display_handle, country')
    .in('id', userIds);
  if (error) {
    console.warn('[leaderboard] profile enrich failed:', error.message);
    return rows.map(r => ({ ...r, handle: 'Anon', country: null }));
  }
  const byId = Object.fromEntries((profiles || []).map(p => [p.id, p]));
  return rows.map(r => ({
    ...r,
    handle:  byId[r.user_id]?.display_handle || 'Anon',
    country: byId[r.user_id]?.country || null
  }));
}

/** Where the current user ranks on a given scenario. Returns null if no entry. */
export async function fetchMyRank(scenarioId) {
  const user = await getUser();
  if (!user) return null;
  const { data: mine } = await supabase
    .from('leaderboard_entries')
    .select('total_score, scenario_id')
    .eq('user_id', user.id)
    .eq('scenario_id', scenarioId)
    .maybeSingle();
  if (!mine) return null;
  // Count how many opted-in entries beat my score on this scenario
  const { count, error } = await supabase
    .from('leaderboard_entries')
    .select('id', { count: 'exact', head: true })
    .eq('scenario_id', scenarioId)
    .gt('total_score', mine.total_score);
  if (error) return null;
  return { rank: (count ?? 0) + 1, score: mine.total_score };
}

/** Helper for the Account page — generate a default handle from the user's name. */
export function suggestHandle(name, userId) {
  const base = (name || 'pitcher').trim().split(/\s+/)[0] || 'pitcher';
  const tail = (userId || Math.random().toString(36)).replace(/[^a-z0-9]/gi, '').slice(-4);
  return (base + tail).toLowerCase().slice(0, 20);
}
