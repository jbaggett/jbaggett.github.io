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

import { announce, initHelp } from '../../js/page-utils.js';

initHelp();

const list = /** @type {HTMLElement} */ (document.getElementById('ds-list'));

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
    </div>
    <p class="copy-note" data-note="${esc(d.id)}" hidden></p>
  </article>`;
}

fetch('../datasets.json')
  .then(r => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  })
  .then(index => {
    const contributed = index.filter(/** @param {any} d */ d => d.contributed);
    if (contributed.length === 0) {
      list.innerHTML = '<p class="empty">No contributed datasets yet. '
        + '<a href="../../instructors/#submit">Send the first one</a> &mdash; a spreadsheet by email '
        + 'is enough.</p>';
      return;
    }
    list.innerHTML = contributed.map(card).join('');
    announce(`${contributed.length} contributed dataset${contributed.length === 1 ? '' : 's'}.`);

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
  })
  .catch(() => {
    list.innerHTML = '<p class="empty">Could not load the dataset index.</p>';
  });
