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
 * ## What the rules can and cannot do (read this before stage 2)
 *
 * Stage 1 is anonymous: no sign-in, so the database has no identity to check.
 * The rules in `docs/live-rooms-firebase-rules.json` therefore enforce *shape*
 * rather than *authority* — a value must be a number in range, a room must
 * exist and be open, entries are size-capped, and `meta` cannot be rewritten
 * once created except for the two flags a host toggles. Anyone holding a room
 * code can write to that room.
 *
 * For throwaway class numbers under a code that expires in hours, that is a
 * reasonable trade. It stops being reasonable the moment anything is kept, which
 * is exactly where stage 2 begins — and stage 2 should start by adding Firebase
 * anonymous auth so `auth.uid` exists and the rules can enforce the host token
 * instead of trusting it.
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
    ]).then(([app, db]) => {
      const instance = app.initializeApp(FIREBASE_CONFIG);
      return { db, database: db.getDatabase(instance) };
    });
  }
  return sdkPromise;
}

/** True when a project has actually been configured. */
export const firebaseConfigured = !!(FIREBASE_CONFIG && FIREBASE_CONFIG.databaseURL);

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
