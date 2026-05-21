// Drop-in auth gate for protected pages.
// Usage:  <script type="module" src="./lib/auth-gate.js"></script>
// - Redirects unsigned visitors to ./index.html
// - Populates [data-user-name], [data-user-firstname], [data-user-email],
//             [data-user-meta] (company · stage), [data-user-avatar] (initials)
// - Wires any element with data-signout to sign out and bounce home

import { supabase, getSession, getProfile, signOut } from './supabase.js';

const session = await getSession();
if (!session) {
  // Use replace so back button doesn't loop back into the gated page
  location.replace('./index.html?signedout=1');
  // Stop further script execution by throwing — modules halt cleanly
  throw new Error('not-authenticated');
}

const user    = session.user;
const profile = await getProfile().catch(() => null);
const display = profile?.name || user.user_metadata?.name || user.email.split('@')[0];

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
