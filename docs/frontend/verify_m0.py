"""M0 fixture audit, not an application test suite. Requires PyYAML + jsonschema.

Run from any directory: python path/to/docs/frontend/verify_m0.py
Uses only local files; does not call Backend or install dependencies.
"""
from copy import deepcopy
from pathlib import Path
import json
import yaml
from jsonschema import Draft7Validator, FormatChecker

DOCS = Path(__file__).resolve().parents[1]
spec = yaml.safe_load((DOCS / 'api/openapi.yaml').read_text(encoding='utf-8'))


def normalize(value):
    """Convert the nullable subset used by this OpenAPI 3.0 file to JSON Schema."""
    if isinstance(value, list):
        return [normalize(item) for item in value]
    if not isinstance(value, dict):
        return value
    result = {k: normalize(v) for k, v in value.items() if k != 'nullable'}
    if value.get('nullable'):
        return {'anyOf': [result, {'type': 'null'}]}
    return result


def check(value, schema, label):
    root = deepcopy(normalize(schema))
    root['components'] = normalize(spec['components'])
    errors = sorted(Draft7Validator(root, format_checker=FormatChecker()).iter_errors(value),
                    key=lambda error: str(list(error.path)))
    if errors:
        raise AssertionError(label + ': ' + '; '.join(
            f'{list(error.path)} {error.message}' for error in errors))


def schema_ref(name):
    return {'$ref': f'#/components/schemas/{name}'}


fixture = json.loads((DOCS / 'fixtures/frontend-online-examples.json').read_text(encoding='utf-8'))
excluded = {'/api/v1/reading-aggregates', '/api/v1/reading-batches',
            '/api/v1/exports', '/api/v1/review-changes', '/api/v1/review-mutation-batches'}
expected = {(method, path) for path, methods in spec['paths'].items() if path not in excluded
            for method in methods if method in {'get', 'post', 'put', 'patch'}}
covered = set()
ids = set()
for case in fixture['cases']:
    assert case['id'] not in ids, f"Duplicate case {case['id']}"
    ids.add(case['id'])
    method, path = case['method'].lower(), case['path']
    assert (method, path) in expected, case['id']
    operation = spec['paths'][path][method]
    status = str(case['status'])
    response = operation['responses'][status]['content']['application/json']['schema']
    check(case['response'], response, case['id'] + ' response')
    if status.startswith('2'):
        covered.add((method, path))
    request = case.get('request', {})
    for location, key in [('path', 'pathParams'), ('query', 'query'), ('header', 'headers')]:
        fields = {p['name']: p for p in operation.get('parameters', []) if p['in'] == location}
        values = request.get(key, {})
        assert not (set(values) - set(fields)), f"Unknown parameters: {case['id']} {key}"
        for name, parameter in fields.items():
            assert not parameter.get('required') or name in values, f"Missing {name}: {case['id']}"
            if name in values:
                check(values[name], parameter['schema'], case['id'] + ' ' + name)
    body = operation.get('requestBody')
    if body:
        assert 'body' in request, f"Missing body: {case['id']}"
        content_type = request.get('contentType', 'application/json')
        check(request['body'], body['content'][content_type]['schema'], case['id'] + ' request')
    else:
        assert 'body' not in request, f"Unexpected body: {case['id']}"
assert covered == expected, f'Missing success fixtures: {expected - covered}'
assert len(expected) == 18, f'Contract changed: {len(expected)} online operations; review M0 matrix'

dto = json.loads((DOCS / 'fixtures/contract-example.json').read_text(encoding='utf-8'))
count = 0
for key, schema_name in [('user', 'UserPublic'), ('dataset', 'Dataset'), ('sensors', 'Sensor'),
                         ('readings', 'Reading'), ('analysisRun', 'AnalysisRun'), ('anomalies', 'Anomaly')]:
    values = dto[key] if isinstance(dto[key], list) else [dto[key]]
    for value in values:
        check(value, schema_ref(schema_name), 'DTO ' + key)
        count += 1
legacy = json.loads((DOCS / 'fixtures/http-contract-examples.json').read_text(encoding='utf-8'))
for key, request_schema, response_schema in [
    ('login', 'LoginRequest', 'LoginResponse'),
    ('patchAnomaly', 'ReviewPatchRequest', 'SingleAnomaly'),
]:
    check(legacy[key]['request'], schema_ref(request_schema), key + ' request')
    check(legacy[key]['response'], schema_ref(response_schema), key + ' response')
check(legacy['readingsList'], schema_ref('ReadingPage'), 'legacy readings')
check(legacy['conflict'], schema_ref('Error'), 'legacy conflict')
check(legacy['br08Report'], schema_ref('ImportSummary'), 'legacy import summary')

# Ensure the known partial-review regression is actually rejected by this validator.
partial = {'data': {k: legacy['patchAnomaly']['response']['data'][k]
                    for k in ['id', 'version', 'status', 'note']}}
try:
    check(partial, schema_ref('SingleAnomaly'), 'negative partial review')
except AssertionError:
    pass
else:
    raise AssertionError('Validator unexpectedly accepted incomplete Anomaly')

print(f"PASS: {len(fixture['cases'])} online fixture cases, {len(covered)} operations, "
      f'{count} core DTO objects, 7 legacy payloads; partial-review negative check rejected.')
print('Scope: HTTP shapes/formats only; no live Backend, Zod runtime, detector, auth or mutation semantics.')
