# Offline foundation (Duy)

## Implemented in this patch

- Dexie/IndexedDB stores datasets, sensors, readings, analysis runs, anomalies, cache coverage, review outbox, workspace snapshots and namespaced metadata.
- `createOfflineDataSource()` wraps the existing `OnlineDataSource`; successful list/detail reads are cached under the authenticated public user ID.
- On network errors and HTTP 502/503/504, list/detail reads fall back to matching rows already stored in IndexedDB. HTTP 401/403, validation errors and aborted requests are not hidden by cache fallback.
- Coverage is recorded for the exact dataset/resource/query scope. A cursor chain is complete only after every page from the first cursor through the terminal page was cached. A partial set is never labelled as a complete dataset.
- IndexedDB is opened during application bootstrap (without requiring network access), so DevTools can see the database before the first dataset request. A storage-open failure is logged and does not block the app shell.
- Connectivity probes `/api/v1/health` periodically and combines the result with browser online/offline events.
- PWA precaches the built app shell. API requests use `NetworkOnly` in Workbox; business data is owned by Dexie, not Cache Storage.
- Workspace dataset, filters, tab and selected reading are persisted by account/dataset.
- Offline review changes can be stored durably in Outbox when connectivity is not confirmed online. The UI says “saved on this device”, not “saved on Server”.

## Not implemented yet (blocked by current source/contracts)

- `GET /api/v1/exports`, `POST /api/v1/review-mutation-batches`, and `GET /api/v1/review-changes` have OpenAPI draft entries but no Backend handlers in the current develop source. Do not claim Push/Pull sync is working.
- Session restoration still calls `/auth/me`; if a full reload happens while offline, `AuthGate` may block Workspace. The current authentication design uses `sessionStorage` and server revalidation. Offline authentication needs an explicit security decision with Tài/Khiêm before changing it.
- Visualization mode, timeline timestamp/max-age, and Mapbox/Three.js camera are not wired into the workspace persistence contract yet. Tài must agree on a shared state shape before those are saved.
- `shared-core.evaluateStatistics()` requires a server policy argument, while that policy currently lives in `server/`. Do not duplicate the detector policy in the browser Worker. Khải/Khiêm must expose the same approved policy through `shared-core` before the Worker is completed.
- Optional Export/prefetch is not wired because the draft multi-collection cursor (NEW-03/NEW-04) is not locked and the Backend route is not implemented.

## Install and verify

From repository root, run `npm install` to add Dexie and `vite-plugin-pwa` and regenerate `package-lock.json`. The offline work was prepared without `node_modules`; package installation/build/test must be run in the team's environment.

```bash
npm run typecheck --workspace @pm25/client
npm test --workspace @pm25/client
npm run build --workspace @pm25/client
```

PWA/Service Worker is verified from a production build using `npm run preview --workspace @pm25/client`; Vite dev mode does not register the production worker.


## IndexedDB bootstrap check

`initializeOfflineDatabase()` opens the Dexie schema before React renders the route tree. This intentionally creates the local database even on the login screen and while the API is unavailable. If the browser blocks IndexedDB or storage is unavailable, bootstrap logs the failure and continues; it does not claim cached data is available.

Unit coverage: `database.test.ts` verifies concurrent initialization is single-flight and that storage failures do not reject application startup. The Playwright check `e2e/offline-storage.spec.ts` verifies the real Chromium database and object stores from a production preview.
