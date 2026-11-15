import type { StatisticalPolicy } from '@pm25/shared-core/statistics';

export const ANALYSIS_POLICY_ID = 'pm25-online-baseline-v1/severity-low';
/** B5 policy approved by the project owner; severity is provisionally low. */
export function onlineStatisticalPolicy(method: StatisticalPolicy['method']): StatisticalPolicy {
  return {
    id: ANALYSIS_POLICY_ID, method, grouping: 'sensor', order: 'ts-id',
    reference: method === 'moving_avg' ? 'preceding-count-window' : 'sensor-scope',
    minSamplesPerSensor: method === 'iqr' ? 4 : 2, standardDeviation: 'population',
    onInsufficient: 'reject-scope', warmup: 'omit',
    validateConfig(config) {
      const allowed = method === 'iqr' ? ['multiplier'] : method === 'moving_avg' ? ['threshold', 'windowSize'] : ['threshold'];
      if (Object.keys(config).some(key => !allowed.includes(key)) || Object.keys(config).length !== allowed.length) return 'Explicit approved config is required.';
      if (method === 'iqr') return config.multiplier === 1.5 ? null : 'multiplier must be 1.5.';
      if (config.threshold !== 3) return 'threshold must be 3.';
      if (method === 'moving_avg' && (!Number.isSafeInteger(config.windowSize) || config.windowSize! < 2)) return 'windowSize must be an integer >=2.';
      return null;
    },
    decide(facts, config) {
      if (facts.method === 'iqr') {
        const lower = facts.q1 - config.multiplier! * facts.iqr, upper = facts.q3 + config.multiplier! * facts.iqr;
        const score = Math.max(lower - facts.value, 0, facts.value - upper);
        return { score, flagged: score > 0 };
      }
      if (facts.z === null) return facts.value === facts.mean ? { score: 0, flagged: false } : { insufficient: 'A constant reference window cannot score a different value.' };
      const score = Math.abs(facts.z);
      return { score, flagged: score > config.threshold! };
    },
  };
}
