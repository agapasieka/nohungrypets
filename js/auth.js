// Copyright (c) 2026 NoHungryPets
// NoHungryPets - Firebase Auth
// Uses Firebase v9+ CDN (compat mode for simplicity with GitHub Pages)

// ── CANONICAL URL ─────────────────────────────────────────
// GitHub Pages serves foo.html at both /foo.html and /foo (extensionless)
// without redirecting. Anyone who lands on the .html form (old bookmark,
// external link, direct index.html hit) gets silently normalized to the
// clean URL via replaceState - no reload, just an address-bar rewrite.
(function canonicalizeUrl() {
  const path = location.pathname;
  let clean = null;
  if (path.endsWith('/index.html')) {
    clean = path.slice(0, -'index.html'.length);
  } else if (path.endsWith('.html') && path !== '/404.html') {
    clean = path.slice(0, -'.html'.length);
  }
  if (clean && clean !== path) {
    history.replaceState(null, '', clean + location.search + location.hash);
  }
})();

// ── CONFIG ──────────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyBzWFSJjpxW0InPNCXktzT-RTfQmT4NJTk",
  authDomain: "nohungrypets.firebaseapp.com",
  projectId: "nohungrypets",
  storageBucket: "nohungrypets.firebasestorage.app",
  messagingSenderId: "145249046661",
  appId: "1:145249046661:web:11c30f62ce646db13159ec",
  measurementId: "G-WPJ1HRHN87"
};

// ── INIT (only once) ─────────────────────────────────────
if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

// ── APP CHECK ─────────────────────────────────────────────
// Attaches App Check tokens to Firebase requests. Enforcement is ON for
// Firestore + Identity Toolkit (switched on 2026-08-01, see claude-docs
// plan doc) — this activation is what obtains the token attached to every
// request. Guarded like Analytics below so a bad/missing site key never
// breaks page load.
try {
  firebase.appCheck().activate(
    new firebase.appCheck.ReCaptchaV3Provider('6LffoHAtAAAAAKJyIzxclw2Pwv_9uekwUfXn8J_v'),
    true
  );
} catch (err) {
  console.warn('App Check init skipped:', err);
}

const auth = firebase.auth();
const db   = firebase.firestore();

// ── ANALYTICS (GA4) ──────────────────────────────────────
// Traffic/behaviour tracking via Firebase Analytics. Not strictly
// necessary, so it's gated on cookie consent (see the banner in
// js/main.js) - only runs if the user has previously accepted, or the
// instant they click Accept. Guarded so the placeholder (or any
// invalid/missing) measurementId never throws or breaks page load.
function enableAnalytics() {
  try {
    if (typeof firebase.analytics === 'function'
        && firebaseConfig.measurementId
        && firebaseConfig.measurementId !== 'G-XXXXXXXXXX') {
      firebase.analytics();
    }
  } catch (err) {
    console.warn('Firebase Analytics init skipped:', err);
  }
}
if (localStorage.getItem('nhp-cookie-consent') === 'accepted') {
  enableAnalytics();
}

// ── GLOBAL PLATFORM STATS ────────────────────────────────
// Denormalised vanity counters (totalUsers/totalListings/totalClaims)
// shown on the admin dashboard. Uses set+merge with an atomic increment
// so the stats/global doc is created lazily on first write — no seeding.
async function incrementGlobalStat(field) {
  try {
    await db.collection('stats').doc('global').set(
      { [field]: firebase.firestore.FieldValue.increment(1) },
      { merge: true }
    );
  } catch (err) {
    console.error('Error incrementing global stat:', field, err);
  }
}

// ── GOOGLE PROVIDER ──────────────────────────────────────
const googleProvider = new firebase.auth.GoogleAuthProvider();

// ── SIGN UP with email/password ──────────────────────────
async function signUp(name, email, password, postcode) {
  try {
    const result = await auth.createUserWithEmailAndPassword(email, password);
    // Save extra user info to Firestore
    await db.collection('users').doc(result.user.uid).set({
      name,
      email,
      postcode,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      listings: 0,
      claims: 0
    });
    // Update display name
    await result.user.updateProfile({ displayName: name });
    // Send a verification email — this doubles as the welcome email (its
    // wording/sender are set in the Firebase Console email template). Soft
    // flow: we don't block the user; a banner (js/main.js) nudges them to
    // verify. Non-fatal — a send failure must not break signup.
    try {
      await result.user.sendEmailVerification({ url: 'https://nohungrypets.co.uk/login' });
    } catch (verifyErr) {
      console.warn('Could not send verification email:', verifyErr);
    }
    // Bump global signup counter (vanity metric for admin dashboard)
    await incrementGlobalStat('totalUsers');
    return { success: true, user: result.user };
  } catch (err) {
    return { success: false, error: friendlyError(err.code) };
  }
}

// ── LOG IN with email/password ───────────────────────────
async function logIn(email, password) {
  try {
    const result = await auth.signInWithEmailAndPassword(email, password);
    return { success: true, user: result.user };
  } catch (err) {
    return { success: false, error: friendlyError(err.code) };
  }
}

// ── SIGN IN with Google ──────────────────────────────────
async function signInWithGoogle() {
  try {
    const result = await auth.signInWithPopup(googleProvider);
    // Create Firestore record if first time
    const userDoc = await db.collection('users').doc(result.user.uid).get();
    if (!userDoc.exists) {
      await db.collection('users').doc(result.user.uid).set({
        name: result.user.displayName,
        email: result.user.email,
        postcode: '',
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        listings: 0,
        claims: 0
      });
      // Bump global signup counter (vanity metric for admin dashboard)
      await incrementGlobalStat('totalUsers');
    }
    return { success: true, user: result.user };
  } catch (err) {
    return { success: false, error: friendlyError(err.code) };
  }
}

// ── LOG OUT ──────────────────────────────────────────────
async function logOut() {
  await auth.signOut();
  window.location.href = '/';
}

// ── ACCOUNT DELETION (GDPR right to erasure) ─────────────
// Re-authenticate the current user. Deleting an account requires a recent
// login, so callers must run this (with the user's password) first. Google
// accounts re-auth via a popup instead.
async function reauthenticateUser(password) {
  const user = auth.currentUser;
  if (!user) throw new Error('not-signed-in');
  const providerId = (user.providerData[0] && user.providerData[0].providerId) || 'password';
  if (providerId === 'google.com') {
    await user.reauthenticateWithPopup(googleProvider);
  } else {
    const cred = firebase.auth.EmailAuthProvider.credential(user.email, password);
    await user.reauthenticateWithCredential(cred);
  }
}

// Permanently delete the signed-in user's account and personal data:
// their listings, their profile document, then the Auth account itself.
// Call reauthenticateUser() immediately before this.
// Note: shared conversations/messages are left in place (deleting them would
// also remove the other participant's history); and Cloudinary images aren't
// removable from the client with an unsigned preset — both are handled by a
// periodic server-side cleanup rather than here.
async function deleteAccountAndData() {
  const user = auth.currentUser;
  if (!user) throw new Error('not-signed-in');
  const uid = user.uid;

  // 1. Delete the user's listings (batched; a user won't exceed the 500 cap).
  const listingsSnap = await db.collection('listings').where('userId', '==', uid).get();
  if (!listingsSnap.empty) {
    const batch = db.batch();
    listingsSnap.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
  }

  // 2. Delete the user's profile document.
  await db.collection('users').doc(uid).delete().catch(() => {});

  // 3. Delete the Firebase Auth account (needs the recent re-auth above).
  await user.delete();
}

// ── PASSWORD RESET ───────────────────────────────────────
async function resetPassword(email) {
  try {
    await auth.sendPasswordResetEmail(email);
    return { success: true };
  } catch (err) {
    return { success: false, error: friendlyError(err.code) };
  }
}

// ── AUTH STATE LISTENER ──────────────────────────────────
// Call this on any page to react to login/logout
function onAuthChange(callback) {
  auth.onAuthStateChanged(callback);
}

// ── REDIRECT if not logged in ────────────────────────────
function requireAuth() {
  auth.onAuthStateChanged(user => {
    if (!user) window.location.href = '/login';
  });
}

// ── GET current user profile from Firestore ───────────────
async function getUserProfile(uid) {
  const doc = await db.collection('users').doc(uid).get();
  return doc.exists ? doc.data() : null;
}

// ── UPDATE last-seen-listings timestamp ───────────────────
// Records when the user last checked nearby-listing notifications,
// so the badge only counts listings posted after this point.
async function updateLastSeenListings(uid) {
  try {
    await db.collection('users').doc(uid).update({
      lastSeenListingsAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  } catch (err) {
    console.error('Error updating lastSeenListingsAt:', err);
  }
}

// ── FRIENDLY ERROR MESSAGES ──────────────────────────────
function friendlyError(code) {
  const messages = {
    'auth/email-already-in-use':  'That email is already registered. Try logging in instead.',
    'auth/weak-password':         'Password must be at least 6 characters.',
    'auth/invalid-email':         'Please enter a valid email address.',
    'auth/user-not-found':        'No account found with that email.',
    'auth/wrong-password':        'Incorrect password. Try again or reset it.',
    'auth/too-many-requests':     'Too many attempts. Please wait a moment.',
    'auth/network-request-failed':'Connection error. Check your internet.',
    'auth/popup-closed-by-user':  'Google sign-in was cancelled.',
  };
  return messages[code] || 'Something went wrong. Please try again.';
}


if (window.location.hostname === "localhost") {
  firebase.auth().useEmulator("http://localhost:9099");
  firebase.firestore().useEmulator("localhost", 8080);
}
