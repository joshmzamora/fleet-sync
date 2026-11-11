# FleetSync product decisions

## Target workflow

FleetSync is a **reporting and exception-resolution workbench for decentralized university fleets**. It supports a monthly internal collection and correction cycle that provides a reliable starting point for quarterly Texas fleet reporting preparation. It also passes vehicle-condition observations into maintenance follow-up.

The original Team 10 discovery materials identified three separate jobs:

| User | Work to complete | MVP experience |
| --- | --- | --- |
| Vehicle operator | Report a month's use and condition without repeatedly filling known fields or delivering paper | Mobile-friendly report, sensible prior-reading prefill, clear validation, submission confirmation |
| Department supervisor / fleet coordinator | Find missing or questionable submissions, correct them and keep handoffs moving | Assigned department, completion by month, explicit pending/returned/overdue states, local next-action tasks and retained review snapshots |
| Garage / fleet administrator | Act on condition concerns and reconcile approved records before external filing | Safety holds, work assignment and scheduled date, repair and reopening history, data-quality exceptions, quarterly reconciliation |

UT Dallas discovery materials discuss paper, manual record entry, departmental handoffs, AssetWorks/AiM, spreadsheets and TxFS. **Some interview-guide details are open questions rather than confirmed process facts.** In particular, actual signature requirements, TxFS bulk-import compatibility, internal due days, notification authority and maintenance-system integration must be validated before a real deployment.

## Interface benchmark

Public examples consulted:

- [Fleetio dashboard](https://help.fleetio.com/en_US/dashboard-overview): status/overdue metrics linked to actionable fleet work, including incomplete work orders and time to resolve.
- [Fleetio inspection workflows](https://help.fleetio.com/inspections/inspections-workflows): failed inspection items can create follow-up issues, without a separate operator handoff.
- [Fleetio work orders](https://help.fleetio.com/en_US/maintenance/work-order-overview): explicit ownership, status transitions and repair history instead of a simple open/closed flag.
- [AssetWorks planning and scheduling](https://www.goassetworks.com/planning-scheduling-work): maintenance work presented with status, assignment and schedule context for technicians and supervisors.

FleetSync uses **flat, neutral operational UI**: compact tables and filters, descriptive headings, readable status words, accessible forms, minimal decoration and warning colors only where risk warrants them. The desktop workflow remains table-first; mobile driver entry reduces chrome and preserves visible validation. The role selector remains a simulated view, never access control.

## Third-pass integrity decisions

- **Report revisions:** keep snapshots for submission, return, resubmission, approval and documented reopening of an approved record. An operator cannot overwrite an approved report simply by submitting again. A quality finding can trigger a reasoned amendment workflow; the earlier approval stays in history.
- **Internal follow-up tasks:** track an accountable owner, due date, status and outcome. Logging a task does not imply an email/SMS was delivered or a missing report was submitted. A completed task does not change report status; approval is a separate transition.
- **Vehicle history:** store unit, plate, licensing and department on each new report so a later directory transfer does not retroactively rewrite past exports. Legacy local records with missing historical attribution are explicitly marked inferred.
- **Service holds:** a driver-reported unsafe condition creates a high-priority work item and holds the vehicle. Scheduled work requires an assignee and date. Closure requires an assigned technician and repair explanation. Reopening completed high-priority work requires a reason and reapplies the hold. Returning a held vehicle to service remains an explicit separate action.
- **Month-scoped fleet:** a new unit starts being expected in its entry month. A retired unit preserves earlier periods, and the quarter worksheet can mark later or earlier non-applicable months as **Not required**. The demo does not implement full recommissioning workflows.
- **Quality versus completeness:** monthly and quarterly data review separates missing/pending/returned reporting from suspect *approved* data such as invalid meter chronology or absent reviewer evidence. A known fictional approval-evidence gap is seeded for the quarter-review demo. Quality flags block a row from being called ready without inventing an official TxFS validation result.
- **Audit boundary:** application mutations append snapshots and audit entries; this is durable only in the current browser's localStorage and cannot prevent external edits or deletion. There are no real electronic signatures or secure authorizations.

## Deliberately narrow scope

1. **First, now implemented as a fictional prototype:** capture month-end data, retain corrections, review submissions, surface exceptions, manage local follow-up tasks, track service holds/work-order transitions and prepare review-only quarterly reconciliations. The state's statutory reporting window is days 45–60 after quarter end, while internal collection happens monthly.
2. **Second, requiring field validation:** validate approval authority and form coverage with administrators, compare a real anonymized monthly packet with staging output, and establish where the existing maintenance system remains authoritative. Repair and owner histories now exist in the prototype but have not been tested against live garage processes.
3. **Later, only if validated:** official import format, approved supervisor-signoff mechanism, email notifications, AssetWorks sync, OBD telemetry, purchasing opportunities and vehicle-replacement analytics.

The MVP is **not** a Fleetio/AssetWorks replacement, live maintenance scheduler, TxFS integration, fleet GPS tracker, secure multiperson portal or regulatory-compliant record system.

## Field-validation questions before a real pilot

- Which current forms, signatures, codes and fields are truly required by the department and the Comptroller?
- Who owns missed reports and the final state submission, and what is the real deadline?
- What must be compared against vehicle master records, garage charges and external repairs?
- Can a validated sample of this staging CSV be mapped into the currently approved TxFS import specification?
- Does a timed mobile report reduce the same operator's actual paperwork burden without omitting required safety information?
- What repair decisions would become possible earlier when operators report defects, and how will the existing garage system remain the source of truth?

These questions are pilot criteria. Avoid promising specific efficiency or repair-cost savings before a comparison using real, authorized sample records.
