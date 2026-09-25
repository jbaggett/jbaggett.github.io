// @ts-check
/**
 * Extra Datasets — the contributed datasets in this folder, with a link into
 * every tool each one fits.
 *
 * The point of the page is friction: an instructor should be able to send a
 * spreadsheet and get back a link, without an account, a file host, or a URL to
 * assemble by hand. Contributed datasets deliberately stay out of the tools'
 * dataset menus (already 11-36 options deep, and curated for the course), so
 * this page is how they are found.
 */

import { announce, initHelp, contributedIndex, storePath } from '../../js/page-utils.js';
import { ensureQrLib, plainQrSvg } from '../../js/qr.js';

initHelp();

const list = /** @type {HTMLElement} */ (document.getElementById('ds-list'));
const filters = document.getElementById('ds-filters');
const searchBox = /** @type {HTMLInputElement|null} */ (document.getElementById('ds-search'));
const kindSelect = /** @type {HTMLSelectElement|null} */ (document.getElementById('ds-kind'));
const countLine = document.getElementById('ds-count');

/**
 * Tools a dataset can open in, decided from the index entry's shape. Order is
 * pedagogical: explore first, then simulate, then the parametric tests.
 * @param {any} d
 * @returns {Array<{label: string, path: string}>}
 */
function toolsFor(d) {
  /** @type {Array<{label: string, path: string}>} */
  const out = [];
  const numeric = d.hasNumeric;
  const categorical = d.hasCategorical;
  // build-extra.js records these; the fallback is for an entry indexed before
  // it did, and is deliberately conservative rather than clever.
  const numericCount = d.numericCount ?? (numeric ? 1 : 0);
  const catCount = d.catCount ?? (categorical ? 1 : 0);
  const twoGroups = categorical && d.groupLevels === 2 && (d.minGroupN ?? 0) >= 3;
  const manyGroups = categorical && (d.groupLevels ?? 0) > 2;

  if (numeric && !categorical) {
    out.push({ label: 'Describe one variable', path: 'explore/descriptive/' });
    out.push({ label: 'Bootstrap CI for a mean', path: 'simulate/bootstrap-mean/' });
    out.push({ label: 't-test / CI for a mean', path: 'inference/one-mean/' });
  }
  if (numeric && categorical) {
    out.push({ label: 'Compare groups', path: 'explore/grouped/' });
    if (twoGroups) {
      out.push({ label: 'Randomization test', path: 'simulate/randomization-diff-means/' });
      out.push({ label: 'Two-sample t-test', path: 'inference/two-means/' });
    }
    if (manyGroups) out.push({ label: 'ANOVA', path: 'inference/anova/' });
  }
  if (categorical) {
    out.push({ label: 'One categorical variable', path: 'explore/one-cat/' });
    if (catCount >= 2) {
      out.push({ label: 'Two categorical variables', path: 'explore/categorical/' });
      out.push({ label: 'Chi-square test', path: 'inference/chisq/' });
    }
  }
  if (numeric && numericCount >= 2) {
    out.push({ label: 'Scatterplot + regression', path: 'explore/regression/' });
  }
  out.push({ label: 'Explore several variables', path: 'explore/multi/' });
  return out;
}

/**
 * Everything a search should look through: an instructor hunting for "reaction
 * time" should find it whether that phrase is in the title, the description, a
 * column name, or the name of whoever sent it in.
 * @param {any} d
 */
function haystack(d) {
  return [d.name, d.description, d.id, d.contributor, ...(d.variables || [])]
    .filter(Boolean).join(' ').toLowerCase();
}

/**
 * Does this dataset support the kind of question the filter names? Phrased as
 * questions an instructor asks ("two groups to compare"), not as data types.
 * @param {any} d @param {string} kind
 */
function matchesKind(d, kind) {
  if (!kind) return true;
  const levels = d.groupLevels ?? 0;
  if (kind === 'numeric') return !!d.hasNumeric;
  if (kind === 'categorical') return !!d.hasCategorical;
  if (kind === 'two') return !!d.hasCategorical && levels === 2;
  if (kind === 'many') return !!d.hasCategorical && levels > 2;
  if (kind === 'pairs') return (d.numericCount ?? 0) >= 2;
  return true;
}

/** @param {string} s */
const esc = (s) => String(s).replace(/[<>&"]/g, c =>
  ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c] ?? c);

/** @param {any} d */
function card(d) {
  const tools = toolsFor(d);
  const vars = (d.variables || []).map(esc).join(', ');
  const who = d.contributor ? `Contributed by ${esc(d.contributor)}` : 'Contributed';
  const links = tools.map(t =>
    `<a href="../../${t.path}?dataset=${encodeURIComponent(d.id)}">${esc(t.label)}</a>`).join('');

  return `<article class="ds-card">
    <h2>${esc(d.name)}</h2>
    <p class="ds-meta">${who} &middot; n = ${d.n} &middot; <span class="ds-vars">${vars}</span></p>
    <p>${esc(d.description || '')}</p>
    <div class="ds-open">${links}
      <button type="button" class="btn-secondary ds-copy" data-id="${esc(d.id)}">Copy link</button>
      <button type="button" class="btn-secondary ds-qr-btn" data-id="${esc(d.id)}"
              aria-expanded="false">QR code</button>
    </div>
    <p class="copy-note" data-note="${esc(d.id)}" hidden></p>
    <div class="ds-qr" data-qr="${esc(d.id)}" hidden>
      <div class="ds-qr-img"></div>
      <div class="ds-qr-side">
        <p class="hint">Scannable from the back of a room. The link it carries is the first tool
           above &mdash; open that tool, set it up how you want it, then use <strong>Share</strong>
           for a code that matches what is on your screen.</p>
        <p class="hint ds-raw">Data file (for <code>?json=</code> elsewhere):
          <br><code class="ds-raw-url">${esc(new URL(storePath(`${d.id}.json`), location.href).href)}</code></p>
      </div>
    </div>
  </article>`;
}

// The store's own index, not this site's datasets.json — contributed datasets
// are not in the StatLens repo at all (see `storePath`).
contributedIndex()
  .then(index => {
    const contributed = index.filter(/** @param {any} d */ d => d.contributed !== false);
    if (contributed.length === 0) {
      list.innerHTML = '<p class="empty">No contributed datasets yet. '
        + '<a href="../../instructors/#submit">Send the first one</a> &mdash; a spreadsheet by email '
        + 'is enough.</p>';
      return;
    }
    // The filter bar is markup the page ships with but only earns its place once
    // there is enough here to sift: with two datasets on screen, a search box is
    // just another thing to read past.
    if (filters && contributed.length >= 4) filters.hidden = false;

    const render = () => {
      const q = (searchBox?.value ?? '').trim().toLowerCase();
      const kind = kindSelect?.value ?? '';
      const shown = contributed.filter(d =>
        matchesKind(d, kind) && (!q || haystack(d).includes(q)));

      if (shown.length === 0) {
        list.innerHTML = '<p class="empty">Nothing matches that. '
          + '<button type="button" class="link-button ds-clear">Clear the filters</button> '
          + 'to see all ' + contributed.length + '.</p>';
        list.querySelector('.ds-clear')?.addEventListener('click', () => {
          if (searchBox) searchBox.value = '';
          if (kindSelect) kindSelect.value = '';
          render();
          searchBox?.focus();
        });
      } else {
        list.innerHTML = shown.map(card).join('');
        wireCopyButtons();
      }

      if (countLine) {
        countLine.textContent = shown.length === contributed.length
          ? `${contributed.length} dataset${contributed.length === 1 ? '' : 's'}`
          : `${shown.length} of ${contributed.length} shown`;
      }
      announce(`${shown.length} dataset${shown.length === 1 ? '' : 's'} shown.`);
    };

    searchBox?.addEventListener('input', render);
    kindSelect?.addEventListener('change', render);
    render();
  })
  .catch(() => {
    list.innerHTML = '<p class="empty">Could not load the dataset index.</p>';
  });

/**
 * (Re)attach the per-card buttons after a render.
 *
 * The QR is drawn on demand rather than for every card up front: the library
 * is a CDN fetch, and a page of twenty datasets should not pull it down to
 * render twenty codes nobody asked for.
 */
function wireCopyButtons() {
    for (const btn of list.querySelectorAll('.ds-qr-btn')) {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id') ?? '';
        const box = /** @type {HTMLElement|null} */ (
          list.querySelector(`[data-qr="${CSS.escape(id)}"]`));
        if (!box) return;
        const showing = !box.hidden;
        box.hidden = showing;
        btn.setAttribute('aria-expanded', String(!showing));
        if (showing) return;

        const img = /** @type {HTMLElement} */ (box.querySelector('.ds-qr-img'));
        if (img.childElementCount === 0) {
          const first = /** @type {HTMLAnchorElement|null} */ (
            btn.parentElement?.querySelector('a'));
          const url = first ? new URL(first.getAttribute('href') ?? '', location.href).href : '';
          try {
            await ensureQrLib();
            img.innerHTML = plainQrSvg(url, { cellSize: 6 });
          } catch {
            img.innerHTML = '<p class="hint">QR unavailable — copy the link instead.</p>';
          }
        }
        announce(showing ? 'QR code hidden.' : 'QR code shown.');
      });
    }

    for (const btn of list.querySelectorAll('.ds-copy')) {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id') ?? '';
        // The first tool listed is the one this dataset is most naturally
        // opened in, so that's the link worth handing out.
        const first = /** @type {HTMLAnchorElement|null} */ (
          btn.parentElement?.querySelector('a'));
        const url = first ? new URL(first.getAttribute('href') ?? '', location.href).href : '';
        const note = list.querySelector(`[data-note="${CSS.escape(id)}"]`);
        try {
          await navigator.clipboard.writeText(url);
          if (note instanceof HTMLElement) {
            note.textContent = `Copied: ${url}`;
            note.hidden = false;
          }
          announce('Link copied.');
        } catch {
          if (note instanceof HTMLElement) {
            note.textContent = url;
            note.hidden = false;
          }
          announce('Copy failed — the link is shown so you can copy it manually.');
        }
      });
    }
}
