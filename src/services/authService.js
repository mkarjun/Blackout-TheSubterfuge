/**
 * authService.js - Optional Firebase Auth (Google) + cloud snapshot bridge.
 *
 * Firebase is strictly opt-in. With no VITE_FIREBASE_* env vars the whole module
 * degrades to { ok:false, reason:'not-configured' } and the game keeps running on
 * IndexedDB alone - cloud sync is a backup channel, never a dependency.
 *
 * The SDK is dynamically imported on first use so an unconfigured build never pays
 * the firebase bundle cost at boot.
 */

import { exportSnapshot, importSnapshot } from './memoryStore.js';

const ENV = (typeof import.meta !== 'undefined' && import.meta.env) || {};

const firebaseConfig = {
  apiKey: ENV.VITE_FIREBASE_API_KEY,
  authDomain: ENV.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: ENV.VITE_FIREBASE_PROJECT_ID,
  storageBucket: ENV.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: ENV.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: ENV.VITE_FIREBASE_APP_ID,
};

/** Firestore hard-caps a document at 1 MiB; refuse before the write, not after. */
const MAX_SNAPSHOT_BYTES = 900 * 1024;

export function isCloudConfigured() {
  return Boolean(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId);
}

let _app = null;
let _auth = null;
let _db = null;
let _sdk = null;

async function ensureFirebase() {
  if (!isCloudConfigured()) return null;
  if (_app) return { app: _app, auth: _auth, db: _db, sdk: _sdk };

  const [{ initializeApp }, authMod, storeMod] = await Promise.all([
    import('firebase/app'),
    import('firebase/auth'),
    import('firebase/firestore'),
  ]);

  _app = initializeApp(firebaseConfig);
  _auth = authMod.getAuth(_app);
  _db = storeMod.getFirestore(_app);
  _sdk = { auth: authMod, store: storeMod };
  return { app: _app, auth: _auth, db: _db, sdk: _sdk };
}

/* ----------------------------------------------------------------- auth */

export async function signInWithGoogle() {
  const fb = await ensureFirebase();
  if (!fb) return { ok: false, reason: 'not-configured' };
  try {
    const provider = new fb.sdk.auth.GoogleAuthProvider();
    const cred = await fb.sdk.auth.signInWithPopup(fb.auth, provider);
    return { ok: true, user: serialiseUser(cred.user) };
  } catch (err) {
    return { ok: false, reason: err?.code || 'sign-in-failed', error: err?.message || String(err) };
  }
}

export async function signOutUser() {
  const fb = await ensureFirebase();
  if (!fb) return { ok: false, reason: 'not-configured' };
  try {
    await fb.sdk.auth.signOut(fb.auth);
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: 'sign-out-failed', error: err?.message || String(err) };
  }
}

/**
 * Subscribe to auth state.
 * @returns {Promise<Function>} unsubscribe (a no-op when unconfigured)
 */
export async function onAuthChanged(callback) {
  const fb = await ensureFirebase();
  if (!fb) {
    callback(null);
    return () => {};
  }
  return fb.sdk.auth.onAuthStateChanged(fb.auth, (user) => callback(user ? serialiseUser(user) : null));
}

export async function getCurrentUser() {
  const fb = await ensureFirebase();
  return fb?.auth?.currentUser ? serialiseUser(fb.auth.currentUser) : null;
}

function serialiseUser(u) {
  return {
    uid: u.uid,
    email: u.email,
    displayName: u.displayName,
    photoURL: u.photoURL,
  };
}

/* ---------------------------------------------------------- cloud sync */

function snapshotDocRef(fb, uid) {
  return fb.sdk.store.doc(fb.db, 'blackout_saves', uid);
}

/**
 * Push the whole local database to Firestore under the signed-in uid.
 * The API key is deliberately never uploaded.
 */
export async function backupToCloud() {
  const fb = await ensureFirebase();
  if (!fb) return { ok: false, reason: 'not-configured' };
  const user = fb.auth.currentUser;
  if (!user) return { ok: false, reason: 'not-signed-in' };

  try {
    const snapshot = await exportSnapshot({ includeSecrets: false });
    const payload = JSON.stringify(snapshot);
    const bytes = new Blob([payload]).size;
    if (bytes > MAX_SNAPSHOT_BYTES) {
      return {
        ok: false,
        reason: 'too-large',
        error: `Snapshot is ${(bytes / 1024).toFixed(0)}KB; the 900KB cloud limit was exceeded. Delete old sessions and retry.`,
      };
    }

    await fb.sdk.store.setDoc(snapshotDocRef(fb, user.uid), {
      payload,
      bytes,
      counts: snapshot.counts,
      updatedAt: fb.sdk.store.serverTimestamp(),
      client: snapshot.exportedAt,
    });

    return { ok: true, bytes, counts: snapshot.counts, at: snapshot.exportedAt };
  } catch (err) {
    return { ok: false, reason: 'backup-failed', error: err?.message || String(err) };
  }
}

/**
 * Pull the cloud snapshot back into IndexedDB.
 * @param {'merge'|'replace'} mode
 */
export async function restoreFromCloud(mode = 'replace') {
  const fb = await ensureFirebase();
  if (!fb) return { ok: false, reason: 'not-configured' };
  const user = fb.auth.currentUser;
  if (!user) return { ok: false, reason: 'not-signed-in' };

  try {
    const snap = await fb.sdk.store.getDoc(snapshotDocRef(fb, user.uid));
    if (!snap.exists()) return { ok: false, reason: 'no-backup' };

    const data = snap.data();
    const parsed = JSON.parse(data.payload);
    const counts = await importSnapshot(parsed, { mode });
    return { ok: true, counts, at: data.client || null };
  } catch (err) {
    return { ok: false, reason: 'restore-failed', error: err?.message || String(err) };
  }
}

/** Metadata about the stored backup without downloading/parsing the payload. */
export async function getCloudMeta() {
  const fb = await ensureFirebase();
  if (!fb) return { ok: false, reason: 'not-configured' };
  const user = fb.auth.currentUser;
  if (!user) return { ok: false, reason: 'not-signed-in' };
  try {
    const snap = await fb.sdk.store.getDoc(snapshotDocRef(fb, user.uid));
    if (!snap.exists()) return { ok: false, reason: 'no-backup' };
    const d = snap.data();
    return {
      ok: true,
      bytes: d.bytes,
      counts: d.counts,
      updatedAt: d.updatedAt?.toDate?.()?.toISOString?.() || d.client || null,
    };
  } catch (err) {
    return { ok: false, reason: 'meta-failed', error: err?.message || String(err) };
  }
}

/* ------------------------------------------------- local backup bridge */

/** Offline equivalent of a cloud backup: write the snapshot to the user's disk. */
export async function downloadSnapshotFile({ includeSecrets = false } = {}) {
  const snapshot = await exportSnapshot({ includeSecrets });
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `blackout-save-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { ok: true, counts: snapshot.counts };
}

/** Restore from a File picked in the AuthModal. */
export async function importSnapshotFile(file, mode = 'merge') {
  try {
    const text = await file.text();
    const counts = await importSnapshot(JSON.parse(text), { mode });
    return { ok: true, counts };
  } catch (err) {
    return { ok: false, reason: 'import-failed', error: err?.message || String(err) };
  }
}

export default {
  isCloudConfigured,
  signInWithGoogle,
  signOutUser,
  onAuthChanged,
  getCurrentUser,
  backupToCloud,
  restoreFromCloud,
  getCloudMeta,
  downloadSnapshotFile,
  importSnapshotFile,
};
