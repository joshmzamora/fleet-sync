import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createDemoFleet, currentPeriod, fleetMetrics, getExceptions, submitMonthlyReport,
  reviewMonthlyReport, addVehicle, addMaintenanceTicket, updateMaintenanceTicket,
  buildReviewCsv, saveFleetState, loadFleetState, FLEET_STORAGE_KEY,
  reportDueDate, fiscalQuarterForPeriod, fiscalQuarterMonths, quarterDueDate, quarterWindowStartDate,
  quarterReadiness, buildQuarterReviewCsv, updateDepartmentProfile, recordReportFollowUp,
  getDepartmentScorecard, monthlyTrends, getOdometerWarnings, updateVehicleRecord, setVehicleStatus,
  recordExportPreparation,
} from '../src/fleet/domain.ts'

function driverInput(vehicleId, period = currentPeriod(), overrides = {}) {
  return {
    vehicleId, period, operator: 'Taylor Fleet', startOdometer: 110000,
    endOdometer: 111000, fuelGallons: 31, fuelCost: 95.4,
    condition: 'Good', notes: '', ...overrides,
  }
}

test('demo fleet is fictional, internally consistent and has useful reporting gaps', () => {
  const state = createDemoFleet()
  const ids = state.vehicles.map(v => v.id)
  assert.equal(new Set(ids).size, ids.length)
  assert.ok(state.vehicles.length >= 12)
  assert.ok(state.vehicles.some(v => !v.licensed), 'Non-licensed carts should exist in the sample')
  assert.ok(state.reports.every(r => ids.includes(r.vehicleId)))
  assert.ok(state.tickets.every(t => ids.includes(t.vehicleId)))
  const metrics = fleetMetrics(state, currentPeriod())
  assert.ok(metrics.missing > 0)
  assert.ok(metrics.pending > 0)
  assert.equal(metrics.reported + metrics.missing, metrics.vehicles)
  assert.ok(getExceptions(state, currentPeriod()).some(ex => ex.type === 'Missing report'))
})

test('driver report, supervisor signoff and audit trail work together', () => {
  const base = createDemoFleet()
  const period = currentPeriod()
  const vehicle = base.vehicles.find(v => !base.reports.some(r => r.vehicleId === v.id))
  assert.ok(vehicle)
  const input = driverInput(vehicle.id, period, {
    startOdometer: Math.max(0, vehicle.odometer - 55),
    endOdometer: vehicle.odometer + 5,
  })
  const submitted = submitMonthlyReport(base, input)
  const report = submitted.reports.find(r => r.vehicleId === vehicle.id && r.period === period)
  assert.equal(report.status, 'Pending')
  assert.equal(report.revision, 1)
  assert.equal(fleetMetrics(submitted, period).missing, fleetMetrics(base, period).missing - 1)
  assert.throws(() => submitMonthlyReport(submitted, input), /already exists/)
  const approved = reviewMonthlyReport(submitted, report.id, 'Approved', 'Alex Supervisor')
  assert.equal(approved.reports.find(r => r.id === report.id).status, 'Approved')
  assert.ok(approved.audit.some(e => e.action === 'Report approved' && e.reportId === report.id))
  assert.throws(() => reviewMonthlyReport(approved, report.id, 'Returned', 'Alex Supervisor', 'Retry'), /Only pending/)
})

test('returned report can be corrected, and unsafe reports create linked maintenance alerts', () => {
  const base = createDemoFleet()
  const pending = base.reports.find(r => r.status === 'Pending')
  const returned = reviewMonthlyReport(base, pending.id, 'Returned', 'Alex Supervisor', 'Correct the ending odometer')
  assert.equal(returned.reports.find(r => r.id === pending.id).status, 'Returned')
  const input = driverInput(pending.vehicleId, pending.period, {
    startOdometer: pending.startOdometer,
    endOdometer: pending.endOdometer + 10,
    condition: 'Unsafe',
    notes: 'Critical brake warning illuminated.',
  })
  const corrected = submitMonthlyReport(returned, input)
  assert.equal(corrected.reports.find(r => r.id === pending.id).revision, 2)
  assert.equal(corrected.reports.find(r => r.id === pending.id).status, 'Pending')
  const linked = corrected.tickets.filter(t => t.sourceReportId === pending.id)
  assert.ok(linked.some(t => t.severity === 'High' && t.status === 'Open'))
  assert.ok(getExceptions(corrected, pending.period).some(ex => ex.type === 'Safety alert' && ex.vehicleId === pending.vehicleId))
})

test('invalid reporting values and duplicate unit identifiers are rejected', () => {
  const base = createDemoFleet()
  assert.throws(() => submitMonthlyReport(base, driverInput('v006', currentPeriod(), {
    endOdometer: 109000,
  })), /Ending odometer/)
  assert.throws(() => submitMonthlyReport(base, driverInput('v006', currentPeriod(), {
    condition: 'Needs attention',
    notes: '',
  })), /Describe/)
  const existing = base.vehicles[0]
  assert.throws(() => addVehicle(base, {
    ...existing, id: undefined, status: undefined, unit: existing.unit.toLowerCase(),
  }), /already in use/)
  assert.throws(() => addVehicle(base, {
    ...existing, id: undefined, status: undefined, unit: 'DEMO-PLATE-CHECK', plate: existing.plate.toLowerCase(),
  }), /already assigned/)
})

test('ticket changes retain audit history and review export excludes unapproved and nonlicensed vehicles', () => {
  const base = createDemoFleet()
  const extra = addMaintenanceTicket(base, {
    vehicleId: 'v002', title: 'Replace worn windshield wipers', description: 'Driver observed poor clearing.',
    severity: 'Low',
  })
  const ticket = extra.tickets[0]
  const scheduled = updateMaintenanceTicket(extra, ticket.id, 'Scheduled', 'Garage team')
  assert.equal(scheduled.tickets.find(t => t.id === ticket.id).status, 'Scheduled')
  assert.throws(() => updateMaintenanceTicket(extra, ticket.id, 'Scheduled', 'Garage team', { scheduledFor: '2026-02-30' }), /valid service date/)
  assert.throws(() => updateMaintenanceTicket(scheduled, ticket.id, 'Resolved', 'Garage team'), /Describe the repair/)
  const final = updateMaintenanceTicket(scheduled, ticket.id, 'Resolved', 'Garage team', { resolutionNote: 'Replaced worn wiper blades and checked operation.', actualCost: 29.95 })
  assert.ok(final.audit.some(e => e.action === 'Maintenance resolved'))
  assert.equal(final.tickets.find(t => t.id === ticket.id).actualCost, 29.95)
  const csv = buildReviewCsv(base, currentPeriod())
  assert.ok(csv.count > 0)
  assert.ok(!csv.csv.includes('CART-'), 'Nonlicensed carts must be omitted from licensed fleet export')
  assert.ok(!csv.csv.includes('"Pending"'), 'Pending reports must not be exported')
})

test('spreadsheet-formula payloads are neutralized in CSV staging files', () => {
  const base = createDemoFleet()
  const approved = base.reports.find(r => r.status === 'Approved' && base.vehicles.find(v => v.id === r.vehicleId).licensed)
  const poisoned = {
    ...base,
    vehicles: base.vehicles.map(v => v.id === approved.vehicleId ? { ...v, unit: '=HYPERLINK("https://example.invalid")' } : v),
  }
  const { csv } = buildReviewCsv(poisoned, approved.period)
  assert.ok(csv.includes('"\'=HYPERLINK('), 'CSV export should prefix untrusted formula-like cells with apostrophe')
})

test('demo changes are durable in browser-style storage and recover gracefully from corrupt data', () => {
  const stored = new Map()
  const storage = {
    getItem: key => stored.get(key) ?? null,
    setItem: (key, value) => stored.set(key, value),
  }
  const state = createDemoFleet()
  saveFleetState(state, storage)
  assert.equal(loadFleetState(storage).vehicles.length, state.vehicles.length)
  stored.set(FLEET_STORAGE_KEY, 'invalid-json')
  assert.ok(loadFleetState(storage).vehicles.length > 0)
})

test('monthly internal due dates and fiscal quarters cross year boundaries correctly', () => {
  assert.equal(reportDueDate('2026-11', 5), '2026-12-05')
  assert.equal(reportDueDate('2026-12', 28), '2027-01-28')
  assert.equal(reportDueDate('2027-01', 5), '2027-02-05')
  assert.deepEqual(fiscalQuarterForPeriod('2026-09'), { fiscalYear: 2027, quarter: 1 })
  assert.deepEqual(fiscalQuarterForPeriod('2026-12'), { fiscalYear: 2027, quarter: 2 })
  assert.deepEqual(fiscalQuarterForPeriod('2027-02'), { fiscalYear: 2027, quarter: 2 })
  assert.deepEqual(fiscalQuarterForPeriod('2027-08'), { fiscalYear: 2027, quarter: 4 })
  assert.deepEqual(fiscalQuarterMonths(2027, 2), ['2026-12', '2027-01', '2027-02'])
  assert.equal(quarterWindowStartDate(2027, 1), '2027-01-14')
  assert.equal(quarterDueDate(2027, 1), '2027-01-29')
  assert.throws(() => reportDueDate('2026-10', 30), /from 1 to 28/)
})

test('a department deadline changes overdue exception priority and identifies accountable coordinator', () => {
  const base = createDemoFleet('2026-11')
  const unreported = base.vehicles.find(v => v.id === 'v006')
  assert.ok(unreported)
  const scope = 'Facilities'
  const current = getExceptions(base, '2026-11', scope, new Date('2026-11-11T12:00:00'))
  assert.ok(current.some(e => e.vehicleId === unreported.id && e.type === 'Missing report'))
  assert.ok(!current.some(e => e.vehicleId === unreported.id && e.type === 'Overdue report'))
  const overdue = getExceptions(base, '2026-10', scope, new Date('2026-12-15T12:00:00'))
  assert.ok(overdue.some(e => e.type === 'Overdue report' || e.type === 'Overdue approval'))
  const modified = updateDepartmentProfile(base, scope, {
    coordinator: 'Demo Facilities Coordinator', contact: 'demo@example.invalid', monthlyDueDay: 20, notes: 'Demo internal policy.',
  })
  const beforeDeadline = getExceptions(modified, '2026-11', scope, new Date('2026-12-10T12:00:00'))
  const item = beforeDeadline.find(e => e.vehicleId === unreported.id && e.id.startsWith('missing'))
  assert.equal(item.type, 'Missing report')
  assert.equal(item.owner, 'Demo Facilities Coordinator')
  assert.equal(item.dueDate, '2026-12-20')
  assert.ok(modified.audit.some(entry => entry.action === 'Department policy updated'))
  const afterDeadline = getExceptions(modified, '2026-11', scope, new Date('2026-12-25T12:00:00'))
  assert.equal(afterDeadline.find(e => e.id === item.id).type, 'Overdue report')
})

test('an internal follow-up is durable and explicitly described as logged rather than sent', () => {
  const state = createDemoFleet('2026-11')
  const updated = recordReportFollowUp(state, 'v006', '2026-11', 'Demo Fleet Admin', 'Called custodian and requested the usage log.')
  const item = getExceptions(updated, '2026-11').find(e => e.vehicleId === 'v006' && e.type === 'Missing report')
  assert.ok(item.lastFollowUpAt)
  assert.equal(updated.followUps.length, state.followUps.length + 1)
  assert.ok(updated.audit[0].action.includes('not sent'))
  assert.throws(() => recordReportFollowUp(state, 'v006', '2026-11', 'Admin', 'x'), /5/)
})

test('legacy v1 browser state gains department profiles without losing records', () => {
  const stored = new Map()
  const storage = {
    getItem: key => stored.get(key) ?? null,
    setItem: (key, value) => stored.set(key, value),
  }
  const state = createDemoFleet('2026-11')
  delete state.departmentProfiles
  delete state.followUps
  stored.set(FLEET_STORAGE_KEY, JSON.stringify(state))
  const restored = loadFleetState(storage)
  assert.equal(restored.vehicles.length, state.vehicles.length)
  assert.equal(restored.reports.length, state.reports.length)
  assert.ok(restored.departmentProfiles.some(p => p.name === 'Facilities' && p.monthlyDueDay === 5))
  assert.deepEqual(restored.followUps, [])
})

test('odometer consistency checks reject overlapping chronology and flag abnormal mileage', () => {
  const state = createDemoFleet('2026-11')
  const approvedPrevious = state.reports.find(r => r.vehicleId === 'v010' && r.period === '2026-10' && r.status === 'Approved')
  assert.ok(approvedPrevious)
  assert.throws(() => submitMonthlyReport(state, driverInput('v010', '2026-11', {
    startOdometer: approvedPrevious.endOdometer - 1, endOdometer: 137270,
  })), /overlaps/)
  assert.throws(() => submitMonthlyReport(state, driverInput('v010', '2026-11', {
    startOdometer: approvedPrevious.endOdometer, endOdometer: approvedPrevious.endOdometer + 5001,
  })), /Explain unusually high/)
  assert.ok(getOdometerWarnings(state, 'v010', '2026-11', 136700, 141701).some(w => /4,000/.test(w)))
})

test('supervisor approval rechecks meter chronology when two months were pending at once', () => {
  let state = createDemoFleet('2026-11')
  // v013 is a fictional cart with no existing historical approvals.
  state = submitMonthlyReport(state, driverInput('v013', '2026-11', {
    startOdometer: 100, endOdometer: 150,
  }))
  state = submitMonthlyReport(state, driverInput('v013', '2026-10', {
    startOdometer: 125, endOdometer: 175,
  }))
  const november = state.reports.find(r => r.vehicleId === 'v013' && r.period === '2026-11')
  const october = state.reports.find(r => r.vehicleId === 'v013' && r.period === '2026-10')
  state = reviewMonthlyReport(state, november.id, 'Approved', 'Demo Supervisor')
  assert.throws(
    () => reviewMonthlyReport(state, october.id, 'Approved', 'Demo Supervisor'),
    /overlaps the now-approved later month/,
  )
  const returned = reviewMonthlyReport(state, october.id, 'Returned', 'Demo Supervisor', 'Readings overlap November.')
  assert.equal(returned.reports.find(r => r.id === october.id).status, 'Returned')
})

test('unsafe reports place vehicles on audited service hold until explicitly released', () => {
  let state = createDemoFleet('2026-11')
  state = submitMonthlyReport(state, driverInput('v006', '2026-11', {
    startOdometer: 111900, endOdometer: 111915, condition: 'Unsafe',
    notes: 'Driver reports brake failure warning on startup.',
  }))
  assert.equal(state.vehicles.find(v => v.id === 'v006').status, 'In maintenance')
  assert.ok(getExceptions(state, '2026-11').some(e => e.vehicleId === 'v006' && e.type === 'Service hold'))
  assert.throws(() => setVehicleStatus(state, 'v006', 'Active', 'Demo Admin', 'Ready again'), /Resolve high-priority/)
  const safetyTicket = state.tickets.find(t => t.vehicleId === 'v006' && t.sourceReportId === state.reports.find(r => r.vehicleId === 'v006' && r.period === '2026-11').id)
  assert.ok(safetyTicket)
  state = updateMaintenanceTicket(state, safetyTicket.id, 'Resolved', 'Demo Garage', { resolutionNote: 'Brake warning inspected, wiring repaired and road test passed.', actualCost: 128.60 })
  state = setVehicleStatus(state, 'v006', 'Active', 'Demo Fleet Admin', 'Verified repaired after inspection')
  assert.equal(state.vehicles.find(v => v.id === 'v006').status, 'Active')
  assert.ok(state.audit.some(e => e.action === 'Vehicle status changed'))
})

test('vehicle edits validate unique inventory, odometer history and log changes', () => {
  const state = createDemoFleet('2026-11')
  assert.throws(() => updateVehicleRecord(state, 'v006', { unit: 'UTD-0148' }), /already exists/)
  assert.throws(() => updateVehicleRecord(state, 'v006', { plate: 'TX-DEM148' }), /already exists/)
  assert.throws(() => updateVehicleRecord(state, 'v001', { odometer: 2 }), /below an approved/)
  const edited = updateVehicleRecord(state, 'v006', { department: 'Housing', custodian: 'Fictional Housing Liaison', notes: 'Reassigned for demo.' })
  assert.equal(edited.vehicles.find(v => v.id === 'v006').department, 'Housing')
  assert.ok(edited.audit.some(e => e.action === 'Vehicle record updated'))
})

test('quarterly reconciliation includes missing and incomplete vehicles and avoids labeling itself official', () => {
  const state = createDemoFleet('2026-11')
  const summary = quarterReadiness(state, 2027, 1)
  assert.deepEqual(summary.months, ['2026-09', '2026-10', '2026-11'])
  assert.equal(summary.windowOpens, '2027-01-14')
  assert.equal(summary.expected, state.vehicles.filter(v => v.licensed).length * 3)
  assert.equal(summary.approved + summary.pending + summary.returned + summary.missing, summary.expected)
  assert.ok(summary.approved > 0 && summary.missing > 0)
  assert.ok(summary.vehicles.some(row => !row.ready && row.monthlyStatus['2026-11'] === 'Missing'))
  const csv = buildQuarterReviewCsv(state, 2027, 1)
  assert.equal(csv.count, summary.vehicles.length)
  assert.ok(csv.csv.includes('STAGING ONLY - NOT A TxFS SUBMISSION'))
  assert.ok(csv.csv.includes('INCOMPLETE - FOLLOW UP'))
  assert.ok(!csv.csv.includes('CART-'), 'Nonlicensed carts excluded')
  assert.ok(buildQuarterReviewCsv(state, 2027, 1, 'Housing').count < csv.count)
})

test('reporting trend and department scorecard reflect real stored history', () => {
  const state = createDemoFleet('2026-11')
  const trends = monthlyTrends(state, '2026-11', 3, 'Facilities')
  assert.deepEqual(trends.map(t => t.period), ['2026-09', '2026-10', '2026-11'])
  assert.ok(trends.some(t => t.approved > 0))
  const score = getDepartmentScorecard(state, '2026-11')
  assert.ok(score.some(s => s.name === 'Facilities' && s.vehicles > 0))
  assert.ok(score.every(s => s.completion >= 0 && s.completion <= 100))
})

test('review CSV preparation generates a local-only audit event', () => {
  const state = createDemoFleet('2026-11')
  const logged = recordExportPreparation(state, 'Quarterly', 'FY2027 Q1', 12, 'Demo Fleet Admin')
  assert.equal(logged.audit[0].action, 'Quarterly review CSV prepared (local only)')
  assert.ok(logged.audit[0].detail.includes('not a TxFS submission'))
  assert.ok(logged.reports.length === state.reports.length)
  assert.throws(() => recordExportPreparation(state, 'Quarterly', 'FY2027 Q1', -1), /record count/)
})
