import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createDemoFleet, currentPeriod, fleetMetrics, getExceptions, submitMonthlyReport,
  reviewMonthlyReport, addVehicle, addMaintenanceTicket, updateMaintenanceTicket,
  buildReviewCsv, saveFleetState, loadFleetState, FLEET_STORAGE_KEY,
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
  const final = updateMaintenanceTicket(scheduled, ticket.id, 'Resolved', 'Garage team')
  assert.ok(final.audit.some(e => e.action === 'Maintenance resolved'))
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
