// @ts-check
/**
 * Firebase project for Live Rooms (REQ-067). **Fill this in to go live.**
 *
 * Until `databaseURL` is set, every room falls back to the local transport:
 * fully working across tabs on one machine, useless across devices. The host
 * view says which one is in play, so a classroom never discovers it the hard
 * way.
 *
 * ## What Jeff needs to do once (about five minutes)
 *
 * 1. console.firebase.google.com → **Add project** (analytics not needed).
 * 2. **Build → Realtime Database → Create Database.** Pick the region, then
 *    start in **locked mode** — the rules below replace the defaults anyway.
 * 3. **Project settings → Your apps → Web (`</>`)** → register an app. Copy
 *    `apiKey`, `authDomain`, `databaseURL`, `projectId` into the object below.
 * 4. Paste the rules from `docs/live-rooms-firebase-rules.json` into
 *    **Realtime Database → Rules → Publish**.
 *
 * These values are **not secrets** — every Firebase web app ships them to the
 * browser, and they identify the project rather than authorising anything. What
 * protects the data is the rules file, which is why step 4 is not optional.
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
