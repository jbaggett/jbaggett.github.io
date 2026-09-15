// @ts-check
/**
 * The Live Rooms panel any tool can mount (REQ-067).
 *
 * Two faces of one component, chosen by whether the page arrived with `?room=`:
 *
 *   - **Host** (the instructor, who pressed the button): a projector-sized room
 *     code, a QR beside it, a live "N responded" count, and Clear / Close /
 *     Reveal. Its job is to be readable from the back of a lecture hall.
 *   - **Student** (arrived by scanning): a quiet line confirming which room they
 *     are in and what will be sent. Nothing to configure, nothing to press.
 *
 * The host token is deliberately absent from everything on screen. It lives in
 * `localStorage` and never enters the join URL or the QR, because the instructor
 * is *projecting this page* — anything visible is visible to the whole class.
 *
 * The panel degrades rather than fails. If the transport is local-only (no
 * Firebase project configured) it says so plainly instead of letting a class
 * discover it; if a room cannot be reached it says that too. A wifi hiccup in a
 * lecture hall must cost the activity nothing more than the aggregate.
 */

import { createRoom, joinRoom, localTransport, normaliseCode, codeProblem,
  SCOPE_NOTICE, SCOPE_DETAIL } from './live-room.js';
import { firebaseTransport, firebaseConfigured } from './live-room-firebase.js';
import { ensureQrLib, plainQrSvg } from './qr.js';

/** Real rooms when a project is configured, cross-tab rooms otherwise. */
export const activeTransport = firebaseConfigured ? firebaseTransport : localTransport;

/**
 * @typedef {object} MountOptions
 * @property {HTMLElement} container - where the panel is rendered
 * @property {string} activity - identifies the tool, stored on the room
 * @property {string} label - what a published value means ('by-eye sample mean')
 * @property {(state: {values: number[], count: number, meta: any}) => void} onUpdate
 *   - host only: called whenever the class's values change
 */

/**
 * @param {MountOptions} opts
 * @returns {Promise<{room: import('./live-room.js').Room|null, publish: (v: number) => void}>}
 */
export async function mountLiveRoom(opts) {
  const { container, activity, label } = opts;
  const params = new URLSearchParams(location.search);
  const joining = normaliseCode(params.get('room') || '');

  /** @type {import('./live-room.js').Room|null} */
  let room = null;

  // A student who scanned the QR: join, confirm, and stay out of the way.
  if (joining) {
    const problem = codeProblem(joining);
    if (problem) {
      container.innerHTML = `<div class="room-panel room-error"><p>${problem}</p></div>`;
      return { room: null, publish: () => {} };
    }
    room = await joinRoom(joining, { transport: activeTransport, activity });
    const meta = await activeTransport.getMeta(joining);
    if (!meta) {
      container.innerHTML = `<div class="room-panel room-error">
           <p>Room <strong>${joining}</strong> isn't open. Check the code on the screen, or carry on
              on your own — the tool works exactly the same without a room.</p>
         </div>`;
      return { room: null, publish: () => {} };
    }

    const scope = meta.scope ?? 'room';
    // One compact notice per session, not per submit: after the first join it
    // shrinks to a single line. Never a modal, never something to dismiss
    // before answering.
    const SEEN = 'statlens.liveRoom.noticeSeen';
    let seen = false;
    try { seen = sessionStorage.getItem(SEEN) === '1'; } catch { /* no session storage */ }
    try { sessionStorage.setItem(SEEN, '1'); } catch { /* fine */ }

    let watching = watchOnly(joining);

    const paint = () => {
      container.innerHTML = `<div class="room-panel room-joined">
        <p><strong>You're in room ${joining}.</strong>
           ${watching
             ? `You're watching the class result without sending anything.`
             : `Your ${escapeHtml(label)}, with no name attached,
                ${escapeHtml(SCOPE_NOTICE[scope] ?? SCOPE_NOTICE.room)}`}</p>
        ${seen || watching ? '' : `<details class="room-what"><summary>What's this?</summary>
           <p>${escapeHtml(SCOPE_DETAIL[scope] ?? SCOPE_DETAIL.room)}</p></details>`}
        <p class="hint room-watch-line">${watching
          ? `<button type="button" class="room-watch-toggle link-button">Join in after all</button>`
          : `<button type="button" class="room-watch-toggle link-button">Just watch instead</button>`}</p>
      </div>`;
      container.querySelector('.room-watch-toggle')?.addEventListener('click', () => {
        watching = !watching;
        setWatchOnly(joining, watching);
        paint();
      });
    };
    paint();

    // Students see the class picture build too — which is what makes "just
    // watch" a real option rather than a way to miss the lesson.
    room.subscribe((state) => opts.onUpdate?.(state));

    return {
      room,
      publish: (v) => { if (!watchOnly(joining)) room?.publish(v); },
    };
    return { room, publish: (v) => { room?.publish(v); } };
  }

  // Otherwise: an instructor who might want to start one.
  container.innerHTML = `<div class="room-panel expert-only">
      <button type="button" class="btn-secondary room-start">Start a class room</button>
      <p class="hint room-start-hint">Students scan a code and their results build one shared
         picture. Anonymous, and it disappears after the class.</p>
    </div>`;

  container.querySelector('.room-start')?.addEventListener('click', async () => {
    room = await createRoom({ transport: activeTransport, activity, label });
    renderHost(container, room, opts);
  });

  return { room: null, publish: (v) => { room?.publish(v); } };
}

/**
 * @param {HTMLElement} container
 * @param {import('./live-room.js').Room} room
 * @param {MountOptions} opts
 */
function renderHost(container, room, opts) {
  const shared = room.transport.shared;
  container.innerHTML = `<div class="room-panel room-host">
      <div class="room-code-block">
        <div class="room-qr" aria-hidden="true"></div>
        <div>
          <p class="room-code-label">Room code</p>
          <p class="room-code">${room.code}</p>
          <p class="hint room-join-url">${escapeHtml(room.joinUrl)}</p>
        </div>
      </div>
      <p class="room-count" aria-live="polite"><strong>0</strong> responses</p>
      <div class="btn-row">
        <button type="button" class="btn-secondary room-clear">Clear</button>
        <button type="button" class="btn-secondary room-reveal">Reveal the truth</button>
        <button type="button" class="btn-secondary room-close">Close room</button>
      </div>
      ${shared ? '' : `<p class="hint room-warning"><strong>Not connected to a room service.</strong>
         This works across tabs on this computer, so you can rehearse the activity — but students'
         phones cannot reach it. See <code>js/live-room-config.js</code>.</p>`}
      <p class="hint">Responses are anonymous and counted per device, so the number is devices that
         answered, not people present.</p>
    </div>`;

  const qrBox = /** @type {HTMLElement} */ (container.querySelector('.room-qr'));
  ensureQrLib()
    .then(() => { qrBox.innerHTML = plainQrSvg(room.joinUrl, { cellSize: 8 }); })
    .catch(() => { qrBox.innerHTML = '<p class="hint">QR unavailable — read the code out.</p>'; });

  const countEl = /** @type {HTMLElement} */ (container.querySelector('.room-count'));
  room.subscribe((state) => {
    countEl.innerHTML = `<strong>${state.count}</strong> response${state.count === 1 ? '' : 's'}`;
    opts.onUpdate?.(state);
  });

  container.querySelector('.room-clear')?.addEventListener('click', () => room.clear());
  container.querySelector('.room-reveal')?.addEventListener('click', () => room.reveal());
  container.querySelector('.room-close')?.addEventListener('click', async () => {
    await room.close();
    const btn = /** @type {HTMLButtonElement} */ (container.querySelector('.room-close'));
    btn.disabled = true;
    btn.textContent = 'Room closed';
  });
}

/** "Just watch" is per room and per device; it is not a server-side state. */
const watchKey = (/** @type {string} */ code) => `statlens.liveRoom.watch.${code}`;
function watchOnly(/** @type {string} */ code) {
  try { return localStorage.getItem(watchKey(code)) === '1'; } catch { return false; }
}
function setWatchOnly(/** @type {string} */ code, /** @type {boolean} */ on) {
  try {
    if (on) localStorage.setItem(watchKey(code), '1');
    else localStorage.removeItem(watchKey(code));
  } catch { /* nothing to remember it with */ }
}

/** @param {string} s */
function escapeHtml(s) {
  return String(s).replace(/[<>&"]/g, c =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c] ?? c);
}
