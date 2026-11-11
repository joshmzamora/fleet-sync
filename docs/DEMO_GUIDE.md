# FleetSync Operations: End-to-end demonstration

This guide uses fictional records. The app runs entirely in one browser. It does not connect to UT Dallas, TxFS or a maintenance provider.

## Start the demo

1. Install dependencies with `npm install` and start Vite with `npm run dev`.
2. Visit the local address shown by Vite (normally `http://localhost:5173/`).
3. Choose **Reset demo data** in the sidebar if you want a predictable starting workspace. This replaces changes already made in this browser and requires confirmation.
4. Open the **Fleet Admin** view. Observe current-month readiness, exception counts and department completion. Switch the month to the previous month to see overdue or returned sample records.

## Demonstrate accountability

1. Open the department scorecard on Overview. Focus **Facilities** to narrow the fleet.
2. Use its **Edit** action to record a fictional coordinator and change its monthly due-day policy. Note that the affected due date and overdue status are recomputed.
3. Open a missing or overdue vehicle's exception. Choose **Log follow-up**, enter an internal note and save. This creates an audit entry and follow-up timestamp; no email or SMS is sent.

## Demonstrate the complete driver → supervisor → maintenance path

1. Reset the demo and switch the role selector to **Driver**. Role switching is a *demo view control*, never authentication.
2. Select the current reporting month and unit **UTD-0220** (a fictional Facilities pickup). The sample starts with no current-month report for this unit.
3. Enter starting odometer **111900**, ending odometer **111915**, fuel purchased **4** gallons, fuel cost **15.50**, operator **Demo Driver**, and condition **Unsafe**. Add the note **“Brake warning illuminated on the return trip. Needs inspection.”** Submit.
4. Switch to **Supervisor**. Find UTD-0220, enter a return reason and choose **Return for correction**. Switch to Driver, correct the reading or note, and resubmit the returned record. Switch back to Supervisor and approve it.
5. Switch to **Maintenance**. Find the automatically created high-priority service issue. Assign a fictional team, choose a scheduled date, then resolve the issue with a meaningful repair note and optional final cost. A service hold remains until explicitly cleared.
6. Switch to **Fleet Admin → Vehicles**. Select UTD-0220, inspect its service status and use the return-to-service action with a recorded reason once all high-priority work is resolved.
7. View **Exports & audit**. The audit log traces the local submissions, reviews, service events, release and exports.

## Demonstrate fiscal-quarter reporting preparation

1. In Exports & audit, select the appropriate fiscal year and quarter. The Texas fiscal year starts in September, so **FY2027 Q1 spans September–November 2026**.
2. Review the three month-status cells per licensed unit. Missing, pending and returned reports are flagged as incomplete. Utility carts marked as unlicensed are excluded from the state-fleet reconciliation preview.
3. Export the **quarterly review CSV** to see gaps and approved-only usage totals. Also demonstrate the separate monthly approved-record CSV.
4. Point out the clear **review-only staging** notices. These exports have not been validated as official TxFS batching files and are not sent anywhere.

## Open the independent campus-map project

Choose **Campus map** in FleetSync navigation or open `/campus-map` directly. This is the unchanged UT Dallas campus map class project with searchable buildings, categories, layers, room lookup, tours and directions. Navigate between the two apps without changing the campus-map data.

## Verification

```bash
npm run typecheck
npm test
npm run build
npm run test:browser:fleet
npm run test:browser
```

Build before the browser smoke tests. These tests run on a local Vite production preview and use isolated headless Chrome sessions. They do not access real fleet records.
