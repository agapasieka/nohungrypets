// Scheduled notifier: emails any NoHungryPets member who has new unread
// messages. Runs in GitHub Actions on a cron schedule.
//
// It reads Firestore with a Firebase service account (admin access bypasses
// security rules), finds conversations updated since the last run, and for
// each participant who still has unread messages, emails them a summary.
// A checkpoint in _meta/messageNotifier means each message triggers one
// email, not one on every run.
//
// Required environment variables (set as GitHub Actions secrets):
//   FIREBASE_SERVICE_ACCOUNT - full JSON of a Firebase service account key
//   MAIL_USERNAME            - SMTP username (e.g. a Gmail address) = From
//   MAIL_PASSWORD            - SMTP password / app password

const admin = require('firebase-admin');
const nodemailer = require('nodemailer');

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return v;
}

const MAIL_USERNAME = requireEnv('MAIL_USERNAME');
const MAIL_PASSWORD = requireEnv('MAIL_PASSWORD');

let serviceAccount;
try {
  serviceAccount = JSON.parse(requireEnv('FIREBASE_SERVICE_ACCOUNT'));
} catch (err) {
  console.error('FIREBASE_SERVICE_ACCOUNT is not valid JSON:', err.message);
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

let transporter = null;
function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: MAIL_USERNAME, pass: MAIL_PASSWORD }
    });
  }
  return transporter;
}

async function sendEmail(to, subject, text) {
  await getTransporter().sendMail({
    from: `NoHungryPets <${MAIL_USERNAME}>`,
    to,
    subject,
    text
  });
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
