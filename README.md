# FleetSync

FleetSync is an independent class-project prototype for coordinating university fleet reporting, supervisor reviews, department accountability, maintenance follow-through, and quarterly reporting preparation. It offers a browser-local Demo workspace and an optional **local shared workspace** backed by SQLite and real account sessions. The original UT Dallas campus map recreation remains a separate page.

| Route | Application |
| --- | --- |
| **`/`** | **FleetSync Operations** — fleet dashboard and monthly reporting workflows |
| **`/campus-map`** | **UT Dallas Campus Map** — full interactive Leaflet campus-map class project |

## Run locally

The browser Demo uses Node.js 20.19+ or 22.12+ and npm. **Shared mode requires Node.js 22.23+** for the built-in experimental `node:sqlite` module and TypeScript stripping (the shared npm commands set the required flags).

```bash
npm install
npm run dev
```

Vite prints a local URL, normally http://localhost:5173/. Visit http://localhost:5173/campus-map for the original interactive map. Both applications are in one repository.

```bash
npm run typecheck
npm test
npm run build
npm run test:browser
npm run test:browser:fleet
npm run test:browser:built
```

Build before either browser test. The browser scripts use headless Chrome; set `PLAYWRIGHT_CHANNEL=chromium` after installing Playwright's Chromium if Chrome is unavailable.

### Start local shared records (optional)

For a single-server local shared deployment, build the production UI, create development users, and start the loopback server:

```bash
npm run build
npm run shared:init
npm run shared:serve
```

`shared:init` creates a local administrator, Facilities driver/supervisor, Housing supervisor and maintenance account. **Save the generated passwords** shown once in the terminal; they are not placed in the repository. Subsequent runs leave existing passwords unchanged. By default the SQLite database is `.local-data/fleetsync.sqlite`; set `FLEETSYNC_DB_PATH` before both commands to choose another local workspace. The server listens only on `127.0.0.1:4317` unless `FLEETSYNC_PORT` is set. Open **http://127.0.0.1:4317/**: this single server serves the built FleetSync application, `/campus-map`, and `/api` from the same origin.

For live frontend development only, run `npm run dev` in a separate terminal while the shared server is running. Vite then proxies `/api` to the local port 4317. In either setup, choose **Shared records** and sign in with a provisioned account. The authenticated server assigns each account its role and department; the Demo role selector never changes shared permissions. Shared workspace records initially start **empty**. A fleet administrator may preview and explicitly confirm a one-time import of their separate browser Demo records. Import is refused after the shared workspace contains fleet records, and no browser data is silently uploaded.

Use `npm run test:shared` for isolated HTTP integration tests. After `npm run build`, use `npm run test:browser:shared` for multiple independent signed-in browser contexts against a temporary SQLite server, and `npm run test:browser:built` to verify the actual built UI served directly by a single local FleetSync server. These tests provision their own users and do **not** alter the normal shared database.

## FleetSync Operations

The application demonstrates a connected university workflow:

1. **Drivers** see a compact, mobile-oriented reporting entry and their own reporting activity. They choose a unit and month, enter start/end odometer readings, fuel totals and vehicle condition. Chronological odometer overlaps are rejected and unusually high mileage requires explanation. Each submission enters the supervisor queue.
2. **Supervisors** see their department's review queue and approve or return reports with review notes. Every submission, correction and review appends a read-only-in-the-interface snapshot showing the original mileage, condition, review decision and actor. The current record advances while prior revisions remain available.
3. **Administrators** monitor overdue and missing monthly records by department, owner and due day. They can create **local follow-up tasks** with a responsible person, next-action date and note, reschedule them, or close them with an outcome. The task stays separate from the submission: logging or closing a follow-up cannot turn a missing report into an approved one. Approval closes related open tasks with a clearly recorded outcome. **The app never sends a notification, email or SMS.**
4. **Maintenance staff** work from a service queue with assignments, statuses and repair history. Unsafe reports raise high-priority issues and put the vehicle on a service hold. Scheduling requires an assignee and date, resolution requires an assignee and repair note, and work-order changes append reviewable snapshots. Reopening a resolved issue requires a reason; reopening high-priority work reapplies the service hold. A fleet administrator must separately record the reason for returning a held vehicle to active service.
5. **Fleet administrators** inspect completion, exceptions, open follow-up tasks and supported month-to-month trends, edit unit and department information, and export two **review-only staging** worksheets. The monthly CSV includes approved licensed-vehicle records and data-quality flags. The quarterly reconciliation CSV displays the status of all three internal months, applicable reporting-month counts, recorded department attribution, approval gaps and data-quality findings, plus approved-only usage totals.

Every major mutation adds an activity-log entry. In Demo, it is stored in the current browser. In Shared, validated role-specific commands are checked on the server and saved transactionally in SQLite with a workspace revision number. Concurrent writes using an old revision fail with HTTP **409** and must refresh before retrying. Report and maintenance transitions append full record snapshots. Historical attribution unavailable in older imported browser records is labeled **legacy inferred**, not verified. Current vehicle edits cannot silently rewrite recorded unit, plate, licensing or department on newly submitted reports.

Reporting expectations are scoped to each vehicle's applicable months. A unit added today is not shown as missing for months before it entered the demo directory. Retired units retain their earlier reporting periods, and months outside their reporting window appear as **Not required** in quarterly review. Reactivating a retired unit is deliberately outside this local prototype.

Users can filter and search the work tables, navigate to a specific record from an exception, inspect its history, and reset fictional sample data after confirmation. Workspace view preferences are stored locally separately from fleet records.

The demo includes **fictional prior-month records** so quarter reconciliation, late reports and trends can be presented without connecting to an actual campus system. See [the guided demo](docs/DEMO_GUIDE.md) for an end-to-end walkthrough and [product decisions](docs/PRODUCT_DECISIONS.md) for workflow priorities and the interface benchmark.

### Reporting calendar

- Internal collection is **monthly**, with a configurable day of the following month for each department. The demo starts at the **5th** as an illustrative university policy. Actual university deadlines may differ.
- Texas's [Office of Vehicle Fleet Management](https://comptroller.texas.gov/purchasing/programs/ovfm/) requires **quarterly** fleet reporting in the Texas Fleet Management System. Under [Texas Government Code §2171.101(a)](https://statutes.capitol.texas.gov/GetStatute.aspx?Code=GV&Value=2171.101), the submission window is **the 45th through 60th days after quarter end**, subject to the statute's exceptions. The [2025 State Vehicle Fleet Management Plan](https://comptroller.texas.gov/purchasing/docs/ovfm/state-fleet-plan-2025.pdf) describes the fiscal year as September 1 through August 31. Thus Q1 covers September–November, Q2 December–February, Q3 March–May, and Q4 June–August.
- The dashboard calculates fiscal-quarter coverage and displays a projected submission window for **review planning only**. Local monthly completion, quarterly data reconciliation and final external submission are separate stages.

**All bundled vehicle IDs, people, plates, costs and sample reports are fictional.** Browser Demo persists in `localStorage` and remains intentionally single-user. In Shared, local development users authenticate to a loopback-only HTTP server with HttpOnly cookies, server-enforced role/department permissions and SQLite persistence. A Driver can submit only for their assigned department, a Supervisor cannot review their own submissions or another department, Maintenance manages work orders, and Fleet Admin manages the overall fleet. These are local demonstration accounts, **not UT Dallas SSO or an approved production identity system**. Do not enter real driver, vehicle or personal information.

**Neither CSV is a Comptroller-certified TxFS import file.** Nothing is transmitted to the Texas Fleet Management System. The staging layout has not been independently validated against the official [TxFS batching specifications and import procedures](https://comptroller.texas.gov/purchasing/programs/ovfm/publications.php). It is for local review and reconciliation only.

The shared prototype now has a persistent single-machine SQLite API and multiple authorized sessions. It still has **no university integration, live telematics, official records, signed approvals, notification delivery, SSO, institutional provisioning, backup/recovery service, or certified TxFS mapping**. Shared data is only protected within the assumptions of a trusted local computer and single server process. Someone with filesystem access can alter or delete the SQLite database; snapshots and audit entries are **append-only through supported API transitions, not cryptographically tamper-proof**. Do not expose the shared API to the internet or use it as a production fleet system. A real deployment still requires institutional authentication, managed secrets, TLS, server hardening, backups, audit immutability and retention, organization-specific access policies, validated forms and maintenance/state integrations.

## Campus map (preserved)

`/campus-map` retains the original React, TypeScript, Vite and Leaflet recreation of [the UT Dallas interactive campus map](https://map.utdallas.edu/).

It includes:

- Interactive street and satellite views, zoom, locate, share and reset
- Location name/code search, nine location categories and independent marker layers
- Clickable building labels and location detail cards
- Room-code-to-building lookup, campus tours and walking/driving route previews
- Responsive phone sidebar and browser-based interaction tests

This map is an independent class project, **not an official UT Dallas product** or a mirror of proprietary Concept3D data and imagery. Coordinates are building/area centers rather than surveyed entrances. Building and parking information can become outdated.

**Map data:** © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright) (ODbL). The curated `src/data/campus.ts` directory draws on OpenStreetMap/Mapcarta feature points, checked against the [UT Dallas 2024 campus map](https://bpb-us-e2.wpmucdn.com/sites.utdallas.edu/dist/c/1062/files/2024/05/campus-map-2024.pdf) and the [campus parking map](https://services.utdallas.edu/download/Parking_Map.pdf). Tiles use CARTO and optional Esri World Imagery with on-map attribution; directions depend on public routing services. Sidebar photograph: [“UT Dallas main mall.JPG”](https://commons.wikimedia.org/wiki/File:UT_Dallas_main_mall.JPG) by Stan9999, public domain.

For official campus access information, routes and construction updates, use the [official UT Dallas map](https://map.utdallas.edu/).

## Project structure

- `src/fleet/domain.ts` — typed fleet records, reporting coverage windows, snapshot histories, department deadlines, internal follow-up tasks, validation and safety transitions, fiscal-quarter quality checks, audit events and review-only exports
- `src/fleet/App.tsx` / `src/fleet/styles.css` — FleetSync user interface
- `src/fleet/shared-client.ts` — browser's authenticated shared API client and versioned commands
- `server/app.mjs` / `server/operations.mjs` / `server/storage.mjs` / `server/schema.sql` — loopback HTTP API, role checks and SQLite transactions
- `server/init.mjs` / `server/run.mjs` — local development account initialization and API startup
- `src/CampusPage.tsx` — campus map entry point with isolated original styles
- `src/App.tsx` / `src/styles.css` / `src/data/campus.ts` — original campus map app and data, retained
- `src/main.tsx` — light route selector
- `tests/` — fleet-domain, map-data and isolated shared HTTP integration tests
- `scripts/` — desktop/mobile Demo and multi-session Shared browser workflow smoke tests
