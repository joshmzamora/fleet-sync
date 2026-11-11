# FleetSync

FleetSync is an independent, browser-based class-project prototype for coordinating university fleet reporting, supervisor reviews, department accountability, maintenance follow-through, and quarterly reporting preparation. It also preserves the original UT Dallas campus map recreation as a separate page.

| Route | Application |
| --- | --- |
| **`/`** | **FleetSync Operations** — fleet dashboard and monthly reporting workflows |
| **`/campus-map`** | **UT Dallas Campus Map** — full interactive Leaflet campus-map class project |

## Run locally

Requires Node.js 20.19+ or 22.12+ and npm.

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
```

Build before either browser test. The browser scripts use headless Chrome; set `PLAYWRIGHT_CHANNEL=chromium` after installing Playwright's Chromium if Chrome is unavailable.

## FleetSync Operations

The application demonstrates a connected university workflow:

1. **Drivers** choose a unit and month, enter start/end odometer readings, fuel totals and vehicle condition. Chronological odometer overlaps are rejected and unusually high mileage requires explanation. Each submission enters the supervisor queue.
2. **Supervisors** approve or return reports with review notes. Every submission, correction and review appends a read-only-in-the-interface snapshot showing the original mileage, condition, review decision and actor. The current record advances while prior revisions remain available.
3. **Administrators** monitor overdue and missing monthly records by department, owner and due day. They can create **local follow-up tasks** with a responsible person, next-action date and note, reschedule them, or close them with an outcome. The task stays separate from the submission: logging or closing a follow-up cannot turn a missing report into an approved one. Approval closes related open tasks with a clearly recorded outcome. **The app never sends a notification, email or SMS.**
4. **Maintenance staff** receive linked issues when drivers report conditions requiring attention. Unsafe reports raise high-priority issues and put the vehicle on a service hold. Scheduling requires an assignee and date, resolution requires an assignee and repair note, and work-order changes append reviewable snapshots. Reopening a resolved issue requires a reason; reopening high-priority work reapplies the service hold. A fleet administrator must separately record the reason for returning a held vehicle to active service.
5. **Fleet administrators** inspect completion, exceptions, open follow-up tasks and supported month-to-month trends, edit unit and department information, and export two **review-only staging** worksheets. The monthly CSV includes approved licensed-vehicle records and data-quality flags. The quarterly reconciliation CSV displays the status of all three internal months, applicable reporting-month counts, recorded department attribution, approval gaps and data-quality findings, plus approved-only usage totals.

Every major mutation adds an activity-log entry in the browser. Report and maintenance transitions also append full record snapshots. The app migrates earlier browser-local sample records to the new history shape, labeling any unavailable historical vehicle attribution as **legacy inferred** rather than presenting it as verified. Current vehicle edits cannot silently rewrite the recorded unit, plate, licensing or department on newly submitted reports.

Reporting expectations are scoped to each vehicle's applicable months. A unit added today is not shown as missing for months before it entered the demo directory. Retired units retain their earlier reporting periods, and months outside their reporting window appear as **Not required** in quarterly review. Reactivating a retired unit is deliberately outside this local prototype.

Users can filter and search the work tables, navigate to a specific record from an exception, inspect its history, and reset fictional sample data after confirmation. Workspace view preferences are stored locally separately from fleet records.

The demo includes **fictional prior-month records** so quarter reconciliation, late reports and trends can be presented without connecting to an actual campus system. See [the guided demo](docs/DEMO_GUIDE.md) for an end-to-end walkthrough and [product decisions](docs/PRODUCT_DECISIONS.md) for workflow priorities and the interface benchmark.

### Reporting calendar

- Internal collection is **monthly**, with a configurable day of the following month for each department. The demo starts at the **5th** as an illustrative university policy. Actual university deadlines may differ.
- Texas's [Office of Vehicle Fleet Management](https://comptroller.texas.gov/purchasing/programs/ovfm/) requires **quarterly** fleet reporting in the Texas Fleet Management System. Under [Texas Government Code §2171.101(a)](https://statutes.capitol.texas.gov/GetStatute.aspx?Code=GV&Value=2171.101), the submission window is **the 45th through 60th days after quarter end**, subject to the statute's exceptions. The [2025 State Vehicle Fleet Management Plan](https://comptroller.texas.gov/purchasing/docs/ovfm/state-fleet-plan-2025.pdf) describes the fiscal year as September 1 through August 31. Thus Q1 covers September–November, Q2 December–February, Q3 March–May, and Q4 June–August.
- The dashboard calculates fiscal-quarter coverage and displays a projected submission window for **review planning only**. Local monthly completion, quarterly data reconciliation and final external submission are separate stages.

**All vehicle IDs, people, plates, costs and sample reports are fictional.** Data persists in the current browser's `localStorage`, so this MVP is intentionally single-user and single-browser. The visible role selector demonstrates views but **is not authentication, authorization, or an audit-grade identity system**. Do not enter real driver, vehicle, or personal information.

**Neither CSV is a Comptroller-certified TxFS import file.** Nothing is transmitted to the Texas Fleet Management System. The staging layout has not been independently validated against the official [TxFS batching specifications and import procedures](https://comptroller.texas.gov/purchasing/programs/ovfm/publications.php). It is for local review and reconciliation only.

The prototype has no backend, real university integration, live telematics, official records, signed approvals, notification delivery, durable server audit log, or multiuser synchronization. Browser-local data can be altered or cleared by anyone with browser access. The in-app history is **append-only through normal user actions, not cryptographically immutable or tamper-proof**. Local browser storage can be modified, lost, or overwritten outside the app. Production readiness would require real authentication and authorization, secure transaction storage, role boundaries, campus policy validation, tenant segregation, departmental access rules, reliable notifications, system integrations, record retention, independent audit controls, and official state-report mapping.

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
- `src/CampusPage.tsx` — campus map entry point with isolated original styles
- `src/App.tsx` / `src/styles.css` / `src/data/campus.ts` — original campus map app and data, retained
- `src/main.tsx` — light route selector
- `tests/` — fleet-domain and map-data unit tests
- `scripts/` — desktop/mobile browser workflow smoke tests
