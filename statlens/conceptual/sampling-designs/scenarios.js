// @ts-check
/**
 * The three settings this page samples from.
 *
 * They look different and they are all the same shape underneath: a population
 * laid out in a unit square whose measurement is graded along **one axis**,
 * three bands across that axis (the natural strata), and clusters that are
 * either a **strip** cutting across the gradient or a **patch** sitting inside
 * it. That is not a coincidence — it is the structure of the topic:
 *
 *   - A **stratum** is a group you know about in advance and want to control.
 *     Good ones are uniform inside and different from each other.
 *   - A **cluster** is a group that is cheap to collect *whole*. You do not
 *     choose its composition; you get whatever the world's convenient units
 *     happen to contain.
 *
 * The scenarios earn their keep by differing in which clusters are actually
 * convenient. A beach offers both a strip (a transect, walked from the water up)
 * and a patch (a quadrat, tossed on the cobbles) — and field ecologists use both,
 * which is why the contrast there is honest rather than contrived. An orchard
 * offers only the tree: a whole row spans the entire orchard, so you would pick
 * exactly one of them and the design would stop being a sample of clusters at
 * all. Buried rocks offer only a hole: a patch at depth would mean excavating
 * everything above it and discarding the spoil, the opposite of cheap.
 *
 * So the three settings cover the ground between them. The orchard is the common
 * case (cheap cluster, uniform inside, precision suffers), the buried rocks are
 * the lucky case (cheap cluster that happens to cut every stratum), and the beach
 * holds both at once and lets you switch.
 *
 * Two earlier attempts to manufacture a homogeneous cluster in the buried-rocks
 * scene were withdrawn for exactly that reason — horizontal layers are strata,
 * not clusters (Todd Will), and shallow pits are not convenient (Jeff Baggett).
 * The fix was not a better geometry but a setting where both shapes are real.
 */

import { createRng } from '../../js/prng.js';

/**
 * @typedef {object} Item
 * @property {number} x  - 0..1 across the scene
 * @property {number} y  - 0..1 down the scene
 * @property {number} v  - the measurement (weight, etc.)
 * @property {number} band - which of the three bands it falls in
 */

/**
 * @typedef {object} Scenario
 * @property {string} id
 * @property {string} name        - for the scenario picker
 * @property {string} blurb       - one sentence of setting, shown under the title
 * @property {string} item        - singular noun ('cobble')
 * @property {string} items       - plural ('cobbles')
 * @property {string} measure     - what is measured ('weight')
 * @property {string} unit        - display unit ('kg')
 * @property {'x'|'y'} gradient   - the axis the measurement is graded along
 * @property {{cols: number, rows: number}} [clumps] - lay items out around a grid of
 *   points (trees) rather than scattering them, so the patch cluster is a thing
 *   you can see. Must match the patch cluster's grid or the picture lies.
 * @property {'plan'|'section'} view - how the scene is drawn
 * @property {string} bandAxisLabel  - names the gradient for a reader
 * @property {Array<{name: string, label: string, count: number, mean: number, sd: number}>} bands
 * @property {Record<string, ClusterShape>} clusters - keyed, first is the default
 * @property {{label: string, note: string, anchor?: {x: number, y: number}, accessLabel?: string}} convenience
 *   `anchor` is where you park, arrive, or stand. With one, the convenience sample
 *   is simply the nearest items to that point — which comes out as a semicircle of
 *   whatever happens to be underfoot (Todd Will's suggestion, and better than a
 *   random draw from one band, because it is localised as well as biased).
 * @property {string} srsNote
 * @property {string} stratifiedNote
 */

/**
 * @typedef {object} ClusterShape
 * @property {string} label      - 'transect'
 * @property {string} labels     - 'transects'
 * @property {'strip'|'patch'} kind
 * @property {number} n          - strips: how many; patches: columns
 * @property {number} [rows]     - patches only
 * @property {string} note       - what it is, in the scenario's own terms
 * @property {string} verb       - 'walked', 'tossed', 'dug'
 */

/** @type {Scenario[]} */
export const SCENARIOS = [
  {
    id: 'beach',
    name: 'Cobble beach',
    blurb: 'A rocky Lake Superior beach, seen from above: the water runs along the top, and wave '
         + 'sorting grades the stones by size as you walk up the shore. You want their average weight.',
    item: 'cobble', items: 'cobbles', measure: 'weight', unit: 'kg',
    gradient: 'y', view: 'plan',
    bandAxisLabel: 'distance from the water',
    bands: [
      { name: 'Waterline', label: 'pea gravel', count: 320, mean: 0.4, sd: 0.12 },
      { name: 'Mid beach', label: 'cobbles', count: 240, mean: 1.8, sd: 0.5 },
      { name: 'Storm berm', label: 'boulders', count: 150, mean: 6.0, sd: 1.6 },
    ],
    clusters: {
      transect: {
        label: 'transect', labels: 'transects', kind: 'strip', n: 16, verb: 'walked',
        note: 'A line run from the water straight up the beach, collecting everything along it. It '
            + 'crosses every zone, so each transect is a small version of the whole beach — which is '
            + 'exactly why ecologists lay transects when a gradient runs across their site.',
      },
      quadrat: {
        label: 'quadrat', labels: 'quadrats', kind: 'patch', n: 8, rows: 4, verb: 'tossed',
        note: 'A one-metre frame dropped on the stones; you take everything inside it. Easy to do — '
            + 'but everything in the frame sits at one distance from the water, so it is all the '
            + 'same kind of stone.',
      },
    },
    convenience: {
      label: 'the stones by the car',
      anchor: { x: 0.14, y: 1 },
      accessLabel: 'you parked here',
      note: 'Fill a bucket from the shingle in arm’s reach of where you parked. No randomness at all '
          + '— and the back of the beach, where you can drive to, is exactly where the storm waves '
          + 'pile the big stones.',
    },
    srsNote: 'Every cobble on the beach is equally likely — which means walking the whole beach and '
           + 'bending down more or less everywhere.',
    stratifiedNote: 'Divide the beach into its three zones by distance from the water, then sample '
                  + 'each zone at random in proportion to its size. Every zone is represented, every time.',
  },

  {
    id: 'orchard',
    name: 'Apple orchard',
    blurb: 'An orchard planted in three variety blocks, seen from above. You want the average weight '
         + 'of this season’s apples, and you can only weigh the ones you pick.',
    item: 'apple', items: 'apples', measure: 'weight', unit: 'g',
    gradient: 'x', view: 'plan',
    clumps: { cols: 8, rows: 4 },
    bandAxisLabel: 'variety block',
    bands: [
      { name: 'Honeycrisp', label: 'large', count: 240, mean: 210, sd: 28 },
      { name: 'Gala', label: 'medium', count: 300, mean: 140, sd: 20 },
      { name: 'Crabapple', label: 'small', count: 240, mean: 45, sd: 9 },
    ],
    clusters: {
      tree: {
        label: 'tree', labels: 'trees', kind: 'patch', n: 8, rows: 4, verb: 'visited',
        note: 'Pick a few trees at random and take all the fruit from each — one ladder, one tree, '
            + 'done. That is as cheap as orchard sampling gets, and it is cluster sampling used where '
            + 'it works worst: the method wants clusters that are varied inside and alike from one to '
            + 'the next, and a tree is the reverse — one variety, all much of a muchness, while tree '
            + 'differs sharply from tree. Three trees tell you about three trees.',
      },
    },
    convenience: {
      label: 'the trees by the gate',
      anchor: { x: 1, y: 0.5 },
      accessLabel: 'the gate',
      note: 'Fill a crate from the trees just inside the gate, without walking the orchard. No '
          + 'randomness at all — and the block by the gate is the crabapples.',
    },
    srsNote: 'Every apple in the orchard is equally likely — which means a ladder, a different tree, '
           + 'and a walk across the orchard for practically every apple you weigh.',
    stratifiedNote: 'Split the orchard into its three variety blocks first, then sample each at '
                  + 'random in proportion to its size. All three varieties, every time.',
  },

  {
    id: 'buried',
    name: 'Buried rocks',
    blurb: 'A cross-section of the ground beneath a plot: rocks settle by size, pebbles near the '
         + 'surface and boulders at the bottom. You want their average weight.',
    item: 'rock', items: 'rocks', measure: 'weight', unit: 'kg',
    gradient: 'y', view: 'section',
    bandAxisLabel: 'depth',
    bands: [
      { name: 'Topsoil', label: 'pebbles', count: 320, mean: 0.6, sd: 0.18 },
      { name: 'Subsoil', label: 'cobbles', count: 240, mean: 2.4, sd: 0.6 },
      { name: 'Bedrock layer', label: 'boulders', count: 150, mean: 7.0, sd: 1.8 },
    ],
    clusters: {
      hole: {
        label: 'hole', labels: 'holes', kind: 'strip', n: 16, verb: 'dug',
        note: 'Sink a hole and weigh everything that comes up. It is the only unit here that is cheap '
            + 'to collect whole — and it runs top to bottom through all three layers, which makes it '
            + 'an unusually good cluster. A patch at depth is not an option: you would have to dig '
            + 'out everything above it and throw those rocks away.',
      },
    },
    convenience: {
      label: 'what is lying on the surface',
      note: 'Take what is lying on top. No digging and no randomness — and the topsoil is nothing but '
          + 'pebbles.',
    },
    srsNote: 'Every rock under the plot is equally likely — so the sample is scattered everywhere, and '
           + 'you end up digging across the whole plot.',
    stratifiedNote: 'Split the ground into its three depth layers first, then sample each at random in '
                  + 'proportion to its size. Every layer is represented, every time.',
  },
];

/** @param {string} id */
export const scenarioById = (id) => SCENARIOS.find(s => s.id === id) ?? SCENARIOS[0];

/**
 * Build a scenario's population from a fixed seed, so the truth is the same for
 * every reader and can be quoted in a chapter.
 * @param {Scenario} sc
 * @returns {Item[]}
 */
export function buildPopulation(sc) {
  const rng = createRng(`sampling-designs-${sc.id}`);
  /** @type {Item[]} */
  const pop = [];
  sc.bands.forEach((b, bi) => {
    for (let i = 0; i < b.count; i++) {
      let along = (bi + rng()) / 3;   // position on the gradient axis
      let free = rng();               // position on the other axis
      if (sc.clumps) {
        // Snap to the nearest grid point and scatter a little around it: apples
        // hang on trees, and a "tree" cluster should be visibly a tree.
        const { cols, rows } = sc.clumps;
        const cx = (Math.floor((sc.gradient === 'x' ? along : free) * cols) + 0.5) / cols;
        const cy = (Math.floor((sc.gradient === 'y' ? along : free) * rows) + 0.5) / rows;
        const spreadX = 0.34 / cols, spreadY = 0.34 / rows;
        const jx = cx + (rng() + rng() - 1) * spreadX;
        const jy = cy + (rng() + rng() - 1) * spreadY;
        along = sc.gradient === 'x' ? jx : jy;
        free = sc.gradient === 'x' ? jy : jx;
      }
      // Log-normal-ish: measurements are positive and right-skewed.
      const z = (rng() + rng() + rng() + rng() - 2) * 1.2;
      const v = Math.max(b.mean * 0.05, b.mean * Math.exp(z * (b.sd / b.mean)));
      pop.push({
        x: sc.gradient === 'x' ? along : free,
        y: sc.gradient === 'y' ? along : free,
        v, band: bi,
      });
    }
  });
  return pop;
}

/**
 * Group a population into clusters of the given shape.
 * A strip runs across the gradient; a patch is a cell of a grid.
 * @param {Item[]} pop
 * @param {Scenario} sc
 * @param {ClusterShape} shape
 * @returns {Item[][]}
 */
export function clusterGroups(pop, sc, shape) {
  // The axis a strip is constant along is the one the gradient is NOT on, so
  // that a strip always cuts across all three bands.
  const stripAxis = sc.gradient === 'y' ? 'x' : 'y';
  if (shape.kind === 'strip') {
    return Array.from({ length: shape.n }, (_, k) =>
      pop.filter(p => Math.min(shape.n - 1, Math.floor(p[stripAxis] * shape.n)) === k));
  }
  const cols = shape.n, rows = shape.rows ?? 4;
  return Array.from({ length: cols * rows }, (_, k) => {
    const c = k % cols, r = Math.floor(k / cols);
    return pop.filter(p =>
      Math.min(cols - 1, Math.floor(p.x * cols)) === c &&
      Math.min(rows - 1, Math.floor(p.y * rows)) === r);
  });
}
