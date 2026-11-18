/** Explicit offline CLI. Feature formulas live exclusively in shared-core. */
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { parse } from 'csv-parse/sync';
import { buildPm25Features, PM25_V2_POLICY, explorationUtcTime, type FeaturePoint, type FeatureSensor } from '@pm25/shared-core';
import stations from '../ml/beijing-stations.json' with { type: 'json' };
import pinned from '../ml/pm25-v2-manifest.json' with { type: 'json' };

const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
async function main() {
  const [rawDir, archivePath, outDir, ...extra] = process.argv.slice(2);
  if (!rawDir || !archivePath || !outDir || extra.length) throw new Error('Usage: export-pm25-v2-features RAW_DIRECTORY SOURCE_ZIP OUTPUT_DIRECTORY');
  const archive = await readFile(archivePath);
  if (hash(archive) !== stations.archiveSha256) throw new Error('UCI501 archive hash mismatch');
  const datasetId = 'uci501-offline', sensors: FeatureSensor[] = stations.stations.map(s => ({ id: s.externalId, externalId: s.externalId, datasetId,
    location: { type: 'Point', coordinates: [s.longitude, s.latitude] } }));
  const train: FeaturePoint[] = [], holdout: FeaturePoint[] = [], files: Record<string, string> = {};
  let sourceRows = 0, missing = 0;
  for (const station of stations.stations) {
    const name = `PRSA_Data_${station.externalId}_20130301-20170228.csv`, bytes = await readFile(join(rawDir, name));
    files[name] = hash(bytes);
    if (files[name] !== (pinned.source.csvSha256 as Record<string, string>)[name]) throw new Error('Extracted source CSV does not match the verified UCI501 member');
    const rows = parse(bytes, { columns: true, bom: true, skip_empty_lines: true }) as Record<string, string>[];
    const seen = new Set<string>();
    for (const r of rows) {
      sourceRows++;
      if (r.station !== station.externalId) throw new Error('Station/file mismatch');
      const local = `${r.year}-${r.month!.padStart(2, '0')}-${r.day!.padStart(2, '0')}T${r.hour!.padStart(2, '0')}:00:00`;
      const ts = explorationUtcTime(local, '+08:00');
      if (seen.has(ts)) throw new Error('Duplicate source station/time'); seen.add(ts);
      if (r['PM2.5'] === 'NA') { missing++; continue; }
      if (r['PM2.5']?.trim() === '') throw new Error('Empty unclassified PM2.5');
      const value = Number(r['PM2.5']); if (!Number.isFinite(value) || value < 0) throw new Error('Invalid PM2.5');
      const p = { id: `${r.station}|${r.No}`, sensorId: r.station!, datasetId, ts, value };
      if (local < '2015-01-01T00:00:00') train.push(p);
      else if (local < '2015-03-01T00:00:00') holdout.push(p);
    }
  }
  const order = (a: FeaturePoint, b: FeaturePoint) => a.ts.localeCompare(b.ts) || a.sensorId.localeCompare(b.sensorId);
  train.sort(order); holdout.sort(order);
  const a = buildPm25Features(datasetId, train, [], sensors), b = buildPm25Features(datasetId, holdout, train, sensors);
  // Independent imported-month dataset: no February or other external context is smuggled into golden inference.
  const goldenBytes = await readFile(new URL('../tests/fixtures/beijing-12-stations-demo-2015-03.csv', import.meta.url));
  if (hash(goldenBytes) !== stations.goldenSha256) throw new Error('Golden bytes changed');
  const goldenRows = parse(goldenBytes, { columns: true }) as Record<string, string>[];
  const golden = goldenRows.map(r => ({ id: `${r.sensorId}|${r.sourceRowNo}`, datasetId, sensorId: r.sensorId!, ts: new Date(r.timestamp!).toISOString(), value: Number(r.value) }));
  const g = buildPm25Features(datasetId, golden, [], sensors);
  const directory = resolve(outDir); await mkdir(directory, { recursive: true });
  const csv = (rows: typeof a.rows) => 'readingId,value,temporal_delta,spatial_delta\n' + rows.map(r => `${r.readingId},${r.values.join(',')}`).join('\n') + '\n';
  const training = csv(a.rows), validation = csv(b.rows), goldenMatrix = csv(g.rows);
  const metadata = { source: { url: stations.sourceUrl, archiveSha256: hash(archive), csvSha256: files, sourceRows, missingRows: missing,
    coordinateProvenance: stations.provenance, stationManifestSha256: hash(await readFile(new URL('../ml/beijing-stations.json', import.meta.url))), timeZone: '+08:00', license: 'CC BY 4.0' },
    featurePolicy: PM25_V2_POLICY, featurePolicySha256: hash(JSON.stringify(PM25_V2_POLICY)),
    featureBuilderSha256: hash(await readFile(new URL('../../shared-core/src/features/pm25-v2.ts', import.meta.url))),
    train: { reference: '2013-03-01 through 2014-12-31 local +08; eligible rows only', summary: a.summary, sha256: hash(training) },
    holdout: { reference: '2015-01-01 through 2015-02-28 local +08; not fitted; historical context allowed', summary: b.summary, sha256: hash(validation) },
    golden: { reference: 'March 2015 isolated golden dataset; never fitted or tuned', summary: g.summary, sha256: hash(goldenMatrix) } };
  await writeFile(join(directory, 'train.csv'), training, { flag: 'wx' });
  await writeFile(join(directory, 'holdout.csv'), validation, { flag: 'wx' });
  await writeFile(join(directory, 'golden.csv'), goldenMatrix, { flag: 'wx' });
  await writeFile(join(directory, 'features.json'), JSON.stringify(metadata, null, 2) + '\n', { flag: 'wx' });
  process.stdout.write(JSON.stringify({ train: a.summary, holdout: b.summary, golden: g.summary }) + '\n');
}
main().catch((error: unknown) => { process.stderr.write(String(error) + '\n'); process.exitCode = 1; });
