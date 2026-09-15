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
 *   - **The room code is the only key.** With the Realtime Database rules this
 *     prototype ships, anyone who knows a code can write to that room. Codes are
 *     ~24 million, short-lived, and hold discardable numbers, which is an
 *     acceptable trade for a class activity and would not be for anything real.
 *     `hostToken` is carried end to end so a later backend can enforce it
 *     properly; here it only gates the local UI.
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

/** Rooms expire; a class period plus slack. */
export const ROOM_TTL_MS = 6 * 60 * 60 * 1000;

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

// ── The room API everything above uses ───────────────────────────────────

/**
 * @typedef {object} Room
 * @property {string} code
 * @property {boolean} isHost
 * @property {Transport} transport
 * @property {(value: number) => Promise<void>} publish
 * @property {(cb: (s: {meta: RoomMeta|null, values: number[], count: number}) => void) => () => void} subscribe
 * @property {() => Promise<{meta: RoomMeta|null, values: number[], count: number}>} snapshot
 * @property {() => Promise<void>} clear
 * @property {() => Promise<void>} close
 * @property {() => Promise<void>} reveal
 * @property {string} joinUrl
 */

/**
 * @param {object} opts
 * @param {Transport} opts.transport
 * @param {string} opts.activity - the tool this room belongs to
 * @param {string} [opts.label] - what the published value means
 * @param {string} [opts.joinBase] - URL students land on; `?room=CODE` is appended
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
    label: opts.label,
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

  return {
    code,
    isHost,
    transport,
    joinUrl,
    async publish(value) {
      if (!Number.isFinite(value)) return;
      const meta = await transport.getMeta(code);
      if (!meta || meta.closed) return;
      if (meta.expires < Date.now()) return;
      await transport.put(code, clientId(), { v: value, t: Date.now() });
    },
    subscribe(cb) {
      return transport.subscribe(code, ({ meta, entries }) => {
        const list = Object.values(entries || {});
        cb({ meta, values: list.map(e => e.v), count: list.length });
      });
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
      if (isHost) await transport.patchMeta(code, { closed: true });
    },
    async reveal() {
      if (isHost) await transport.patchMeta(code, { revealed: true });
    },
  };
}
