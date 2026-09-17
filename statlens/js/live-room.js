// @ts-check
/**
 * Live Rooms — an ephemeral place for a class to pool values (REQ-067).
 *
 * One primitive, many activities: student devices **publish** a number, the
 * instructor's projected view **subscribes** to the live aggregate, and every
 * activity on top is that same pair with a different picture drawn over it.
 * Pilot is the Gettysburg by-eye lab, where thirty hand-picked sample means pile
 * up above the true mean and the gap *is* the lesson.
 *
 * ## Why the transport is pluggable
 *
 * StatLens is a static site: ES modules on GitHub Pages, no build step, no
 * server. This is the first feature that cannot be a file, so the networking is
 * kept behind a four-method interface and nothing above it knows which one is in
 * play. Two exist:
 *
 *   - `localTransport` — BroadcastChannel + localStorage. Same machine only, but
 *     genuinely multi-tab, so the whole feature is demonstrable and testable
 *     with no account, no bill and no network.
 *   - `firebaseTransport` — Realtime Database, for a real classroom. Activates
 *     only when `live-room-config.js` carries a real project; otherwise the
 *     local one is used and the host view says so rather than silently failing
 *     in front of a lecture hall.
 *
 * ## Prototype honesty
 *
 * Stage 1 only, per the request: anonymous, ephemeral, throwaway numbers. Two
 * limits are real and deliberate, and the host view states them:
 *
 *   - **Dedupe is soft.** A per-device id in localStorage means a resubmit
 *     *updates* a student's entry rather than stuffing the ballot — but a
 *     private tab or a shared iPad defeats it. "N responded" is a count of
 *     devices, not of people, and must never be read as attendance.
 *   - **The room code is the only key to an open room.** Creating one is gated —
 *     the rules require an allow-listed Google account, which is what keeps a
 *     public site from spending the project's quota — but inside a room, anyone
 *     holding the code can write. Codes are ~24 million, short-lived, and hold
 *     discardable numbers, which is an acceptable trade for a class activity and
 *     would not be for anything real. `hostToken` predates the sign-in and now
 *     only remembers *which tab is the host* across a reload; authority comes
 *     from `meta.host` matching the signed-in uid, server-side.
 *
 * `scope` and `lifecycle` are recorded on every room even though only
 * `room`/`ephemeral` is implemented, so stages 2–3 are a migration rather than a
 * redesign.
 */

/**
 * Crockford base32 minus `0` and `1` as well as `I`, `L`, `O`, `U`: the code
 * gets read off a projector at the back of a lecture hall and typed on a phone,
 * so every glyph pair that can be confused is simply absent. 30^5 ≈ 24 million.
 */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_LENGTH = 5;

/**
 * How long a room lives. A class is 55 minutes and a room has no reason to
 * outlast one: the next section needs the connections back, and a code still
 * live at dinner time is a code that can be typed into by someone who is not in
 * the class.
 */
export const ROOM_TTL_MS = 60 * 60 * 1000;

/** What the host's "+15 minutes" adds, for a lab that runs long. */
export const ROOM_EXTEND_MS = 15 * 60 * 1000;

/**
 * The furthest ahead an expiry can ever be set. The database rules enforce the
 * same ceiling, so a client that asks for a week is refused rather than trusted.
 */
export const ROOM_MAX_AHEAD_MS = 2 * 60 * 60 * 1000;

/**
 * How long a backgrounded page keeps its connection.
 *
 * This is the number that decides whether the next class can start. Firebase's
 * free tier allows 100 *simultaneous connections*, and a connection is held by
 * an open page, not by a page doing something — thirty students who pocket
 * their phones with the tab still open would otherwise hold thirty connections
 * until the battery died. A locked phone fires `visibilitychange` within
 * seconds, so honouring it is most of the fix.
 *
 * The host's page is longer: an instructor who switches to slides mid-activity
 * should come back to a live count, not a reconnect.
 */
const STUDENT_HIDDEN_MS = 30 * 1000;
const HOST_HIDDEN_MS = 2 * 60 * 1000;

/**
 * How long a *visible* student page keeps its connection with nobody touching
 * it. A laptop left open on a desk looks identical to an engaged student, so
 * this is the backstop for the case `visibilitychange` cannot see. The host has
 * no equivalent — its whole job is to sit untouched displaying a live count.
 */
const STUDENT_IDLE_MS = 10 * 60 * 1000;

/** @typedef {{ v: number, t: number }} Entry */
/** @typedef {Record<string, Entry>} Entries */

/**
 * @typedef {object} RoomMeta
 * @property {number} created
 * @property {number} expires
 * @property {boolean} closed
 * @property {boolean} revealed - host has shown the truth (predict → reveal)
 * @property {'room'|'section'|'uwl-course-pool'} scope - stage 1 is always 'room'
 * @property {'ephemeral'|'term'|'persistent'} lifecycle - stage 1 is 'ephemeral'
 * @property {string} activity - which tool the room belongs to
 * @property {string} [host] - uid of the instructor who opened it. The rules
 *   require this on create and then allow only that uid to change the room, so
 *   a later close/reveal/clear cannot come from anyone else.
 * @property {string} [label] - what the value means, for the host view
 */

/**
 * @typedef {object} Transport
 * @property {string} name
 * @property {boolean} shared - true when other devices can reach it
 * @property {(code: string, meta: RoomMeta) => Promise<void>} create
 * @property {(code: string) => Promise<RoomMeta|null>} getMeta
 * @property {(code: string) => Promise<{meta: RoomMeta|null, entries: Entries}>} read
 * @property {(code: string, patch: Partial<RoomMeta>) => Promise<void>} patchMeta
 * @property {(code: string, clientId: string, entry: Entry|null) => Promise<void>} put
 * @property {(code: string, cb: (s: {meta: RoomMeta|null, entries: Entries}) => void) => () => void} subscribe
 * @property {() => void} [release] - drop the connection (listeners stay armed)
 * @property {() => void} [resume] - reopen it
 */

/** @param {() => number} [rand] */
export function makeRoomCode(rand = Math.random) {
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += ALPHABET[Math.floor(rand() * ALPHABET.length)];
  }
  return out;
}

/**
 * Tidy what a student typed: upper-case it and drop spaces and punctuation.
 *
 * Deliberately does **not** try to repair confusable glyphs. Crockford's scheme
 * maps O→0 and I→1 because its alphabet contains 0 and 1; ours contains neither,
 * so a typed `O` cannot be resolved to anything — it means the code was misread,
 * and guessing would silently join the wrong room. `codeProblem` says so instead.
 */
export function normaliseCode(input) {
  return String(input).toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, CODE_LENGTH);
}

/**
 * Why a code cannot be right, in words a student can act on — or null if it is
 * well-formed. (Well-formed is not the same as existing.)
 * @param {string} code - already passed through `normaliseCode`
 */
export function codeProblem(code) {
  if (code.length < CODE_LENGTH) return `A room code is ${CODE_LENGTH} characters.`;
  const bad = [...code].filter(ch => !ALPHABET.includes(ch));
  if (bad.length) {
    return `Room codes never contain ${[...new Set(bad)].join(', ')} — `
      + 'check O against Q, I or L against J, 0 against Q, 1 against 7.';
  }
  return null;
}

/**
 * What a student is told before they publish, generated from the room's scope.
 *
 * The request is explicit that this is a **notice, not a gate**: the data is
 * anonymous and used for teaching rather than research, so the proportionate
 * thing is to say plainly what happens and let participation be the easy path.
 * A blocking modal would buy nothing and cost the activity — a sampling
 * distribution built from six of thirty students teaches nothing.
 *
 * Declining is simply not submitting, which is always available and never
 * mentioned as a button. "Just watch" exists so a student who opts out still
 * sees the class result and does not miss the lesson.
 *
 * @type {Record<'room'|'section'|'uwl-course-pool', string>}
 */
export const SCOPE_NOTICE = {
  'room': 'joins the class\u2019s live view for this activity. Nothing is kept after class.',
  'section': 'is saved as our class dataset for this term.',
  'uwl-course-pool': 'is pooled anonymously across UWL STAT 145 sections, for teaching.',
};

/** Longer text behind "what\u2019s this?" — still no legalese. */
export const SCOPE_DETAIL = {
  'room': 'Your answer is a number with no name attached. It appears in the class picture on the '
    + 'screen and disappears when the room closes. Nothing is stored against you, and choosing not '
    + 'to send anything has no effect on your grade.',
  'section': 'Your answer is a number with no name attached. It is kept as this class\u2019s dataset '
    + 'for the term so we can analyse our own data, and it is never published outside the class.',
  'uwl-course-pool': 'Your answer is a number with no name attached. It joins a pool shared between '
    + 'UWL STAT 145 sections and used only for teaching \u2014 never published, never research data '
    + 'without a separate approval.',
};

/** A stable-per-device id. Soft dedupe, never identity. */
export function clientId() {
  const KEY = 'statlens.liveRoom.clientId';
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = 'c' + Math.random().toString(36).slice(2, 10);
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    // Private browsing with storage blocked: a per-tab id still dedupes within
    // the session, which is the best available and no worse than nothing.
    return 'c' + Math.random().toString(36).slice(2, 10);
  }
}

/** A host token, held in localStorage and never shown on screen. */
function newHostToken() {
  return 'h' + Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 12);
}

const tokenKey = (/** @type {string} */ code) => `statlens.liveRoom.host.${code}`;

/** @param {string} code */
export function hostTokenFor(code) {
  try { return localStorage.getItem(tokenKey(code)); } catch { return null; }
}

// ── Local transport: BroadcastChannel + localStorage ─────────────────────
// Same machine, multiple tabs. Enough to build against, demo, and test.

const LOCAL_PREFIX = 'statlens.liveRoom.data.';

/** @type {Transport} */
export const localTransport = {
  name: 'local',
  shared: false,
  async create(code, meta) {
    writeLocal(code, { meta, entries: {} });
  },
  async getMeta(code) {
    return readLocal(code).meta;
  },
  async read(code) {
    return readLocal(code);
  },
  async patchMeta(code, patch) {
    const s = readLocal(code);
    if (!s.meta) return;
    writeLocal(code, { meta: { ...s.meta, ...patch }, entries: s.entries });
  },
  async put(code, id, entry) {
    const s = readLocal(code);
    const entries = { ...s.entries };
    if (entry === null) delete entries[id]; else entries[id] = entry;
    writeLocal(code, { meta: s.meta, entries });
  },
  subscribe(code, cb) {
    const emit = () => cb(readLocal(code));
    emit();
    if (!localListeners.has(code)) localListeners.set(code, new Set());
    localListeners.get(code)?.add(emit);
    /** @type {BroadcastChannel|null} */
    let ch = null;
    try {
      ch = new BroadcastChannel('statlens.liveRoom');
      ch.onmessage = (e) => { if (e.data === code) emit(); };
    } catch { /* no BroadcastChannel: the storage event below still fires */ }
    const onStorage = (/** @type {StorageEvent} */ e) => {
      if (e.key === LOCAL_PREFIX + code) emit();
    };
    window.addEventListener('storage', onStorage);
    return () => {
      localListeners.get(code)?.delete(emit);
      ch?.close();
      window.removeEventListener('storage', onStorage);
    };
  },
};

function readLocal(/** @type {string} */ code) {
  try {
    const raw = localStorage.getItem(LOCAL_PREFIX + code);
    if (!raw) return { meta: null, entries: {} };
    const parsed = JSON.parse(raw);
    return { meta: parsed.meta ?? null, entries: parsed.entries ?? {} };
  } catch {
    return { meta: null, entries: {} };
  }
}

/**
 * Subscribers in *this* context. Neither `BroadcastChannel` nor the `storage`
 * event notifies the page that did the writing — both exist to tell the *other*
 * tabs — so a host publishing into its own room would never see its own value
 * appear. These are called directly.
 * @type {Map<string, Set<() => void>>}
 */
const localListeners = new Map();

function writeLocal(/** @type {string} */ code, /** @type {any} */ state) {
  try {
    localStorage.setItem(LOCAL_PREFIX + code, JSON.stringify(state));
  } catch { /* storage unavailable — the room simply will not persist */ }
  for (const fn of localListeners.get(code) ?? []) fn();
  try {
    new BroadcastChannel('statlens.liveRoom').postMessage(code);
  } catch { /* no BroadcastChannel here; other tabs get the storage event */ }
}

// ── Presence: a connection that follows attention ────────────────────────

/**
 * Decides when a device should be holding a connection at all.
 *
 * Dropping a listener does **not** drop a Firebase connection — the socket is
 * per client and stays open until told otherwise — so this is the only thing
 * standing between "thirty students left the tab open" and a quota that is
 * still full when the next class walks in.
 *
 * Kept as a plain state machine with injected effects so the policy can be
 * tested with fake timers, rather than only in a browser with a real phone.
 *
 * @param {object} o
 * @param {() => void} [o.release] - called when the device should disconnect
 * @param {() => void} [o.resume] - called when it should reconnect
 * @param {(s: {asleep: boolean, stopped: boolean}) => void} [o.onChange]
 * @param {number} [o.hiddenMs] - grace period after the page is backgrounded
 * @param {number} [o.idleMs] - untouched-but-visible timeout; 0 disables it
 */
export function createPresence(o = {}) {
  const { release = () => {}, resume = () => {}, onChange = () => {} } = o;
  const hiddenMs = o.hiddenMs ?? STUDENT_HIDDEN_MS;
  const idleMs = o.idleMs ?? 0;

  let asleep = false;
  let stopped = false;
  /** @type {any} */
  let timer = null;

  const clear = () => { if (timer !== null) { clearTimeout(timer); timer = null; } };
  const arm = (/** @type {number} */ ms) => { clear(); if (ms > 0) timer = setTimeout(sleep, ms); };
  const announce = () => onChange({ asleep, stopped });

  function sleep() {
    clear();
    if (asleep || stopped) return;
    asleep = true;
    release();
    announce();
  }

  function wake() {
    if (stopped) return;
    clear();
    if (asleep) { asleep = false; resume(); announce(); }
    arm(idleMs);
  }

  return {
    get asleep() { return asleep; },
    get stopped() { return stopped; },
    /** The page was backgrounded — start the grace period, do not cut instantly. */
    hidden() { if (!stopped && !asleep) arm(hiddenMs); },
    visible() { wake(); },
    /**
     * A tap or a keypress. A hidden page receives neither, so this arriving at
     * all means someone is looking — push the idle deadline out, and reconnect
     * if we had already parked the connection. That second half is what makes
     * "click anywhere to reconnect" true rather than decorative.
     */
    activity() {
      if (stopped) return;
      if (asleep) wake(); else arm(idleMs);
    },
    wake,
    sleep,
    /** Begin counting. Called once a subscription actually exists. */
    start() { if (!stopped) arm(idleMs); },
    /** The room is over. Release for good; no timer will bring it back. */
    stop() {
      if (stopped) return;
      clear();
      stopped = true;
      if (!asleep) { asleep = true; release(); }
      announce();
    },
  };
}

/**
 * Wire a presence machine to the page. Separate from the machine itself so the
 * policy is testable without a DOM, and so a non-browser import is harmless.
 * @param {ReturnType<typeof createPresence>} presence
 */
function watchAttention(presence) {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    presence.start();
    return () => {};
  }
  const onVisibility = () => (document.hidden ? presence.hidden() : presence.visible());
  const onActivity = () => presence.activity();
  // `pagehide` rather than `unload`: a page frozen into the back/forward cache
  // is still a page holding a socket, and it fires for that too.
  const onPageHide = () => presence.sleep();

  document.addEventListener('visibilitychange', onVisibility);
  // Coming back from the back/forward cache: `visibilitychange` usually fires
  // too, but `pageshow` is the event that is actually guaranteed.
  window.addEventListener('pageshow', onVisibility);
  document.addEventListener('pointerdown', onActivity, { passive: true });
  document.addEventListener('keydown', onActivity);
  window.addEventListener('pagehide', onPageHide);
  presence.start();

  return () => {
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pageshow', onVisibility);
    document.removeEventListener('pointerdown', onActivity);
    document.removeEventListener('keydown', onActivity);
    window.removeEventListener('pagehide', onPageHide);
  };
}

// ── The room API everything above uses ───────────────────────────────────

/**
 * @typedef {object} Room
 * @property {string} code
 * @property {boolean} isHost
 * @property {Transport} transport
 * @property {(value: number) => Promise<void>} publish
 * @property {(cb: (s: {meta: RoomMeta|null, values: number[], count: number, over: boolean}) => void) => () => void} subscribe
 * @property {() => Promise<{meta: RoomMeta|null, values: number[], count: number}>} snapshot
 * @property {() => Promise<void>} clear
 * @property {() => Promise<void>} close
 * @property {() => Promise<void>} reveal
 * @property {(ms?: number) => Promise<void>} extend - host only; pushes the expiry out
 * @property {() => void} wake - reconnect a paused device (an explicit tap)
 * @property {() => void} leave - done with this room; release the connection now
 * @property {(cb: (s: {asleep: boolean, stopped: boolean}) => void) => () => void} onPresence
 * @property {string} joinUrl
 */

/**
 * @param {object} opts
 * @param {Transport} opts.transport
 * @param {string} opts.activity - the tool this room belongs to
 * @param {string} [opts.label] - what the published value means
 * @param {string} [opts.joinBase] - URL students land on; `?room=CODE` is appended
 * @param {string} [opts.hostUid] - signed-in instructor; required by the Firebase rules
 * @returns {Promise<Room>}
 */
export async function createRoom(opts) {
  const code = makeRoomCode();
  const now = Date.now();
  /** @type {RoomMeta} */
  const meta = {
    created: now,
    expires: now + ROOM_TTL_MS,
    closed: false,
    revealed: false,
    scope: 'room',
    lifecycle: 'ephemeral',
    activity: opts.activity,
    // Never undefined: Firebase rejects a payload containing one outright, and
    // a room failing to open in front of a class is not the place to find out.
    label: opts.label ?? '',
    host: opts.hostUid ?? '',
  };
  await opts.transport.create(code, meta);
  const token = newHostToken();
  try { localStorage.setItem(tokenKey(code), token); } catch { /* nothing to hold it */ }
  return makeRoom(code, true, opts);
}

/**
 * @param {string} code
 * @param {object} opts
 * @param {Transport} opts.transport
 * @param {string} opts.activity
 * @param {string} [opts.joinBase]
 * @returns {Promise<Room>}
 */
export async function joinRoom(code, opts) {
  return makeRoom(code, !!hostTokenFor(code), opts);
}

/**
 * @param {string} code
 * @param {boolean} isHost
 * @param {any} opts
 * @returns {Room}
 */
function makeRoom(code, isHost, opts) {
  const { transport } = opts;
  const base = opts.joinBase || location.href.split('?')[0];
  const joinUrl = `${base}?room=${code}`;

  /** @type {Set<(s: {asleep: boolean, stopped: boolean}) => void>} */
  const presenceWatchers = new Set();
  const presence = createPresence({
    release: () => transport.release?.(),
    resume: () => transport.resume?.(),
    hiddenMs: isHost ? HOST_HIDDEN_MS : STUDENT_HIDDEN_MS,
    // The host view is *displaying* the live count on a projector. It must not
    // time out because nobody touched the laptop for ten minutes; a phone lying
    // on a desk should.
    idleMs: isHost ? 0 : STUDENT_IDLE_MS,
    onChange: (s) => { for (const cb of presenceWatchers) cb(s); },
  });

  /** @type {(() => void)|null} */
  let unwatch = null;
  /** @type {any} */
  let expiryTimer = null;
  let expiryFor = 0;

  /**
   * The room is finished — closed by the host, or simply out of time. Release
   * the connection for good. Listeners are deliberately left attached: tearing
   * a subscription down from inside its own callback is how this module got a
   * temporal-dead-zone bug once already, and the socket is what costs anything.
   */
  const endOfLife = () => {
    if (expiryTimer !== null) { clearTimeout(expiryTimer); expiryTimer = null; }
    presence.stop();
    unwatch?.();
    unwatch = null;
  };

  /** Re-arm whenever the deadline moves — the host can push it out mid-class. */
  const scheduleExpiry = (/** @type {RoomMeta|null} */ meta) => {
    if (!meta || presence.stopped || meta.expires === expiryFor) return;
    if (expiryTimer !== null) clearTimeout(expiryTimer);
    expiryFor = meta.expires;
    expiryTimer = setTimeout(endOfLife, Math.max(0, meta.expires - Date.now()));
  };

  return {
    code,
    isHost,
    transport,
    joinUrl,
    async publish(value) {
      if (!Number.isFinite(value)) return;
      if (presence.stopped) return;
      // They tapped, so they are here — and the socket may be parked. Reconnect
      // before writing rather than queueing the answer into an offline cache.
      presence.wake();
      const meta = await transport.getMeta(code);
      if (!meta || meta.closed) return;
      if (meta.expires < Date.now()) return;
      await transport.put(code, clientId(), { v: value, t: Date.now() });
    },
    subscribe(cb) {
      if (!unwatch && !presence.stopped) unwatch = watchAttention(presence);
      return transport.subscribe(code, ({ meta, entries }) => {
        const list = Object.values(entries || {});
        const over = !!meta && (meta.closed === true || meta.expires <= Date.now());
        if (over) endOfLife(); else scheduleExpiry(meta);
        cb({ meta, values: list.map(e => e.v), count: list.length, over });
      });
    },
    wake() { presence.wake(); },
    /**
     * Nothing more to do here. Used when a page opens a room that has already
     * finished — reading its `meta` was enough to open a socket, and a stale QR
     * code scanned at lunchtime must not hold one.
     */
    leave() { endOfLife(); },
    onPresence(cb) {
      presenceWatchers.add(cb);
      cb({ asleep: presence.asleep, stopped: presence.stopped });
      return () => presenceWatchers.delete(cb);
    },
    async snapshot() {
      const { meta, entries } = await transport.read(code);
      const list = Object.values(entries || {});
      return { meta, values: list.map(e => e.v), count: list.length };
    },
    async clear() {
      if (!isHost) return;
      const { entries } = await transport.read(code);
      await Promise.all(Object.keys(entries || {}).map(id => transport.put(code, id, null)));
    },
    async close() {
      if (!isHost) return;
      await transport.patchMeta(code, { closed: true });
      // The point of closing is to hand the connections back before the next
      // class; the host's own is one of them.
      endOfLife();
    },
    /**
     * Push the expiry out — a lab that ran long, a discussion worth finishing.
     * Clamped to the same ceiling the database rules enforce, so the worst a
     * stuck finger can do is buy two hours.
     */
    async extend(ms = ROOM_EXTEND_MS) {
      if (!isHost) return;
      const meta = await transport.getMeta(code);
      const from = Math.max(Date.now(), meta?.expires ?? 0);
      await transport.patchMeta(code, {
        expires: Math.min(from + ms, Date.now() + ROOM_MAX_AHEAD_MS),
      });
    },
    async reveal() {
      if (isHost) await transport.patchMeta(code, { revealed: true });
    },
  };
}
