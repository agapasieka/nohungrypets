'use strict';

/**
 * Read-only access to the live stats/global document, used by the
 * milestone/stat pillar. Uses the Firebase Admin SDK.
 *
 * Credentials: a dedicated GCP service account granted ONLY
 * roles/datastore.viewer (read-only, least privilege). Its JSON key is stored
 * in the GitHub Actions repo secret FIREBASE_SA_KEY and injected as an env var.
 * The value may be either the raw JSON key or a base64 encoding of it. If the
 * env var is absent we fall back to Application Default Credentials
 * (GOOGLE_APPLICATION_CREDENTIALS / gcloud login) for convenient local runs.
 *
 * Creating this service account + key requires NO GCP billing account —
 * IAM/service-account management and Firestore Native-mode reads work on the
 * free Firebase Spark plan. See ../README.md for the exact setup commands.
 */

const admin = require('firebase-admin');

let app = null;

/** Parse FIREBASE_SA_KEY (raw JSON or base64-encoded JSON) → object, or null. */
function loadServiceAccount() {
  const raw = process.env.FIREBASE_SA_KEY;
  if (!raw || raw.trim() === '') return null;
  const value = raw.trim();
  try {
    return JSON.parse(value);
  } catch (_) {
    // Not raw JSON — try base64.
    try {
      return JSON.parse(Buffer.from(value, 'base64').toString('utf8'));
    } catch (err) {
      throw new Error('FIREBASE_SA_KEY is set but is neither valid JSON nor base64-encoded JSON');
    }
  }
}

function getDb(databaseId = '(default)') {
  if (!app) {
    const serviceAccount = loadServiceAccount();
    app = serviceAccount
      ? admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
          projectId: serviceAccount.project_id,
        })
      : admin.initializeApp(); // Application Default Credentials (local dev).
  }
  // firebase-admin >= 11 supports named databases; '(default)' is the default.
  return databaseId && databaseId !== '(default)'
    ? admin.firestore(app, databaseId)
    : admin.firestore(app);
}

/**
 * Fetch the community stats. Returns null on any error or missing doc so the
 * caller can gracefully fall back to a numbers-free milestone post rather than
 * failing the whole run.
 *
 * @param {string} docPath e.g. "stats/global"
 * @returns {Promise<{totalUsers:number,totalListings:number,totalClaims:number}|null>}
 */
async function readStats(docPath = 'stats/global', databaseId = '(default)') {
  try {
    const db = getDb(databaseId);
    const snap = await db.doc(docPath).get();
    if (!snap.exists) return null;
    const data = snap.data() || {};
    return {
      totalUsers: Number(data.totalUsers) || 0,
      totalListings: Number(data.totalListings) || 0,
      totalClaims: Number(data.totalClaims) || 0,
    };
  } catch (err) {
    console.error('Failed to read stats from Firestore:', err.message);
    return null;
  }
}

module.exports = { readStats };
