// Copyright (c) 2026 NoHungryPets
// NoHungryPets - Shared JS

// Highlight active nav link
document.addEventListener('DOMContentLoaded', () => {
  const path = window.location.pathname.replace(/\.html$/, '').replace(/\/$/, '') || '/';
  document.querySelectorAll('.nav-links a').forEach(a => {
    if (a.getAttribute('href') === path) a.classList.add('active');
  });
});

// ── POSTCODE HELPERS ─────────────────────────────────────
// Extract the outward code from a UK postcode.
// e.g. "DE14 1AA" -> "DE14", "SW1A 1AA" -> "SW1A", "M1 1AE" -> "M1".
// UK inward codes are always 3 chars (digit + 2 letters), so the
// outward code is everything before the final 3 characters.
function getOutwardCode(postcode) {
  if (!postcode || typeof postcode !== 'string') return '';
  const cleaned = postcode.trim().toUpperCase().replace(/\s+/g, '');
  if (cleaned.length <= 3) return cleaned; // too short to split reliably
  return cleaned.slice(0, cleaned.length - 3);
}

// Count listings that are new to this user and near them.
// "New" = created after `sinceMillis` (their last visit / account creation).
// "Near" = same postcode outward code. Own listings are excluded.
// Returns 0 on any error or when the user has no postcode.
async function countNearbyNewListings({ db, uid, postcode, sinceMillis }) {
  const outward = getOutwardCode(postcode);
  if (!db || !outward) return 0;
  try {
    // Single-field filter keeps this index-free (matches existing patterns).
    const snap = await db.collection('listings')
      .where('status', '==', 'available')
      .get();
    let count = 0;
    snap.forEach(doc => {
      const l = doc.data();
      if (!l) return;
      if (l.userId === uid) return; // exclude the user's own listings
      const createdMillis = (l.createdAt && l.createdAt.toMillis) ? l.createdAt.toMillis() : 0;
      if (createdMillis <= sinceMillis) return; // only listings newer than last visit
      if (getOutwardCode(l.postcode) !== outward) return; // only nearby (same outward code)
      count++;
    });
    return count;
  } catch (err) {
    console.error('Error counting nearby new listings:', err);
    return 0;
  }
}

// ── MILESTONES ───────────────────────────────────────────
// Shared source of truth for listings-posted milestone thresholds.
// Used by profile.html (badge + progress-to-next) and post.html
// (one-off celebration toast when a post crosses a threshold exactly).
const MILESTONES = [1, 5, 10, 25, 50, 100];

// Given a listings-posted count, return milestone framing:
//   reached          - highest threshold the count has met or passed (0 if none)
//   next             - next threshold above the count (null once all passed)
//   toNext           - how many more listings until `next` (null once all passed)
//   isExactMilestone - true when the count lands exactly on a threshold
function getMilestoneInfo(count) {
  const n = Number(count) || 0;
  let reached = 0;
  let next = null;
  for (const m of MILESTONES) {
    if (n >= m) {
      reached = m;
    } else {
      next = m;
      break;
    }
  }
  return {
    reached,
    next,
    toNext: next === null ? null : next - n,
    isExactMilestone: MILESTONES.indexOf(n) !== -1
  };
}

// ── COOKIE CONSENT ─────────────────────────────────────────
// Strictly-necessary cookies/local storage (session, preferences) always
// run - no consent needed. Google Analytics is not strictly necessary, so
// it stays off (see enableAnalytics() in js/auth.js, which checks the same
// localStorage flag on load) until the user actively accepts here.
document.addEventListener('DOMContentLoaded', () => {
  if (localStorage.getItem('nhp-cookie-consent')) return; // already decided

  // Fixed, always-stacked layout (text row, then button row) rather than a
  // flex-wrap that can reflow unpredictably on narrow screens - a previous
  // version of this pushed the buttons below the visible viewport on a
  // narrow phone. max-height + overflow-y stays as a hard safety net.
  const banner = document.createElement('div');
  banner.id = 'cookie-consent-banner';
  banner.style.cssText = `
    position:fixed; left:0; right:0; bottom:0; z-index:10000;
    background:#3D2B1F; color:white;
    padding:0.75rem 1rem; box-shadow:0 -4px 24px rgba(0,0,0,0.2); font-size:0.78rem;
    max-height:50vh; overflow-y:auto;
    -webkit-transform:translateZ(0); transform:translateZ(0);
  `;
  banner.innerHTML = `
    <div style="line-height:1.35;margin-bottom:0.6rem">🍪 Necessary cookies always run; Analytics only with your consent. <a href="/privacy" style="color:#E8733A;text-decoration:underline">Read more</a></div>
    <div style="display:flex;gap:0.5rem;justify-content:flex-end">
      <button type="button" id="cookie-decline" style="background:none;border:1px solid rgba(255,255,255,0.3);color:white;padding:0.5rem 0.9rem;border-radius:50px;font-weight:600;font-size:0.78rem;cursor:pointer;font-family:inherit;white-space:nowrap">Necessary only</button>
      <button type="button" id="cookie-accept" style="background:#E8733A;border:none;color:white;padding:0.5rem 0.9rem;border-radius:50px;font-weight:700;font-size:0.78rem;cursor:pointer;font-family:inherit;white-space:nowrap">Accept all</button>
    </div>
  `;
  document.body.appendChild(banner);

  banner.querySelector('#cookie-accept').addEventListener('click', () => {
    localStorage.setItem('nhp-cookie-consent', 'accepted');
    if (typeof enableAnalytics === 'function') enableAnalytics();
    banner.remove();
  });
  banner.querySelector('#cookie-decline').addEventListener('click', () => {
    localStorage.setItem('nhp-cookie-consent', 'declined');
    banner.remove();
  });
});

// ── PWA: SERVICE WORKER + IOS INSTALL HINT ────────────────
// Registers the shell-caching service worker (see sw.js) and, on iOS only
// (Android/Chrome shows its own native install prompt automatically),
// shows a small dismissible banner pointing at Share -> Add to Home Screen,
// since Safari has no install-prompt UI of its own.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(err => {
      console.warn('Service worker registration failed:', err);
    });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isStandalone = window.navigator.standalone === true
    || window.matchMedia('(display-mode: standalone)').matches;
  // Don't compete with the cookie-consent banner for the same bottom-of-
  // screen real estate - wait until that's been resolved first.
  if (!isIOS || isStandalone || !localStorage.getItem('nhp-cookie-consent')) return;

  // -webkit-transform forces its own compositing layer - the standard fix
  // for iOS Safari's well-documented bug where position:fixed elements
  // glitch/vanish when the address bar auto-collapses a few seconds after
  // load, independent of any scrolling or tapping.
  const banner = document.createElement('div');
  banner.style.cssText = `
    position:fixed; left:1rem; right:1rem; bottom:max(1rem, env(safe-area-inset-bottom)); z-index:9999;
    background:#3D2B1F; color:white; border-radius:16px;
    padding:0.9rem 1.1rem; display:flex; align-items:center; gap:0.75rem;
    box-shadow:0 8px 32px rgba(0,0,0,0.25); font-size:0.85rem;
    -webkit-transform:translateZ(0); transform:translateZ(0);
  `;
  banner.innerHTML = `
    <span style="flex:1;line-height:1.4">📲 Install NoHungryPets: tap <strong>Share</strong> then <strong>Add to Home Screen</strong></span>
    <button type="button" aria-label="Dismiss" style="background:none;border:none;color:rgba(255,255,255,0.6);font-size:1.1rem;cursor:pointer;padding:0.25rem;line-height:1">✕</button>
  `;
  banner.querySelector('button').addEventListener('click', () => {
    banner.remove(); // dismiss for this page view only - reappears on refresh/next page
  });
  document.body.appendChild(banner);
});

// Simple toast notification
function showToast(msg, type = 'success') {
  const t = document.createElement('div');
  t.style.cssText = `
    position:fixed; bottom:2rem; left:50%; transform:translateX(-50%);
    background:${type === 'success' ? '#3A7D5A' : '#E8733A'}; color:white;
    padding:0.9rem 2rem; border-radius:50px; font-weight:600; font-size:0.9rem;
    box-shadow:0 8px 32px rgba(0,0,0,0.2); z-index:9999;
    animation: fadeUp 0.3s ease both;
  `;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}
