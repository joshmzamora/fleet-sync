# UT Dallas Campus Map

An independent, interactive recreation of the [UT Dallas campus map](https://map.utdallas.edu/) for a class project, built with React, TypeScript, Vite, Leaflet and open map data.

The original map's visual workflow inspired the interface. It is not an official UT Dallas product, affiliated with Concept3D, or a mirror of their proprietary tiles, map data or API.

## Run locally

Prerequisites: Node.js 20.19+ or 22.12+ and npm.

```bash
npm install
npm run dev
```

Open the local URL printed by Vite, normally `http://localhost:5173`.

```bash
npm run typecheck
npm run build
npm test
npm run preview
```

To run interactive browser smoke checks, first build the app, then use `npm run test:browser`. This launches a headless local Chrome browser (set `PLAYWRIGHT_CHANNEL=chromium` if you installed Chromium using Playwright).

## Features

- Responsive campus map with a satellite and standard street view
- Search by building, abbreviation, category and description
- Expandable location categories and independently selectable marker layers
- Optional building labels, location details and shareable map links
- Self-guided campus highlight and student-life tours
- Walking and driving wayfinding, route preview when the public routing service is available, and external navigation links
- Room locator that resolves a room's building (floor plans are out of scope)
- Map zoom, reset, geolocation, map style and legend controls

## Sources and limitations

**Location data:** `src/data/campus.ts` is a curated subset of campus points from OpenStreetMap features and their Mapcarta listings, cross-checked against the [UT Dallas campus map (2024)](https://bpb-us-e2.wpmucdn.com/sites.utdallas.edu/dist/c/1062/files/2024/05/campus-map-2024.pdf) and the [campus parking map](https://services.utdallas.edu/download/Parking_Map.pdf). Positions are building or area centers, not audited entrances. Locations, construction and roads may change.

**Map:** standard map tiles from CARTO (OpenStreetMap data) and optional Esri World Imagery, with on-map provider attribution. Dataset attribution: © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), distributed under the ODbL. Public route previews rely on external OpenStreetMap-related routing services and may be temporarily unavailable.

**Sidebar photograph:** [“UT Dallas main mall.JPG”](https://commons.wikimedia.org/wiki/File:UT_Dallas_main_mall.JPG) by Stan9999, dedicated to the public domain, hosted by Wikimedia Commons.

This project does not support indoor room-level navigation, live accessible routing, verified construction closures, live parking availability, or private location records. Always use the [official UT Dallas map](https://map.utdallas.edu/) for authoritative campus information and posted signs for on-site navigation.

## Project structure

- `src/App.tsx` – interaction, map, navigation and campus explorer
- `src/data/campus.ts` – curated map locations and category metadata
- `src/styles.css` – desktop and mobile presentation
- `src/main.tsx` – React entry point

## Class project extensions

Ideas for future coursework include a validated data ingestion process, accessible walking-network routing, custom vector campus footprints, live campus closures, location editor and automated map interaction tests.
