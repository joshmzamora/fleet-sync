# FleetSync

FleetSync is an independent, browser-based class-project prototype for coordinating university fleet reporting, supervisor approvals, maintenance follow-ups, and central administrative review. It also preserves the original UT Dallas campus map recreation as a separate page.

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

## FleetSync Operations prototype

The fleet-operations dashboard demonstrates one connected, testable workflow:

1. A driver selects a vehicle, period, odometer readings, fuel totals and condition. Submission creates a pending monthly report.
2. A supervisor approves or returns the record for correction. Returned records can be resubmitted, with revisions logged.
3. A condition report requiring attention creates a maintenance issue; unsafe resubmissions escalate an existing linked issue to high priority.
4. A fleet administrator reviews the exception queue for missing, returned, and pending monthly reports, safety warnings, and open service requests.
5. Administrators export **approved, licensed-vehicle records** to a **review-only CSV staging file**, then examine the audit trail.

Other interactions include adding a vehicle, manually creating and updating maintenance issues, filtering by department and reporting month, and resetting the fictional demo data.

**All vehicle IDs, people, plates, costs and sample reports are fictional.** Data persists in the current browser's `localStorage`, so this MVP is intentionally single-user and single-browser. The visible role selector demonstrates views but **is not authentication, authorization, or an audit-grade identity system**. Do not enter real driver, vehicle, or personal information.

**The CSV is not a Comptroller-certified TxFS import file.** It does not transmit anything to the Texas Fleet System. The export layout must be mapped and validated against the latest TxFS batching specification before any production use.

The prototype has no backend, university integration, live telematics, official records, signed approvals, durable server audit log, or multiuser syncing. Production readiness would require role-based authentication, a database, tenant segregation, department policies, external system integrations, reconciliation, access logging, and verified state-report mapping.

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

- `src/fleet/domain.ts` — typed fleet records, validations, transitions, exception rules, sample data and review CSV
- `src/fleet/App.tsx` / `src/fleet/styles.css` — FleetSync user interface
- `src/CampusPage.tsx` — campus map entry point with isolated original styles
- `src/App.tsx` / `src/styles.css` / `src/data/campus.ts` — original campus map app and data, retained
- `src/main.tsx` — light route selector
- `tests/` — fleet-domain and map-data unit tests
- `scripts/` — desktop/mobile browser workflow smoke tests
