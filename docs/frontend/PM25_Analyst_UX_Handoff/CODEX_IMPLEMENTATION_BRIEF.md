# Codex Brief — Implementation of Analyst UX v1

You are working on project `spatiotemporal-anomaly-system`, branch `khiem/backend-database`. Read this handoff **completely** before changing code: `PM25_Analyst_UX_Handoff.md`; inspect `mockups/` PNGs and `mockups/*.html` for layout/spec. Images are **static UX concepts**, not production data or proofs.

## Mission

Redesign **three** Workspace tabs for a real PM2.5 Data Analyst:
1. Data Exploration: scoped Profile, quality, interactive time aggregation chart, clear comparison selection and handoff to Analysis.
2. Analysis: 3-step scope/method/confirmation; queued/running/completed/failed results; readable run history; no raw JSON in main UI.
3. Anomalies: filters supported by B6; list + contextual inspector; investigate on the existing Cube/Mapbox; review `open/confirmed/false_positive` with safe CAS conflict resolution.

**Hard boundary:** Do not redesign Visualization, Mapbox scene, Space–Time Cube, renderer styles, PM2.5 palette, camera/timeline/heatmap. You may propose a minimal navigation/data-handoff entrypoint in workspace integration to resolve exact selected anomaly when the reading is outside loaded 2k points, but must keep Visualization appearance/behavior unchanged. Do not alter Backend/OpenAPI/shared DTO without a separate, explicit approval.

## Source-of-truth contracts (verify latest branch before implement)

- Exploration: `GET /datasets/:id/profile`, `GET /reading-aggregates` (hour/day; max20 series; 20k cells; count from backend; unknown coverage if metadata missing).
- B5: `POST /analysis-runs` 202 queued, GET detail/history; method/config fixed: zscore `{threshold:3}`, iqr `{multiplier:1.5}`, isolation_forest `{}`; max50k readings/run; scope sensorIds/from/to, **no bbox**; idempotency/polling preserved.
- B6: GET list/detail, PATCH review version CAS; anomaly DTO **no reading PM2.5 value**, **no total count**, list **no sensorId/bbox filter**. For selected anomaly, bounded GET `/readings` by `sensorId` and precise `ts`; verify matched `readingId` before showing value.
- Current visualization limit2k loaded readings, table paged100; full Analysis scope independent. No added endpoint or fabricated total.

## Implementation sequence

1. PR1 Exploration layout/semantics + tests; retain actual API adapter and workspace timezone.
2. PR2 Analysis UI + tests (state, idempotency, polling and history must remain exact).
3. PR3 Anomalies list/inspector/review + tests; no loss of dirty draft, 409 conflict manual.
4. PR4 investigation handoff via workspace integration + E2E: exact dataset/sensor/reading/ts and return to run; do not change render engine.


## Non-negotiable usability

- Main CTA from Exploration **navigates to Analysis configuration**, does **not** automatically create an Analysis Run. Compare-series station selection is **not** silently the same as Analysis Scope; show explicit choice.
- `scope={}` displays “Tất cả trạm · Toàn bộ thời gian” instead of raw JSON; display scoped count only when Profile confirms it.
- Completed + zero anomalies is different from network error or 409, and results from one run must not be mixed with current filters or other runs.
- `confirmed` is a human review outcome, **not** proof of a specific pollution cause, ML correctness, or an alert severity.
- Do not treat `severity:low` as an AQI/health category; PM2.5 and detector score need separate legends/labels.
- No generic “loading 75%” when the backend provides no progress metric; no model retraining on review.
