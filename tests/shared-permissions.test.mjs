import test from 'node:test'
import assert from 'node:assert/strict'
import { createDemoFleet, currentPeriod } from '../src/fleet/domain.ts'
import { applyAction, projectStateForUser, AccessError } from '../server/operations.mjs'

const admin = { id: 'user-admin', username: 'admin', displayName: 'Demo Fleet Admin', role: 'Fleet Admin', department: null }
const driver = { id: 'driver-a', username: 'driver-a', displayName: 'Demo Facilities Driver', role: 'Driver', department: 'Facilities' }
const otherDriver = { ...driver, id: 'driver-b', username: 'driver-b', displayName: 'Other Facilities Driver' }
const supervisor = { id: 'supervisor-a', username: 'facilities-supervisor', displayName: 'Demo Facilities Supervisor', role: 'Supervisor', department: 'Facilities' }
const housingSupervisor = { ...supervisor, id: 'supervisor-b', username: 'housing-supervisor', displayName: 'Demo Housing Supervisor', department: 'Housing' }
const technician = { id: 'maintenance-a', username: 'fleet-technician', displayName: 'Demo Technician', role: 'Maintenance', department: null }

function driverReport(overrides = {}) {
  return {
    vehicleId: 'v006', period: currentPeriod(), startOdometer: 111900,
    endOdometer: 111913, fuelGallons: 4, fuelCost: 15,
    condition: 'Good', notes: '', operator: 'Claimed Fleet Administrator',
    ...overrides,
  }
}

test('a shared driver cannot impersonate a reviewer or overwrite another driver’s correction', () => {
  let state = createDemoFleet()
  state = applyAction(state, driver, 'submit-report', driverReport())
  const report = state.reports.find(r => r.vehicleId === 'v006' && r.period === currentPeriod())
  assert.equal(report.operator, driver.displayName, 'Operator identity must come from authenticated session')
  assert.equal(report.submittedByUserId, driver.id)
  assert.throws(() => applyAction(state, driver, 'review-report', { reportId: report.id, decision: 'Approved' }), AccessError)
  assert.throws(() => applyAction(state, housingSupervisor, 'review-report', { reportId: report.id, decision: 'Approved' }), AccessError)
  state = applyAction(state, supervisor, 'review-report', { reportId: report.id, decision: 'Returned', note: 'Please correct the odometer.' })
  assert.throws(() => applyAction(state, otherDriver, 'submit-report', driverReport({ endOdometer: 111918 })), /original submitting driver/)
  state = applyAction(state, driver, 'submit-report', driverReport({ endOdometer: 111918 }))
  assert.equal(state.reports.find(r => r.id === report.id).revision, 2)
  assert.equal(state.reports.find(r => r.id === report.id).submittedByUserId, driver.id)
  const promotedDriver = { ...driver, role: 'Supervisor' }
  assert.throws(() => applyAction(state, promotedDriver, 'review-report', { reportId: report.id, decision: 'Approved' }), /cannot approve or review your own/)
  state = applyAction(state, supervisor, 'review-report', { reportId: report.id, decision: 'Approved' })
  assert.equal(state.reports.find(r => r.id === report.id).status, 'Approved')
})

test('the original department can finish a pending submission and its tasks after a vehicle transfer', () => {
  let state = createDemoFleet()
  state = applyAction(state, driver, 'submit-report', driverReport())
  const report = state.reports.find(r => r.vehicleId === 'v006' && r.period === currentPeriod())
  state = applyAction(state, admin, 'update-vehicle', { vehicleId: 'v006', changes: { department: 'Housing' } })
  const before = projectStateForUser(state, supervisor)
  assert.ok(before.vehicles.some(v => v.id === 'v006'), 'Former department lost the vehicle needed to review a pending record')
  assert.ok(before.reports.some(r => r.id === report.id), 'Former department lost its pending report')
  assert.ok(!projectStateForUser(state, housingSupervisor).reports.some(r => r.id === report.id), 'New department can read earlier department submission')
  assert.throws(() => applyAction(state, housingSupervisor, 'review-report', { reportId: report.id, decision: 'Approved' }), AccessError)
  state = applyAction(state, supervisor, 'create-follow-up', {
    vehicleId: 'v006', period: currentPeriod(), note: 'Confirm final meter reading before approval.',
    dueOn: '2026-12-01', owner: 'Facilities desk',
  })
  const task = state.followUps[0]
  assert.equal(task.departmentAtCreation, 'Facilities')
  assert.ok(projectStateForUser(state, supervisor).followUps.some(item => item.id === task.id))
  assert.throws(() => applyAction(state, housingSupervisor, 'update-follow-up', {
    id: task.id, status: 'Closed', options: { outcome: 'Finished incorrectly.' },
  }), AccessError)
  state = applyAction(state, supervisor, 'review-report', { reportId: report.id, decision: 'Returned', note: 'Confirm meter before signoff.' })
  const driverView = projectStateForUser(state, driver)
  assert.ok(driverView.reports.some(r => r.id === report.id), 'Original driver cannot see a returned record after transfer')
  state = applyAction(state, driver, 'submit-report', driverReport({ endOdometer: 111917 }))
  state = applyAction(state, supervisor, 'review-report', { reportId: report.id, decision: 'Approved' })
  assert.equal(state.followUps.find(f => f.id === task.id).status, 'Closed', 'Approval should close original department follow-up')
})

test('shared technician reads work orders without receiving unrelated monthly reports or follow-up notes', () => {
  let state = createDemoFleet()
  state = applyAction(state, admin, 'create-follow-up', {
    vehicleId: 'v006', period: currentPeriod(),
    note: 'Requested monthly mileage update.', owner: 'Facilities desk', dueOn: '2026-12-01',
  })
  const maintenanceView = projectStateForUser(state, technician)
  assert.equal(maintenanceView.tickets.length, state.tickets.length)
  assert.equal(maintenanceView.followUps.length, 0)
  assert.equal(maintenanceView.reportHistory.length, 0)
  const linked = new Set(state.tickets.map(ticket => ticket.sourceReportId).filter(Boolean))
  assert.ok(maintenanceView.reports.every(report => linked.has(report.id)))
  assert.ok(maintenanceView.reports.length < state.reports.length)
  assert.throws(() => applyAction(state, technician, 'review-report', { reportId: state.reports[0].id, decision: 'Approved' }), AccessError)
  assert.throws(() => applyAction(state, driver, 'add-ticket', { input: {
    vehicleId: 'v006', title: 'Unauthorized issue', description: 'Driver action not permitted.', severity: 'Low',
  } }), AccessError)
})
