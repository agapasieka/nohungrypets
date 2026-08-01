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
