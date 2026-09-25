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
import { firebaseTransport, firebaseConfigured, signInHost, currentHost,
  hostIsAllowed } from './live-room-firebase.js';
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
    let paused = false;
    let over = meta.closed === true || meta.expires <= Date.now();
    // Whether *this* device sent anything, so the closing message can be true
    // for both the student who answered and the one who arrived after the bell.
    let published = false;

    const paint = () => {
      // A finished room, a parked connection, or a live one — in that order of
      // precedence, because each makes the one below it irrelevant.
      if (over) {
        container.innerHTML = `<div class="room-panel room-joined">
          <p><strong>Room ${joining} has closed.</strong>
             ${published
               ? `Thanks — your answer is in.`
               : `Nothing was sent from this device.`}
             The tool still works exactly the same on your own.</p>
        </div>`;
        return;
      }
      if (paused) {
        container.innerHTML = `<div class="room-panel room-joined">
          <p><strong>Paused.</strong> Your answer is still counted — this page just let go of the
             class connection so it's free for the next section.</p>
          <p class="hint room-watch-line">
            <button type="button" class="room-resume link-button">Show the latest</button></p>
        </div>`;
        container.querySelector('.room-resume')?.addEventListener('click', () => room?.wake());
        return;
      }
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

    if (over) {
      // Reading `meta` was itself enough to open a connection. A stale QR code
      // scanned hours later must not keep holding one.
      room.leave();
      return { room: null, publish: () => {} };
    }

    // Students see the class picture build too — which is what makes "just
    // watch" a real option rather than a way to miss the lesson.
    room.subscribe((state) => {
      if (state.over && !over) { over = true; paint(); }
      opts.onUpdate?.(state);
    });
    room.onPresence(({ asleep, stopped }) => {
      // A room that simply runs out of time produces no data change, so the
      // only signal that it is over is the connection being released for good.
      if (stopped && !over) { over = true; paint(); return; }
      const next = asleep && !stopped;
      if (next !== paused) { paused = next; paint(); }
    });

    return {
      room,
      publish: (v) => {
        if (watchOnly(joining)) return;
        published = true;
        room?.publish(v);
      },
    };
  }

  // Otherwise: an instructor who might want to start one.
  renderStart(container, opts, (r) => { room = r; renderHost(container, r, opts); });

  return { room: null, publish: (v) => { room?.publish(v); } };
}

/**
 * The pre-room state: one button, and — on a real project — the sign-in that
 * has to happen before it.
 *
 * **Why an instructor signs in and a student never does.** The database rules
 * let only an allow-listed account create a room, because a public site
 * carrying a public Firebase config would otherwise let anyone spend the
 * project's connection quota. Joining stays wide open: no login, no identity,
 * one tap — which is what the activity depends on. So the whole cost of the
 * limit lands on one person, once, on their own laptop.
 *
 * Sign-in is a separate click rather than something folded into "Start", so the
 * popup opens from a real user gesture (Safari blocks popups that appear after
 * an async hop) and so the SDK is still fetched only when a room is actually
 * wanted.
 *
 * @param {HTMLElement} container
 * @param {MountOptions} opts
 * @param {(room: import('./live-room.js').Room) => void} onStarted
 * @param {{stage?: 'idle'|'signin', note?: string}} [state]
 */
function renderStart(container, opts, onStarted, state = {}) {
  const needsAuth = activeTransport === firebaseTransport;
  const signingIn = state.stage === 'signin';
  container.innerHTML = `<div class="room-panel expert-only">
      <button type="button" class="btn-secondary room-start">${
        signingIn ? 'Sign in with Google' : 'Start a class room'}</button>
      <p class="hint room-start-hint">Students scan a code and their results build one shared
         picture. Anonymous, and it disappears after the class.${
           needsAuth ? ' Students never sign in — only you do.' : ''}</p>
      ${state.note ? `<p class="hint room-warning">${state.note}</p>` : ''}
    </div>`;

  const btn = /** @type {HTMLButtonElement} */ (container.querySelector('.room-start'));
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = signingIn ? 'Signing in…' : 'Starting…';
    let hostUid = '';
    try {
      if (needsAuth) {
        let user = await currentHost();
        if (!user) {
          if (!signingIn) {
            // First click: we now know a sign-in is needed. Ask for it plainly
            // and let the next click carry the gesture into the popup.
            renderStart(container, opts, onStarted, { stage: 'signin', note:
              'Starting a room needs a Google sign-in, so the class service stays limited to '
              + 'instructors. It happens once on this computer.' });
            return;
          }
          user = await signInHost();
        }
        if (!(await hostIsAllowed(user.uid))) {
          renderStart(container, opts, onStarted, { stage: 'idle', note:
            `<strong>This account can't open rooms yet.</strong> Signed in as `
            + `${escapeHtml(user.email || 'that account')}. Send this ID to whoever runs the `
            + `StatLens rooms project and they can add you: <code>${escapeHtml(user.uid)}</code>` });
          return;
        }
        hostUid = user.uid;
      }
      onStarted(await createRoom({
        transport: activeTransport, activity: opts.activity, label: opts.label, hostUid,
      }));
    } catch (err) {
      // A blocked popup, a cancelled sign-in, no network. Say which way to go
      // and leave the button usable — this is often mid-class.
      renderStart(container, opts, onStarted, { stage: 'signin', note:
        'That didn\'t complete — if a pop-up was blocked, allow pop-ups for this site and '
        + 'try again. The activity works without a room; you can collect answers by hand.' });
    }
  });
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
      <p class="room-problem" role="status"></p>
      <p class="room-count" aria-live="polite"><strong>0</strong> responses</p>
      <p class="hint room-expiry"></p>
      <div class="btn-row">
        <button type="button" class="btn-secondary room-clear">Clear</button>
        <button type="button" class="btn-secondary room-reveal">Reveal the truth</button>
        <button type="button" class="btn-secondary room-extend">+15 minutes</button>
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
  const expiryEl = /** @type {HTMLElement} */ (container.querySelector('.room-expiry'));
  room.subscribe((state) => {
    countEl.innerHTML = `<strong>${state.count}</strong> response${state.count === 1 ? '' : 's'}`;
    // Say when it ends, on screen, before it ends. An instructor who can see
    // the time can decide to extend; one who cannot finds out by the room
    // failing mid-question.
    if (state.over) {
      markOver(container, expiryEl);
    } else if (state.meta) {
      expiryEl.textContent = `Closes automatically at ${clockTime(state.meta.expires)}, `
        + 'or when you press Close room.';
    }
    opts.onUpdate?.(state);
  });

  // Every host control is a write the rules can refuse (expired room, signed
  // out, connection gone). Silence in front of a class is the worst outcome, so
  // a refusal says so rather than looking like a dead button.
  const problem = /** @type {HTMLElement} */ (container.querySelector('.room-problem'));
  const guard = async (/** @type {() => Promise<void>} */ fn, /** @type {string} */ what) => {
    try { problem.textContent = ''; await fn(); }
    catch { problem.textContent = `Couldn't ${what}. Check the connection and try again.`; }
  };

  container.querySelector('.room-clear')?.addEventListener('click',
    () => guard(() => room.clear(), 'clear the responses'));
  container.querySelector('.room-extend')?.addEventListener('click',
    () => guard(() => room.extend(), 'extend the room'));
  container.querySelector('.room-reveal')?.addEventListener('click',
    () => guard(() => room.reveal(), 'reveal the truth'));
  room.onPresence(({ asleep, stopped }) => {
    if (stopped) { problem.textContent = ''; markOver(container, expiryEl); return; }
    problem.textContent = asleep
      ? 'Paused while this tab was in the background — click anywhere to reconnect.'
      : '';
  });

  container.querySelector('.room-close')?.addEventListener('click', async () => {
    await guard(async () => {
      await room.close();
      const btn = /** @type {HTMLButtonElement} */ (container.querySelector('.room-close'));
      btn.disabled = true;
      btn.textContent = 'Room closed';
    }, 'close the room');
  });
}

/**
 * The room is finished. Disable the controls rather than leaving buttons that
 * write into a room the rules will refuse.
 * @param {HTMLElement} container
 * @param {HTMLElement} expiryEl
 */
function markOver(container, expiryEl) {
  expiryEl.textContent = 'This room has closed — students have been disconnected.';
  for (const b of container.querySelectorAll('.btn-row button')) {
    /** @type {HTMLButtonElement} */ (b).disabled = true;
  }
}

/** A wall-clock time an instructor can compare against the clock on the wall. */
function clockTime(/** @type {number} */ ms) {
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
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
