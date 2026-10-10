// Scheduled owner digest: emails the site owner a periodic summary of new
// signups, new listings and message activity. Runs in GitHub Actions on a
// cron schedule. This is separate from the per-member message notifier.
//
// It reads Firestore with a Firebase service account (admin access bypasses
// security rules), gathers everything created/updated since the last digest,
// and sends one summary email via the Resend HTTP API. A checkpoint in
// _meta/ownerDigest means each item is reported once.
//
// Reuses the marketing agent's secrets plus one recipient setting:
//   FIREBASE_SA_KEY  - full JSON of a Firebase service account key
//   RESEND_API_KEY   - Resend API key
//   FROM_EMAIL       - sender (optional; defaults to Resend's sandbox address)
//   DIGEST_TO        - where to send the digest (required)

const admin = require('firebase-admin');

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return v;
}

const RESEND_API_KEY = requireEnv('RESEND_API_KEY');
const DIGEST_TO = requireEnv('DIGEST_TO');
const FROM_EMAIL = process.env.FROM_EMAIL || 'onboarding@resend.dev';
const RESEND_API_URL = 'https://api.resend.com/emails';

let serviceAccount;
try {
  serviceAccount = JSON.parse(requireEnv('FIREBASE_SA_KEY'));
} catch (err) {
  console.error('FIREBASE_SA_KEY is not valid JSON:', err.message);
  process.exit(1);
}

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();
const META_REF = db.collection('_meta').doc('ownerDigest');

// How far back to look on the very first run (no stored checkpoint yet).
const FIRST_RUN_LOOKBACK_MS = 24 * 60 * 60 * 1000;

function toDate(ts) {
  return ts && typeof ts.toDate === 'function' ? ts.toDate() : null;
}

function firstName(full) {
  return typeof full === 'string' && full.trim() ? full.trim().split(/\s+/)[0] : 'A member';
}

async function sendEmail(subject, text) {
  const res = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: `NoHungryPets <${FROM_EMAIL}>`,
      to: DIGEST_TO,
      subject,
      text
    })
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Resend API error ${res.status}: ${body}`);
  }
  return res.json();
}

async function main() {
  const now = new Date();

  const metaSnap = await META_REF.get();
  const since = (metaSnap.exists && toDate(metaSnap.data().lastDigest))
    || new Date(Date.now() - FIRST_RUN_LOOKBACK_MS);
  const sinceTs = admin.firestore.Timestamp.fromDate(since);

  // New signups, new listings, and conversation activity since the last digest.
  // Single-field range indexes (createdAt / lastUpdated) are automatic.
  const [usersSnap, listingsSnap, convSnap] = await Promise.all([
    db.collection('users').where('createdAt', '>', sinceTs).get(),
    db.collection('listings').where('createdAt', '>', sinceTs).get(),
    db.collection('conversations').where('lastUpdated', '>', sinceTs).get()
  ]);

  const signups = [];
  usersSnap.forEach(doc => {
    const u = doc.data() || {};
    signups.push({
      name: firstName(u.name),
      postcode: typeof u.postcode === 'string' ? u.postcode : '',
      email: typeof u.email === 'string' ? u.email : ''
    });
  });

  const listings = [];
  listingsSnap.forEach(doc => {
    const l = doc.data() || {};
    listings.push({
      item: typeof l.itemName === 'string' ? l.itemName : 'Untitled item',
      by: firstName(l.posterName),
      postcode: typeof l.postcode === 'string' ? l.postcode : ''
    });
  });

  const activeConversations = convSnap.size;

  // Nothing happened — skip the email but still advance the checkpoint.
  if (signups.length === 0 && listings.length === 0 && activeConversations === 0) {
    console.log('Nothing new since last digest; no email sent.');
    await META_REF.set({ lastDigest: admin.firestore.Timestamp.fromDate(now) }, { merge: true });
    return;
  }

  const parts = [];
  parts.push(`NoHungryPets activity since ${since.toLocaleString('en-GB', { timeZone: 'Europe/London' })}:`);
  parts.push('');

  parts.push(`🎉 New signups: ${signups.length}`);
  signups.forEach(s => {
    const bits = [s.name];
    if (s.postcode) bits.push(s.postcode);
    if (s.email) bits.push(s.email);
    parts.push(`   • ${bits.join(' · ')}`);
  });
  parts.push('');

  parts.push(`📦 New listings: ${listings.length}`);
  listings.forEach(l => {
    const where = l.postcode ? ` (${l.postcode})` : '';
    parts.push(`   • ${l.item} — by ${l.by}${where}`);
  });
  parts.push('');

  parts.push(`💬 Conversations with new activity: ${activeConversations}`);
  parts.push('');
  parts.push('Admin dashboard: https://nohungrypets.co.uk/admin');
  parts.push('— NoHungryPets');

  const subject =
    `🐾 NoHungryPets digest — ${signups.length} signup${signups.length === 1 ? '' : 's'}, ` +
    `${listings.length} listing${listings.length === 1 ? '' : 's'}`;

  await sendEmail(subject, parts.join('\n'));
  console.log(`Digest sent to ${DIGEST_TO}: ${signups.length} signups, ${listings.length} listings, ${activeConversations} active conversations.`);

  await META_REF.set({ lastDigest: admin.firestore.Timestamp.fromDate(now) }, { merge: true });
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Digest failed:', err);
    process.exit(1);
  });
