/* global __ENV, open */
import http from 'k6/http';
import { sleep } from 'k6';
import { Counter, Trend, Rate } from 'k6/metrics';
import exec from 'k6/execution';

const fixture = JSON.parse(open(__ENV.PERF_FIXTURE));
const csv = open(__ENV.PERF_CSV, 'b');
const phase = __ENV.PERF_PHASE;
const duration = __ENV.PERF_DURATION;
const readNames = ['datasets', 'sensors', 'readings', 'deep_readings', 'anomalies', 'anomaly'];
const scenario = (executor, exec, fields) => ({ executor, exec, gracefulStop: '5s', ...fields });
export const options = {
  discardResponseBodies: true,
  summaryTrendStats: ['count', 'avg', 'med', 'p(95)', 'p(99)', 'max'],
  scenarios: phase === 'mixed' ? {
    reads: scenario('constant-arrival-rate', 'read', { rate: 240, timeUnit: '1s', preAllocatedVUs: 20, maxVUs: 40, duration }),
    review: scenario('per-vu-iterations', 'review', { vus: 16, iterations: 30, maxDuration: duration }),
    upload: scenario('per-vu-iterations', 'upload', { vus: 6, iterations: 1, maxDuration: duration }),
    imports: scenario('per-vu-iterations', 'importDataset', { vus: 6, iterations: 1, maxDuration: duration }),
    analysis: scenario('per-vu-iterations', 'analysis', { vus: 9, iterations: 1, maxDuration: duration }),
  } : phase === 'review' ? {
    review: scenario('per-vu-iterations', 'review', { vus: 32, iterations: 75, maxDuration: duration }),
  } : { reads: scenario('constant-vus', 'read', { vus: phase === 'srs' ? 100 : Number(phase), duration }) },
  thresholds: phase === 'srs' ? { read_failure: ['rate<0.01'],
    ...Object.fromEntries(readNames.map(name => [name + '_latency_ms', ['p(95)<500']])) } : {},
};

const names = [...readNames, 'review', 'upload', 'mapping', 'import', 'job_post', 'job_poll'];
const metrics = Object.fromEntries(names.map(name => [name, {
  completed: new Counter(name + '_completed'), latency: new Trend(name + '_latency_ms', true),
  rejected: new Counter(name + '_controlled'), errors: new Counter(name + '_system_errors'),
}]));
const readFailure = new Rate('read_failure');
const jobCompletion = new Trend('job_completion_ms', true);
const jobsFailed = new Counter('jobs_failed');
const paths = [
  ['readings', '/readings?datasetId=' + fixture.dataset + '&limit=100'],
  ['readings', '/readings?datasetId=' + fixture.dataset + '&limit=100'],
  ['deep_readings', '/readings?datasetId=' + fixture.dataset + '&limit=100&cursor=' + encodeURIComponent(fixture.cursor)],
  ['sensors', '/sensors?datasetId=' + fixture.dataset],
  ['datasets', '/datasets'],
  ['anomalies', '/anomalies?datasetId=' + fixture.dataset + '&analysisRunId=' + fixture.run + '&status=open'],
  ['anomaly', '/anomalies/' + fixture.detail],
];
function request(name, method, path, body, expected, key, response = false) {
  const headers = { Authorization: 'Bearer ' + fixture.token };
  if (typeof body === 'string') headers['Content-Type'] = 'application/json';
  if (key) headers['Idempotency-Key'] = key;
  const result = http.request(method, fixture.url + '/api/v1' + path, body, {
    headers, responseType: response ? 'text' : 'none', tags: { name }, timeout: '15s',
  });
  const metric = metrics[name];
  const valid = result.status === expected;
  if (valid) { metric.completed.add(1); metric.latency.add(result.timings.duration); }
  else {
    const controlled = (result.status === 503 && ['upload', 'import', 'job_post'].includes(name) &&
      ['UPLOAD_CAPACITY', 'IMPORT_CAPACITY', 'ANALYSIS_QUEUE_FULL'].includes(result.json('error.code'))) ||
      (result.status === 409 && name === 'review');
    if (controlled) metric.rejected.add(1);
    else metric.errors.add(1);
  }
  if (method === 'GET' && name !== 'job_poll') readFailure.add(!valid);
  return result;
}
export function read() {
  const [name, path] = paths[(exec.vu.idInTest + exec.scenario.iterationInTest) % paths.length];
  request(name, 'GET', path, null, 200);
}
export function review() {
  const index = exec.scenario.iterationInTest;
  request('review', 'PATCH', '/anomalies/' + fixture.reviews[index],
    JSON.stringify({ baseVersion: 1, changes: { note: 'k6 review' } }), 200, undefined, true);
}
export function upload() {
  const id = String(exec.scenario.iterationInTest).padStart(12, '0');
  const result = request('upload', 'POST', '/datasets', { file: http.file(csv, 'synthetic.csv', 'text/csv') },
    201, 'c0000000-0000-4000-8000-' + id, true);
  if (result.status === 201) request('mapping', 'PUT', '/datasets/' + result.json('data.id') + '/mapping',
    JSON.stringify(fixture.mapping), 200, undefined, true);
}
export function importDataset() {
  const index = exec.scenario.iterationInTest;
  request('import', 'POST', '/datasets/' + fixture.imports[index] + '/imports', null, 200,
    'd0000000-0000-4000-8000-' + String(index).padStart(12, '0'), true);
}
export function analysis() {
  const index = exec.scenario.iterationInTest;
  const [family, method, config] = [
    ['statistical', 'zscore', { threshold: 3 }],
    ['statistical', 'iqr', { multiplier: 1.5 }],
    ['ml', 'isolation_forest', {}],
  ][index % 3];
  const began = Date.now();
  const result = request('job_post', 'POST', '/analysis-runs', JSON.stringify({
    datasetId: fixture.dataset, family, method, config, scope: { to: fixture.scopeEnd },
  }), 202, 'e0000000-0000-4000-8000-' + String(index).padStart(12, '0'), true);
  if (result.status !== 202) return;
  while (Date.now() - began < 28000) {
    sleep(0.25);
    const status = request('job_poll', 'GET', '/analysis-runs/' + result.json('data.id'), null, 200, undefined, true);
    if (status.status !== 200) break;
    if (status.json('data.status') === 'completed') {
      jobCompletion.add(Date.now() - began);
      return;
    }
    if (status.json('data.status') === 'failed') break;
  }
  jobsFailed.add(1);
}

export function handleSummary(data) {
  return { [__ENV.PERF_SUMMARY]: JSON.stringify(data, null, 2) };
}
