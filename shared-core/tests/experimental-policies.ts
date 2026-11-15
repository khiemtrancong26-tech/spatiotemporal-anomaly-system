/** Integration fixtures ONLY. Not production defaults, not a severity policy. */
import type { StatisticalPolicy, Decision } from '../src/statistics/index.js';

export function experimentalPolicy(method: StatisticalPolicy['method']): StatisticalPolicy {
  return { id: `EXPERIMENT-ONLY/${method}/v1`, method, grouping: 'sensor',
    reference: method === 'moving_avg' ? 'preceding-count-window' : 'sensor-scope', order: 'ts-id',
    minSamplesPerSensor: method === 'iqr' ? 4 : 2, standardDeviation: 'population', onInsufficient: 'reject-scope', warmup: 'omit',
    validateConfig(config) {
      const allowed = method === 'iqr' ? ['multiplier'] : method === 'zscore' ? ['threshold'] : ['threshold', 'windowSize'];
      if (Object.keys(config).some(key => !allowed.includes(key))) return 'Experimental policy does not accept that config field.';
      if (method === 'iqr') return config.multiplier === 1.5 ? null : 'Explicit multiplier 1.5 is required by this experiment.';
      if (!(typeof config.threshold === 'number' && config.threshold > 0)) return 'An explicit positive threshold is required.';
      return null;
    },
    decide(facts, config): Decision {
      if (facts.method === 'iqr') {
        // Domain mapping of library quartiles to experimental fences, NOT a reimplementation of quantiles/IQR.
        const lower = facts.q1 - config.multiplier! * facts.iqr, upper = facts.q3 + config.multiplier! * facts.iqr;
        const distanceOutsideFence = Math.max(lower - facts.value, 0, facts.value - upper);
        return { score: distanceOutsideFence, flagged: distanceOutsideFence > 0, reason: 'EXPERIMENT-ONLY: distance outside 1.5 IQR fences, in ug/m3.' };
      }
      if (facts.z === null) return facts.value === facts.mean
        ? { score: 0, flagged: false, reason: 'EXPERIMENT-ONLY: constant reference and equal value.' }
        : { insufficient: 'EXPERIMENT-ONLY: zero dispersion with a different value cannot yield a finite z-score.' };
      return { score: Math.abs(facts.z), flagged: Math.abs(facts.z) > config.threshold!, reason: 'EXPERIMENT-ONLY: absolute library z-score above threshold.' };
    },
  };
}
