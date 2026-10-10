// One-off maintenance: remove the legacy `posterEmail` field from listing
// documents created before the privacy fix. Listings are publicly readable,
// so that field exposed poster emails; it is no longer written to new listings.
//
// Runs in GitHub Actions with the Firebase service account (admin access).
// Default is a DRY RUN: it only counts and lists affected listings. Set the
// `apply` input to "true" to actually delete the field.
//
// Environment:
//   FIREBASE_SA_KEY - full JSON of a Firebase service account key
//   APPLY           - "true" to delete; anything else = dry run (count only)

const admin = require('firebase-admin');

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return v;
}

const APPLY = (process.env.APPLY || '').toLowerCase() === 'true';

let serviceAccount;
try {
  serviceAccount = JSON.parse(requireEnv('FIREBASE_SA_KEY'));
} catch (err) {
  console.error('FIREBASE_SA_KEY is not valid JSON:', err.message);
  process.exit(1);
}

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function main() {
  const snap = await db.collection('listings').get();

  const affected = [];
  snap.forEach(doc => {
    const data = doc.data() || {};
    if (Object.prototype.hasOwnProperty.call(data, 'posterEmail')) {
      affected.push(doc.id);
    }
  });

  console.log(`Total listings: ${snap.size}`);
  console.log(`Listings with a posterEmail field: ${affected.length}`);
  if (affected.length) {
    console.log('Affected document IDs:');
    affected.forEach(id => console.log(`  - ${id}`));
  }

  if (!APPLY) {
    console.log('\nDRY RUN — nothing was changed. Re-run with apply=true to remove the field.');
    return;
  }

  if (affected.length === 0) {
    console.log('\nNothing to remove.');
    return;
  }

  // Delete the field in batches of up to 400 (Firestore limit is 500/commit).
  let removed = 0;
  for (let i = 0; i < affected.length; i += 400) {
    const batch = db.batch();
    for (const id of affected.slice(i, i + 400)) {
      batch.update(db.collection('listings').doc(id), {
        posterEmail: admin.firestore.FieldValue.delete()
      });
    }
    await batch.commit();
    removed += Math.min(400, affected.length - i);
    console.log(`Removed posterEmail from ${removed}/${affected.length}…`);
  }

  console.log(`\nDone. Removed posterEmail from ${removed} listing(s).`);
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Scrub failed:', err);
    process.exit(1);
  });
