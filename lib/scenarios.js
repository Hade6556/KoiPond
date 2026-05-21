// Single source of truth for the 9 investor personas.
// Imported by practice.html, scenario.html, and session.html so URL params,
// API prompt context, and on-screen avatars stay in lockstep.

export const SCENARIOS = {
  'eigirdas-zemaitis': {
    id: 'eigirdas-zemaitis',
    title: 'The Eigirdas Test',
    investor: 'Eigirdas Žemaitis — Director of the Entrepreneurship Programme @ ISM University',
    name: 'Eigirdas Žemaitis',
    firm: 'Director · Entrepreneurship Programme · ISM University',
    img: 5,                                  // pravatar fallback (rarely used)
    imgUrl: './assets/eigirdas.jpg',         // local high-res photo
    cat: 'university', catLabel: 'ACADEMIC · ISM',
    diff: 'challenge', diffLabel: 'CHALLENGE',
    stage: 'ANY',
    desc: 'The man behind The Shark voice. Cold logic, no cheerleading. Every YC lens applied without mercy — the way he runs his Entrepreneurship 401 critiques.',
    style: 'Academic razor · cold logic · YC-lens absolutist · zero pity scores',
    focus: 'Idea defensibility · founder–market fit · execution realism',
    type: 'The original Shark',
    locked: true,
    unlock: {
      type: 'email_domain',
      value: 'stud.ism.lt',
      hint: 'Sign in with your @stud.ism.lt student email to unlock.'
    }
  },
  'skeptical-seed': {
    id: 'skeptical-seed',
    title: 'The Skeptical Seed Partner',
    investor: 'Sarah Chen — Partner @ Vanguard Capital',
    name: 'Sarah Chen',
    firm: 'Partner · Vanguard Capital',
    img: 5,
    cat: 'vc', catLabel: 'VC PITCH',
    diff: 'hard', diffLabel: 'HARD',
    stage: 'SEED',
    desc: 'A skeptical seed partner who probes the wedge, distribution, and unit economics. Cold and direct.',
    style: 'Direct · interruptive · numbers-first',
    focus: 'B2B SaaS · AI infra',
    type: 'Lead seed investor'
  },
  'analytical-series-a': {
    id: 'analytical-series-a',
    title: 'The Analytical Series A',
    investor: 'Marcus Lee — GP @ Helix Capital',
    name: 'Marcus Lee',
    firm: 'GP · Helix Capital',
    img: 33,
    cat: 'vc', catLabel: 'VC PITCH',
    diff: 'hard', diffLabel: 'HARD',
    stage: 'SERIES A',
    desc: 'Numbers first, story second. Will ask for cohort retention you may not have.',
    style: 'Metric-led · structured · cohort-curious',
    focus: 'Vertical SaaS · fintech',
    type: 'Series A lead'
  },
  'friendly-preseed': {
    id: 'friendly-preseed',
    title: 'The Friendly Pre-Seed Angel',
    investor: 'Priya Shah — Principal @ Stratus.vc',
    name: 'Priya Shah',
    firm: 'Principal · Stratus.vc',
    img: 48,
    cat: 'angel', catLabel: 'ANGEL',
    diff: 'easy', diffLabel: 'EASY',
    stage: 'PRE-SEED',
    desc: 'Warm and curious. Wants the founder story first, then probes the team.',
    style: 'Warm · curious · founder-led',
    focus: 'Consumer · creator tools',
    type: 'Pre-seed check writer'
  },
  'demo-day-90sec': {
    id: 'demo-day-90sec',
    title: 'Demo Day: 90 Seconds',
    investor: 'Rajiv Mehta — MD @ Northwind Ventures',
    name: 'Rajiv Mehta',
    firm: 'MD · Northwind Ventures',
    img: 68,
    cat: 'demoday', catLabel: 'DEMO DAY',
    diff: 'challenge', diffLabel: 'CHALLENGE',
    stage: 'ANY',
    desc: 'Demo Day vibe. Ninety seconds. One question. No mercy.',
    style: 'Punchy · one-question · time-boxed',
    focus: 'Cross-stage',
    type: 'Demo Day partner'
  },
  'hackathon-jury': {
    id: 'hackathon-jury',
    title: 'Hackathon Jury Panel',
    investor: 'Three-judge panel — Mixed backgrounds',
    name: 'Hackathon Jury',
    firm: 'Three-judge panel',
    img: 12,
    cat: 'hackathon', catLabel: 'HACKATHON',
    diff: 'medium', diffLabel: 'MEDIUM',
    stage: 'EARLY',
    desc: 'You built it in 36 hours. They have eight minutes. Make it count.',
    style: 'Mixed · friendly · execution-focused',
    focus: 'Anything shippable',
    type: 'Judging panel'
  },
  'university-class': {
    id: 'university-class',
    title: 'University Pitch Class',
    investor: 'Prof. Daniel Reyes — Entrepreneurship 401',
    name: 'Prof. Daniel Reyes',
    firm: 'Entrepreneurship 401',
    img: 15,
    cat: 'university', catLabel: 'UNIVERSITY',
    diff: 'easy', diffLabel: 'EASY',
    stage: 'IDEA',
    desc: 'A teaching context. Friendly probing on the problem, customer, and ask.',
    style: 'Coaching · patient · clarity-first',
    focus: 'Teaching · clarity',
    type: 'Course instructor'
  },
  'angel-syndicate': {
    id: 'angel-syndicate',
    title: 'Angel Syndicate Lead',
    investor: 'Elena Voskoboinikova — Angel syndicate lead',
    name: 'Elena Voskoboinikova',
    firm: 'Angel syndicate lead',
    img: 20,
    cat: 'angel', catLabel: 'ANGEL',
    diff: 'medium', diffLabel: 'MEDIUM',
    stage: 'PRE-SEED',
    desc: 'Wants conviction and a fast read. Punishes hand-waving on the customer.',
    style: 'Fast read · conviction · customer-obsessed',
    focus: 'Climate · hard tech',
    type: 'Syndicate lead'
  },
  'pricing-pushback': {
    id: 'pricing-pushback',
    title: 'Pricing Pushback Drill',
    investor: 'Composite investor — Built to attack price',
    name: 'Pricing Drill',
    firm: 'Composite adversarial investor',
    img: 11,
    cat: 'hardmode', catLabel: 'HARD MODE',
    diff: 'hard', diffLabel: 'HARD',
    stage: 'ANY',
    desc: 'Every question is about price, willingness to pay, and discount pressure. Build your defense.',
    style: 'Adversarial · price-attacking · discount-baiting',
    focus: 'Pricing · willingness',
    type: 'Drill persona'
  },
  'why-now-attack': {
    id: 'why-now-attack',
    title: '"Why Now?" Attack',
    investor: 'Composite investor — Built to attack timing',
    name: 'Why-Now Drill',
    firm: 'Composite adversarial investor',
    img: 23,
    cat: 'hardmode', catLabel: 'HARD MODE',
    diff: 'challenge', diffLabel: 'CHALLENGE',
    stage: 'ANY',
    desc: 'Drills only on timing and market readiness. If your "why now" wobbles, it falls apart.',
    style: 'Adversarial · timing-attacking · market-readiness',
    focus: 'Timing · market readiness',
    type: 'Drill persona'
  }
};

export const FREE_PITCH = {
  id: 'free-pitch',
  title: 'Free pitch',
  investor: 'Sarah Chen — Partner @ Vanguard Capital',
  name: 'Sarah Chen',
  firm: 'Partner · Vanguard Capital',
  img: 5,
  cat: 'vc', catLabel: 'VC PITCH',
  diff: 'medium', diffLabel: 'MEDIUM',
  stage: 'SEED',
  desc: 'Open practice — no specific persona constraints.',
  style: 'Direct · balanced',
  focus: 'General',
  type: 'Generalist investor'
};

export function getScenario(id) {
  return SCENARIOS[id] || FREE_PITCH;
}

export function avatarUrl(scenario, size = 200) {
  // Personas with a custom photo (Eigirdas, future special guests) always win
  // over the pravatar fallback regardless of requested size.
  if (scenario?.imgUrl) return scenario.imgUrl;
  return `https://i.pravatar.cc/${size}?img=${scenario?.img ?? 5}`;
}

/** Returns true if the user can access this scenario.
 *  Currently the only lock type is `email_domain` — user.email must end with
 *  `@<domain>` (case-insensitive). Extend here for future lock types
 *  (e.g. paid plans, batch codes). */
export function isScenarioUnlocked(scenario, user) {
  if (!scenario?.locked) return true;
  if (!user?.email) return false;
  if (scenario.unlock?.type === 'email_domain') {
    const needle = ('@' + (scenario.unlock.value || '')).toLowerCase();
    return user.email.toLowerCase().endsWith(needle);
  }
  return false;
}

/** Human-friendly hint for why a scenario is locked. */
export function lockHint(scenario) {
  return scenario?.unlock?.hint || 'Locked for now.';
}
