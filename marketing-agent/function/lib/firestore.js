'use strict';

/**
 * Read-only access to the live stats/global document, used by the
 * milestone/stat pillar. Uses the Firebase Admin SDK with Application Default
 * Credentials (the Cloud Function's own service account, granted only
 * roles/datastore.viewer via Terraform — read-only, least privilege).
 */

const admin = require('firebase-admin');

let app = null;

function getDb(databaseId = '(default)') {
  if (!app) {
    app = admin.initializeApp();
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
