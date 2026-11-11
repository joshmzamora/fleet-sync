# FleetSync product decisions

## Target workflow

FleetSync is a **reporting and exception-resolution workbench for decentralized university fleets**. It supports a monthly internal collection and correction cycle that provides a reliable starting point for quarterly Texas fleet reporting preparation. It also passes vehicle-condition observations into maintenance follow-up.

The original Team 10 discovery materials identified three separate jobs:

| User | Work to complete | MVP experience |
| --- | --- | --- |
| Vehicle operator | Report a month's use and condition without repeatedly filling known fields or delivering paper | Mobile-friendly report, sensible prior-reading prefill, clear validation, submission confirmation |
| Department supervisor / fleet coordinator | Find missing or questionable submissions, review them and keep the handoff moving | Assigned department, completion by month, clear pending/returned/overdue states, internal follow-up history |
| Garage / fleet administrator | Act on condition concerns and reconcile approved records before external filing | Vehicle service holds, work ownership and resolution notes, exceptions and quarter reconciliation |

UT Dallas discovery materials discuss paper, manual record entry, departmental handoffs, AssetWorks/AiM, spreadsheets and TxFS. **Some interview-guide details are open questions rather than confirmed process facts.** In particular, actual signature requirements, TxFS bulk-import compatibility, internal due days, notification authority and maintenance-system integration must be validated before a real deployment.

## Interface benchmark

Public examples consulted:

- [Fleetio dashboard](https://help.fleetio.com/en_US/dashboard-overview): simple status/overdue KPIs linked to actual fleet work rather than decorative data.
- [Fleetio work orders](https://www.fleetio.com/tools/work-order-template): restrained sidebar, clear status tabs, searchable/filterable table, priority and vehicle identity visible in the same row.
- [AssetWorks planning and scheduling](https://www.goassetworks.com/planning-scheduling-work): maintenance work presented with status, assignment and schedule context for technicians and supervisors.

FleetSync should use **flat, neutral operational UI**: compact tables and filters, descriptive headings, readable status words, accessible forms, minimal visual decoration and warning colors only where risk warrants them. It should never imply that a simulated role switch is access control.

## Deliberately narrow scope

1. **First:** capture month-end data, validate readings, review submissions, surface exceptions, log local follow-ups and prepare review-only quarterly reconciliations. The state's official quarterly filing window is days 45–60 after quarter end, while internal collection happens monthly.
2. **Second:** expand maintenance history, repair ownership and vehicle-cost evidence, informed by garage input.
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
