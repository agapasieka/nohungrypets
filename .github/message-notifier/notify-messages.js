// Scheduled notifier: emails any NoHungryPets member who has new unread
// messages. Runs in GitHub Actions on a cron schedule.
//
// It reads Firestore with a Firebase service account (admin access bypasses
// security rules), finds conversations updated since the last run, and for
// each participant who still has unread messages, emails them a summary via
// the Resend HTTP API. A checkpoint in _meta/messageNotifier means each
// message triggers one email, not one on every run.
//
// Reuses the same secrets as the marketing agent, so no new ones are needed:
//   FIREBASE_SA_KEY  - full JSON of a Firebase service account key
//   RESEND_API_KEY   - Resend API key
//   FROM_EMAIL       - sender (optional; defaults to Resend's sandbox address)
//
// NOTE on Resend's free tier: the sandbox sender (onboarding@resend.dev) only
// delivers to the address you signed up to Resend with. To actually reach
// other members, verify nohungrypets.co.uk in Resend and set FROM_EMAIL to an
// address on that domain (e.g. notifications@nohungrypets.co.uk).

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
const META_REF = db.collection('_meta').doc('messageNotifier');

// How far back to look on the very first run (no stored checkpoint yet).
const FIRST_RUN_LOOKBACK_MS = 15 * 60 * 1000;

function toDate(ts) {
  return ts && typeof ts.toDate === 'function' ? ts.toDate() : null;
}

async function sendEmail(to, subject, text) {
  const res = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: `NoHungryPets <${FROM_EMAIL}>`,
      to,
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

// Look up a member's email, cached so we fetch each user at most once.
const emailCache = new Map();
async function getUserEmail(uid) {
  if (emailCache.has(uid)) return emailCache.get(uid);
  let email = null;
  try {
    const doc = await db.collection('users').doc(uid).get();
    const data = doc.exists ? doc.data() : null;
    if (data && typeof data.email === 'string' && data.email.includes('@')) {
      email = data.email;
    }
  } catch (err) {
    console.error(`Could not read user ${uid}:`, err.message);
  }
  emailCache.set(uid, email);
  return email;
}

async function main() {
  const now = new Date();

  const metaSnap = await META_REF.get();
  const lastCheck = (metaSnap.exists && toDate(metaSnap.data().lastCheck))
    || new Date(Date.now() - FIRST_RUN_LOOKBACK_MS);

  // Conversations touched since the last run (single-field range index is
  // automatic). Admin access bypasses security rules.
  const snap = await db.collection('conversations')
    .where('lastUpdated', '>', admin.firestore.Timestamp.fromDate(lastCheck))
    .get();

  // Group the unread conversations by the member who needs to hear about them.
  const byRecipient = new Map(); // uid -> [{ about, preview }]
  snap.forEach(doc => {
    const c = doc.data() || {};
    const participants = Array.isArray(c.participants) ? c.participants : [];
    const unreadCount = c.unreadCount || {};
    const about = c.relatedListingName ? `"${c.relatedListingName}"` : 'a listing';
    const preview = (c.lastMessage || '').trim().slice(0, 100);
    participants.forEach(uid => {
      if ((unreadCount[uid] || 0) > 0) {
        if (!byRecipient.has(uid)) byRecipient.set(uid, []);
        byRecipient.get(uid).push({ about, preview });
      }
    });
  });

  let sent = 0;
  for (const [uid, items] of byRecipient) {
    const email = await getUserEmail(uid);
    if (!email) {
      console.log(`Skipping ${uid}: no email on record.`);
      continue;
    }
    const n = items.length;
    const lines = items.map(it => `• ${it.about}${it.preview ? ` — ${it.preview}` : ''}`);
    const subject = `🐾 ${n} new message${n > 1 ? 's' : ''} on NoHungryPets`;
    const text =
      `Hi! You have ${n} new message${n > 1 ? 's' : ''} waiting on NoHungryPets:\n\n` +
      `${lines.join('\n')}\n\n` +
      `Read and reply: https://nohungrypets.co.uk/profile\n\n` +
      `— NoHungryPets\n` +
      `You're receiving this because someone messaged you about a listing.`;
    try {
      await sendEmail(email, subject, text);
      sent++;
    } catch (err) {
      console.error(`Failed to email ${uid}:`, err.message);
    }
  }

  console.log(`Checked ${snap.size} updated conversation(s); emailed ${sent} member(s).`);

  await META_REF.set(
    { lastCheck: admin.firestore.Timestamp.fromDate(now) },
    { merge: true }
  );
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Notifier failed:', err);
    process.exit(1);
  });
