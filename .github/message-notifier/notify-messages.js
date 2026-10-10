// Scheduled notifier: emails the site owner when they have new unread
// messages on NoHungryPets. Runs in GitHub Actions on a cron schedule.
//
// It reads Firestore with a Firebase service account (admin access bypasses
// security rules), finds the owner's conversations updated since the last
// run that still have unread messages, and sends one summary email. It tracks
// the last-check time in a Firestore doc (_meta/messageNotifier) so each new
// message is emailed once, not on every run.
//
// Required environment variables (set as GitHub Actions secrets/vars):
//   OWNER_UID                - the Firebase Auth UID to notify about
//   FIREBASE_SERVICE_ACCOUNT - full JSON of a Firebase service account key
//   MAIL_USERNAME            - SMTP username (e.g. a Gmail address)
//   MAIL_PASSWORD            - SMTP password / app password
//   MAIL_TO (optional)       - where to send (defaults to MAIL_USERNAME)

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

const OWNER_UID = requireEnv('OWNER_UID');
const MAIL_USERNAME = requireEnv('MAIL_USERNAME');
const MAIL_PASSWORD = requireEnv('MAIL_PASSWORD');
const MAIL_TO = process.env.MAIL_TO || MAIL_USERNAME;

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

async function sendEmail(subject, text) {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: MAIL_USERNAME, pass: MAIL_PASSWORD }
  });
  await transporter.sendMail({
    from: `NoHungryPets <${MAIL_USERNAME}>`,
    to: MAIL_TO,
    subject,
    text
  });
}

async function main() {
  const now = new Date();

  const metaSnap = await META_REF.get();
  const lastCheck = (metaSnap.exists && toDate(metaSnap.data().lastCheck))
    || new Date(Date.now() - FIRST_RUN_LOOKBACK_MS);

  // Admin access bypasses security rules, so this reads every conversation the
  // owner is part of. The collection is small; no composite index needed.
  const snap = await db.collection('conversations')
    .where('participants', 'array-contains', OWNER_UID)
    .get();

  const fresh = [];
  snap.forEach(doc => {
    const c = doc.data() || {};
    const updated = toDate(c.lastUpdated);
    const unread = (c.unreadCount && c.unreadCount[OWNER_UID]) || 0;
    if (updated && updated > lastCheck && unread > 0) {
      fresh.push(c);
    }
  });

  if (fresh.length > 0) {
    const lines = fresh.map(c => {
      const about = c.relatedListingName ? `"${c.relatedListingName}"` : 'a listing';
      const preview = (c.lastMessage || '').trim().slice(0, 100);
      return `• ${about}${preview ? ` — ${preview}` : ''}`;
    });
    const n = fresh.length;
    const subject = `🐾 ${n} new message${n > 1 ? 's' : ''} on NoHungryPets`;
    const text =
      `You have ${n} new message${n > 1 ? 's' : ''} waiting on NoHungryPets:\n\n` +
      `${lines.join('\n')}\n\n` +
      `Read and reply: https://nohungrypets.co.uk/profile\n\n` +
      `— NoHungryPets`;
    await sendEmail(subject, text);
    console.log(`Emailed ${MAIL_TO} about ${n} conversation(s) with unread messages.`);
  } else {
    console.log('No new unread messages since last check.');
  }

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
