// @ts-check
import { initDistCalculator } from '../../js/dist-app.js';
import { pdfNormal, normalCDF, normalInv, setJStat } from '../../js/distributions.js';

// In browser, jStat is loaded via importmap
import('jstat').then(jstat => {
  setJStat(jstat.default || jstat);

  initDistCalculator({
    name: 'Normal',
    type: 'normal',
    xSymbol: 'z',
    xSymbolFactory: (p) => (p.mu === 0 && p.sigma === 1) ? 'z' : 'x',
    params: [
      { id: 'param-mu', label: 'Mean (μ)', paramKey: 'mu', defaultValue: 0 },
      { id: 'param-sigma', label: 'SD (σ)', paramKey: 'sigma', defaultValue: 1, min: 0.001, step: 'any' },
    ],
    pdfFactory: (p) => (x) => pdfNormal(x, p.mu, p.sigma),
    cdfFactory: (p) => (x) => normalCDF(x, p.mu, p.sigma),
    invFactory: (p) => (prob) => normalInv(prob, p.mu, p.sigma),
    domainParams: (p) => ({ mu: p.mu, sigma: p.sigma }),
    // Changing μ or σ holds the probability and moves the bound(s) — Jeff's
    // call on REQ-074: "keep the probabilities static and change the X value(s)
    // when either mu or sigma is changed." Normal only for now; whether the
    // other calculators should do the same when df / n / p change is still open.
    holdProbabilityOnParamChange: true,
  });
});
