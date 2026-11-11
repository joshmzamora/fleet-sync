# FleetSync Operations: End-to-end demonstration

This guide uses fictional records. FleetSync has two distinct workspaces: **browser Demo** (localStorage and simulated role switching) and **Shared records** (a local SQLite server, signed-in development users and server-enforced roles). Neither connects to UT Dallas, TxFS or a maintenance provider.

## Start the demo

1. Install dependencies with `npm install` and start Vite with `npm run dev` for the browser Demo.
2. Visit the local address shown by Vite (normally `http://localhost:5173/`).
3. Choose **Reset demo data** in the sidebar if you want a predictable starting workspace. This replaces changes already made in this browser and requires confirmation.
4. In Demo, select **Fleet Admin → Exceptions**. Review compact counts, report exception rows, the department scorecard and the work-order queue. Switch to a previous reporting month to see late or returned records. All sample people, units and costs are fictional.

## Set up real local shared sessions

This demonstration requires **Node.js 22.23+** for SQLite support. The simplest setup uses one local server for the built UI and API:

```bash
npm run build
npm run shared:init
npm run shared:serve
```

Save the one-time generated account passwords. `shared:init` does not reset existing users. Open **http://127.0.0.1:4317/** and choose **Shared records**. This opens a separate sign-in screen. For frontend development, you can alternatively run `npm run dev` in a second terminal to access the same API through Vite's local proxy. Accounts have fixed assigned roles and department scopes. A Driver cannot turn into a supervisor by changing a dropdown, and the sidebar reflects the authenticated role. These are **local test accounts**, not campus credentials.

The new shared database initially contains no vehicles. In the administrator session, open **Import browser Demo data**, inspect the server preview and confirm the explicit one-time import. It copies fictional Demo records into the previously empty shared workspace. A second import into a populated workspace is rejected. The Demo records remain independent; the shared server is not a live link to an individual user's browser storage.

### Open several independent sessions

Use separate browser profiles or isolated Playwright contexts, signing in as the corresponding generated account:

1. **Facilities driver:** start at the driver reporting screen, select **UTD-0220**, enter the current month, record a short trip and a clear unsafe condition note. Submit. The report is now Pending in the shared database and the unit is on a service hold. No other user's browser Demo data changes.
2. **Facilities supervisor:** open the department review queue, return the new report with a reason. The driver's screen can load the returned record and resubmit a corrected revision. Only the assigned department supervisor (or an authorized administrator) can review it. A person cannot review a submission they authored.
3. **Housing supervisor:** verify the Facilities report and vehicle are absent from that account's department-scoped state. Attempted cross-department API review is rejected with HTTP 403.
4. **Maintenance technician:** open the work-order queue and inspect the high-priority issue created from the unsafe report. Assign a technician and service date, save Scheduled, then document resolution. Work-order activity preserves the status changes. Finishing the repair **does not automatically release** the unit from its service hold.
5. **Fleet administrator:** inspect all departments, outstanding tasks and the review-only quarterly worksheet. After high-priority repair closure, document a separate administrative release. Export the CSV as an internal reconciliation aid only.

Open the same shared account in another browser context, then refresh after a change. The database keeps the mutation and audit record across browser sessions. A stale tab submitting a command with an older workspace revision receives a conflict and must refresh; it cannot overwrite the newer server state.

### Keep follow-ups and reporting separate

From an administrator or department supervisor account, find an overdue missing monthly report, create an internal follow-up with an owner and next check-in date, then close it with the outcome. Its status becomes Closed while the monthly report remains Missing until the driver submits and a supervisor approves it. **FleetSync does not email, text, push or schedule actual reminders.**

## Demonstrate accountability

1. In **Exceptions**, focus the **Facilities** row in the department scorecard. Use its **Edit** action to change the coordinator and internal due-day policy.
2. Choose a previous month (for example, two months ago). Open a missing or overdue unit's exception and choose **Create follow-up**.
3. Enter a responsible owner, a local next-action date and a note, then save. Inspect **Internal follow-up tasks**. The task is **Open**, with its own due date and outcome, and **does not send a message**.
4. Edit its next date or close it with a recorded outcome. Verify that the missing monthly report **still shows as missing**. Task completion and report approval are distinct.

## Demonstrate the complete driver → supervisor → maintenance path

1. In browser Demo, reset the data and switch the role selector to **Driver**. Role switching is a *Demo view control*, never authentication. To test identity controls, use separate Shared sessions above.
2. Select the current reporting month and unit **UTD-0220** (a fictional Facilities pickup). The sample starts with no current-month report for this unit.
3. Enter starting odometer **111900**, ending odometer **111915**, fuel purchased **4** gallons, fuel cost **15.50**, operator **Demo Driver**, and condition **Unsafe**. Add the note **“Brake warning illuminated on the return trip. Needs inspection.”** Submit.
4. Switch to **Supervisor → Monthly reports**. Find UTD-0220, enter a specific return reason and select **Return for correction**. Switch to Driver, correct the reading or note, and resubmit. Switch to Supervisor and approve.
5. Under **Monthly reports → All reports**, open the unit's **History**. The ledger contains the original submitted mileage, returned review, corrected submission and final approval. The earlier values remain available even after correction.
6. Switch to **Maintenance → Work orders**. Find the automatically created high-priority issue, assign a fictional technician and choose a date before scheduling. Resolve it with a meaningful repair note and optional actual cost. Expand **Activity** to inspect its saved service transitions.
7. Switch to **Fleet Admin → Vehicle directory**. Select UTD-0220. The service hold remains until a user records an explicit return-to-service reason after high-priority issues are resolved. Reopening high-priority work applies the hold again.
8. Open **Quarterly review** to inspect the audit log. It traces local submissions, reviews, task outcomes, maintenance changes, service releases and review-only CSV preparation.

## Demonstrate fiscal-quarter reporting preparation

1. In **Quarterly review**, select the fiscal year and quarter. The Texas fiscal year starts in September, so **FY2027 Q1 spans September–November 2026**. The interface shows an illustrative filing window (days 45–60 after quarter end) separately from the internal monthly due date.
2. Review all three monthly-status cells for each licensed unit. A pending, returned or missing report remains incomplete. Newly added or retired vehicles show **Not required** for months outside their reporting period.
3. Switch to the **Data checks** filter. The fictional sample includes a September approved record with missing reviewer evidence for **UTD-0477**. Expand the finding, inspect the approved record and its snapshot history, and use **Request correction** with a reason. This returns it to correction without overwriting its prior approval snapshot. Driver resubmission and a new supervisor approval restore readiness.
4. Export the **quarterly review CSV** to inspect every applicable monthly status, approved-only usage totals and data-quality findings. The **monthly review CSV** is a separate approved-record worksheet; both retain historical department and vehicle labels where known.
5. Point out the **review-only staging** notice. Neither export is a validated TxFS batching layout, and neither is transmitted to a government system.

## Demonstrate historical integrity

Add a new fictional vehicle from **Vehicle directory** and switch the month back. It is not counted as missing before the month it entered the demo fleet. Reassign an existing vehicle to another department and examine a previously approved monthly CSV: the original submitted department and plate remain in that historical record. Retiring a vehicle preserves earlier reporting expectations; retired assets cannot be reactivated using this prototype.

## Open the independent campus-map project

Choose **Campus map** in FleetSync navigation or open `/campus-map` directly. This is the unchanged UT Dallas campus map class project with searchable buildings, categories, layers, room lookup, tours and directions. Navigate between the two apps without changing the campus-map data.

## Verification

```bash
npm run typecheck
npm test
npm run build
npm run test:browser:fleet
npm run test:shared
npm run test:browser:shared
npm run test:browser:built
npm run test:browser
```

Build before the browser smoke tests. The Demo tests use a production Vite preview and isolated headless Chrome. The Shared HTTP and browser suites create **temporary SQLite databases** and provision disposable accounts. They check actual server roles, department read/write scope, identity-backed approvals, stale revision conflicts, import rejection, safe service holds, explicit follow-up outcomes and separate browser contexts. They do not access the normal `.local-data` fleet or any real fleet records. Headless Chrome is required for browser tests; set `PLAYWRIGHT_CHANNEL=chromium` if you have installed Playwright's Chromium instead.

These checks demonstrate concrete local behaviors, **not production authentication certification, security testing, regulatory compliance, or institutional system integration**.
