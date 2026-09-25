// @ts-check
/**
 * Firebase project for Live Rooms (REQ-067). **Fill this in to go live.**
 *
 * Until `databaseURL` is set, every room falls back to the local transport:
 * fully working across tabs on one machine, useless across devices. The host
 * view says which one is in play, so a classroom never discovers it the hard
 * way.
 *
 * ## What Jeff needs to do once (about ten minutes)
 *
 * 1. console.firebase.google.com → **Add project** (analytics not needed).
 * 2. **Build → Realtime Database → Create Database.** Pick the region, then
 *    start in **locked mode** — the rules below replace the defaults anyway.
 * 3. **Project settings → Your apps → Web (`</>`)** → register an app. Copy
 *    `apiKey`, `authDomain`, `databaseURL`, `projectId` into the object below.
 * 4. Paste the rules from `docs/live-rooms-firebase-rules.json` into
 *    **Realtime Database → Rules → Publish**. Do this *before* committing the
 *    config: until the rules are live, the default ones are what is public.
 * 5. **Authentication → Sign-in method → enable Google.**
 * 6. **Authentication → Settings → Authorized domains**: add `learnlens.org`.
 * 7. Open a room-enabled page, press *Start a class room*, sign in. It will
 *    refuse and show your account ID — paste that into **Realtime Database →
 *    Data** as `allowedHosts/<that-id>` = `true`. Press the button again.
 *    Colleagues are added the same way; there is deliberately no UI for it, and
 *    the allowlist is not writable from any browser by any account.
 *
 * These values are **not secrets** — every Firebase web app ships them to the
 * browser, and they identify the project rather than authorising anything. The
 * rules are the only enforcement there is, which is why steps 4 and 7 are what
 * actually keep the bill bounded: without an allowlist entry, nobody who finds
 * this config can open a room in the project.
 */

/** @type {{apiKey: string, authDomain: string, databaseURL: string, projectId: string}|null} */
export const FIREBASE_CONFIG = null;

// Once configured, replace the line above with, e.g.:
//
// export const FIREBASE_CONFIG = {
//   apiKey: 'AIza…',
//   authDomain: 'statlens-rooms.firebaseapp.com',
//   databaseURL: 'https://statlens-rooms-default-rtdb.firebaseio.com',
//   projectId: 'statlens-rooms',
// };

/** Pinned: a room in front of a class is not the place to discover a new SDK. */
export const FIREBASE_SDK_VERSION = '10.14.1';
