// @ts-check
/**
 * Firebase Realtime Database transport for Live Rooms (REQ-067).
 *
 * Satisfies the same four-method interface as `localTransport`, so everything
 * above it — the host view, the student join, the pilot — is identical whether a
 * room is running across a lecture hall or across two tabs on one laptop.
 *
 * The SDK is imported from gstatic on first use rather than at page load, so a
 * tool that never opens a room pays nothing for this file existing. StatLens
 * already loads D3, jStat and KaTeX the same way.
 *
 * ## Data shape
 *
 *     rooms/<CODE>/meta     — created, expires, closed, revealed, scope,
 *                             lifecycle, activity, label
 *     rooms/<CODE>/entries/<clientId> — { v: <number>, t: <ms> }
 *
 * One entry per device, keyed by the device's own id, which is what makes a
 * resubmit an update rather than a second vote.
 *
 * ## Who has to sign in, and why it is only one person
 *
 * Creating a room requires a Google account on an allowlist; joining one
 * requires nothing. That asymmetry is the whole cost-control design: StatLens
 * is public and a Firebase web config is public by design, so without a gate
 * anyone who read the source could open rooms and spend the project's free-tier
 * connections. The gate has to sit on *creation*, because that is the act that
 * costs something — and it has to stay off *joining*, because a login between a
 * student and a one-tap answer would cost the activity far more than the quota
 * is worth.
 *
 * ## What the rules still cannot do (read this before stage 2)
 *
 * Entry writes remain anonymous, so for them the rules in
 * `docs/live-rooms-firebase-rules.json` enforce *shape* rather than *authority*:
 * a value must be a number in range, the room must exist and be open, entries
 * are size-capped and keyed per device. Anyone inside a room can overwrite
 * another device's entry. For throwaway class numbers under a code that expires
 * in hours that is a reasonable trade; it stops being reasonable the moment
 * anything is kept, which is exactly where stage 2 begins — scope 'section' or
 * 'uwl-course-pool' needs per-student identity before it stores anything.
 */

import { FIREBASE_CONFIG, FIREBASE_SDK_VERSION } from './live-room-config.js';

const V = FIREBASE_SDK_VERSION;

/** @type {Promise<any>|null} */
let sdkPromise = null;

function loadSdk() {
  if (!sdkPromise) {
    sdkPromise = Promise.all([
      import(/* @vite-ignore */ `https://www.gstatic.com/firebasejs/${V}/firebase-app.js`),
      import(/* @vite-ignore */ `https://www.gstatic.com/firebasejs/${V}/firebase-database.js`),
      import(/* @vite-ignore */ `https://www.gstatic.com/firebasejs/${V}/firebase-auth.js`),
    ]).then(([app, db, auth]) => {
      const instance = app.initializeApp(FIREBASE_CONFIG);
      return { db, database: db.getDatabase(instance), auth, authInstance: auth.getAuth(instance) };
    });
  }
  return sdkPromise;
}

/** True when a project has actually been configured. */
export const firebaseConfigured = !!(FIREBASE_CONFIG && FIREBASE_CONFIG.databaseURL);

/**
 * Instructor sign-in — the only account in the whole feature.
 *
 * Creating a room writes `rooms/<CODE>/meta`, which the rules allow only for a
 * signed-in uid present in `allowedHosts`. That is what bounds the project's
 * quota to people Jeff has approved, on a site anyone can load with a config
 * that is public by design.
 *
 * Students are never touched by any of this: joining and publishing stay
 * anonymous, which is what REQ-067 asked for and what participation depends on.
 */
export async function signInHost() {
  const { auth, authInstance } = await loadSdk();
  const provider = new auth.GoogleAuthProvider();
  const cred = await auth.signInWithPopup(authInstance, provider);
  return cred.user;
}

/** The signed-in instructor, or null. Resolves once Firebase has restored state. */
export async function currentHost() {
  const { auth, authInstance } = await loadSdk();
  if (authInstance.currentUser) return authInstance.currentUser;
  return new Promise((resolve) => {
    const un = auth.onAuthStateChanged(authInstance, (u) => { un(); resolve(u); });
  });
}

/** Is this signed-in account allowed to open rooms in this project? */
export async function hostIsAllowed(uid) {
  const { db, database } = await loadSdk();
  try {
    const snap = await db.get(db.ref(database, `allowedHosts/${uid}`));
    return snap.exists();
  } catch {
    // The rules let an account read only its own allowlist entry, so a denial
    // here means "not on the list" rather than "something broke".
    return false;
  }
}

const roomPath = (/** @type {string} */ code) => `rooms/${code}`;

/** @type {import('./live-room.js').Transport} */
export const firebaseTransport = {
  name: 'firebase',
  shared: true,

  async create(code, meta) {
    const { db, database } = await loadSdk();
    await db.set(db.ref(database, `${roomPath(code)}/meta`), meta);
  },

  async getMeta(code) {
    const { db, database } = await loadSdk();
    const snap = await db.get(db.ref(database, `${roomPath(code)}/meta`));
    return snap.exists() ? snap.val() : null;
  },

  async read(code) {
    const { db, database } = await loadSdk();
    const snap = await db.get(db.ref(database, roomPath(code)));
    const val = snap.exists() ? snap.val() : {};
    return { meta: val.meta ?? null, entries: val.entries ?? {} };
  },

  async patchMeta(code, patch) {
    const { db, database } = await loadSdk();
    await db.update(db.ref(database, `${roomPath(code)}/meta`), patch);
  },

  async put(code, clientId, entry) {
    const { db, database } = await loadSdk();
    const at = db.ref(database, `${roomPath(code)}/entries/${clientId}`);
    if (entry === null) await db.remove(at);
    else await db.set(at, entry);
  },

  /**
   * Hand the connection back.
   *
   * This is the method that decides whether the next class can start. Firebase
   * holds one socket per *client*, not per listener, so dropping every
   * `onValue` would still leave the connection counted against the project's
   * 100 — `goOffline` is the only thing that actually releases it. Listeners
   * stay registered and keep serving from cache, and writes queue, which is why
   * the room wakes before publishing rather than trusting the offline queue.
   */
  release() {
    // Never load the SDK just to disconnect: a page that never opened a room
    // has no socket to release, and fetching 300 kB to say so would be absurd.
    if (!sdkPromise) return;
    sdkPromise.then(({ db, database }) => db.goOffline(database)).catch(() => {});
  },

  resume() {
    if (!sdkPromise) return;
    sdkPromise.then(({ db, database }) => db.goOnline(database)).catch(() => {});
  },

  subscribe(code, cb) {
    /** @type {(() => void)|null} */
    let off = null;
    let cancelled = false;
    loadSdk().then(({ db, database }) => {
      if (cancelled) return;
      off = db.onValue(db.ref(database, roomPath(code)), (snap) => {
        const val = snap.exists() ? snap.val() : {};
        cb({ meta: val.meta ?? null, entries: val.entries ?? {} });
      }, () => {
        // Permission denied, network gone, project misconfigured: report an
        // empty room rather than throwing into the render loop. The host view
        // shows a connection warning and the manual fallback stays available —
        // a wifi hiccup must not end the activity.
        cb({ meta: null, entries: {} });
      });
    });
    return () => {
      cancelled = true;
      off?.();
    };
  },
};
