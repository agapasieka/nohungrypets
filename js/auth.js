// Copyright (c) 2026 NoHungryPets
// NoHungryPets - Firebase Auth
// Uses Firebase v9+ CDN (compat mode for simplicity with GitHub Pages)

// ── CONFIG ──────────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyBzWFSJjpxW0InPNCXktzT-RTfQmT4NJTk",
  authDomain: "nohungrypets.firebaseapp.com",
  projectId: "nohungrypets",
  storageBucket: "nohungrypets.firebasestorage.app",
  messagingSenderId: "145249046661",
  appId: "1:145249046661:web:11c30f62ce646db13159ec",
  measurementId: "G-XXXXXXXXXX" // TODO: replace with real measurementId from Firebase Console > Analytics
};

// ── INIT (only once) ─────────────────────────────────────
if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}
const auth = firebase.auth();
const db   = firebase.firestore();

// ── ANALYTICS (GA4) ──────────────────────────────────────
// Traffic/behaviour tracking via Firebase Analytics. Guarded so the
// placeholder (or any invalid/missing) measurementId never throws or
// breaks page load — real data only flows once a real ID is swapped in.
try {
  if (typeof firebase.analytics === 'function'
      && firebaseConfig.measurementId
      && firebaseConfig.measurementId !== 'G-XXXXXXXXXX') {
    firebase.analytics();
  }
} catch (err) {
  console.warn('Firebase Analytics init skipped:', err);
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
  window.location.href = 'index.html';
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
    if (!user) window.location.href = 'login.html';
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
