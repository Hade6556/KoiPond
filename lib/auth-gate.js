// Drop-in auth gate for protected pages.
// Usage:  <script type="module" src="./lib/auth-gate.js"></script>
// - Redirects unsigned visitors to ./index.html
// - Populates [data-user-name], [data-user-firstname], [data-user-email],
//             [data-user-meta] (company · stage), [data-user-avatar] (initials)
// - Wires any element with data-signout to sign out and bounce home

import { supabase, getSession, getProfile, signOut } from './supabase.js';

let session = await getSession();
if (!session) {
  // No session → create an anonymous one so guests can use the product without
  // email signup. Requires "Anonymous Sign-Ins" enabled in Supabase Auth
  // providers. If the call fails (e.g. provider disabled), fall back to the
  // old behavior of bouncing to the landing page.
  const { data, error } = await supabase.auth.signInAnonymously();
  if (error || !data?.session) {
    console.error('[auth-gate] anonymous sign-in failed:', error);
    location.replace('./index.html?signedout=1');
    throw new Error('not-authenticated');
  }
  session = data.session;
}

const user    = session.user;
const profile = await getProfile().catch(() => null);
// Anonymous users have no email — fall back to "Guest" so split() doesn't blow up.
const display = profile?.name
  || user.user_metadata?.name
  || user.email?.split('@')[0]
  || 'Guest';

const initials = (() => {
  const parts = display.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  return (parts.map(p => p[0]).join('') || display[0] || 'U').toUpperCase();
})();

const stageLabel = (s) => {
  const map = { 'pre-seed': 'Pre-seed', 'seed': 'Seed', 'series-a': 'Series A', 'series-b': 'Series B+' };
  return map[s] || (s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Founder');
};
const meta = profile
  ? [profile.company, stageLabel(profile.stage)].filter(Boolean).join(' · ')
  : (user.email || 'Founder');

document.querySelectorAll('[data-user-name]').forEach(el => el.textContent = display);
document.querySelectorAll('[data-user-email]').forEach(el => el.textContent = user.email);
document.querySelectorAll('[data-user-firstname]').forEach(el => el.textContent = display.split(' ')[0]);
document.querySelectorAll('[data-user-meta]').forEach(el => el.textContent = meta);
document.querySelectorAll('[data-user-avatar]').forEach(el => {
  // Replace any inner img/text with a deterministic initials block — no external pic.
  el.textContent = initials;
  el.setAttribute('aria-label', display);
});

document.querySelectorAll('[data-signout]').forEach(btn => {
  btn.addEventListener('click', async e => { e.preventDefault(); await signOut(); });
});

// Keep the session warm and react to remote sign-outs (e.g. another tab)
supabase.auth.onAuthStateChange((_event, newSession) => {
  if (!newSession) location.replace('./index.html?signedout=1');
});
