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
// Throws on a read error (treated as a transient failure by the caller);
// returns null only when the member genuinely has no usable email.
const emailCache = new Map();
async function getUserEmail(uid) {
  if (emailCache.has(uid)) return emailCache.get(uid);
  const doc = await db.collection('users').doc(uid).get();
  const data = doc.exists ? doc.data() : null;
  const email = (data && typeof data.email === 'string' && data.email.includes('@'))
    ? data.email
    : null;
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
  // `times` holds each conversation's lastUpdated so we can roll the checkpoint
  // back to the earliest failed one and retry it next run.
  const byRecipient = new Map(); // uid -> { items: [{about, preview}], times: [Date] }
  snap.forEach(doc => {
    const c = doc.data() || {};
    const participants = Array.isArray(c.participants) ? c.participants : [];
    const unreadCount = c.unreadCount || {};
    const about = c.relatedListingName ? `"${c.relatedListingName}"` : 'a listing';
    const preview = (c.lastMessage || '').trim().slice(0, 100);
    const updated = toDate(c.lastUpdated);
    participants.forEach(uid => {
      if ((unreadCount[uid] || 0) > 0) {
        if (!byRecipient.has(uid)) byRecipient.set(uid, { items: [], times: [] });
        const g = byRecipient.get(uid);
        g.items.push({ about, preview });
        if (updated) g.times.push(updated);
      }
    });
  });

  let sent = 0;
  const failedTimes = []; // lastUpdated of conversations we couldn't deliver

  for (const [uid, group] of byRecipient) {
    let email;
    try {
      email = await getUserEmail(uid);
    } catch (err) {
      // Transient read failure — keep these for retry next run.
      console.error(`User read failed for ${uid}:`, err.message);
      failedTimes.push(...group.times);
      continue;
    }
    if (!email) {
      // No usable email: retrying won't help, so don't hold the checkpoint.
      console.log(`Skipping ${uid}: no email on record.`);
      continue;
    }

    const n = group.items.length;
    const lines = group.items.map(it => `• ${it.about}${it.preview ? ` — ${it.preview}` : ''}`);
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
      // Delivery failed — keep for retry so the message isn't lost.
      console.error(`Failed to email ${uid}:`, err.message);
      failedTimes.push(...group.times);
    }
  }

  // Advance the checkpoint — but never past a conversation we failed to
  // deliver, so the next run retries it. On failure we roll back to just
  // before the earliest failed conversation (a few successful recipients in
  // that window may get a duplicate on retry, which is preferable to a lost
  // message).
  let checkpoint = now;
  if (failedTimes.length > 0) {
    const earliest = Math.min(...failedTimes.map(d => d.getTime()));
    checkpoint = new Date(earliest - 1);
    console.log(`${failedTimes.length} delivery failure(s); holding checkpoint for retry.`);
  }

  console.log(`Checked ${snap.size} updated conversation(s); emailed ${sent} member(s).`);

  await META_REF.set(
    { lastCheck: admin.firestore.Timestamp.fromDate(checkpoint) },
    { merge: true }
  );
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Notifier failed:', err);
    process.exit(1);
  });
