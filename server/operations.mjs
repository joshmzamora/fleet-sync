import {
  submitMonthlyReport, reviewMonthlyReport, reopenApprovedReportForCorrection,
  addVehicle, updateVehicleRecord, setVehicleStatus, updateDepartmentProfile,
  recordReportFollowUp, updateReportFollowUp,
  addMaintenanceTicket, updateMaintenanceTicket, recordExportPreparation,
} from '../src/fleet/domain.ts'

export class AccessError extends Error {
  constructor(message = 'Your account does not have permission to perform this action.') {
    super(message)
    this.status = 403
    this.code = 'FORBIDDEN'
  }
}

function allowed(user, ...roles) {
  if (!roles.includes(user.role)) throw new AccessError()
}
function vehicleFor(state, vehicleId) {
  const vehicle = state.vehicles.find(v => v.id === vehicleId)
  if (!vehicle) throw new Error('Vehicle not found.')
  return vehicle
}
function scope(user, department) {
  if (user.role !== 'Fleet Admin' && user.role !== 'Maintenance' && user.department !== department) {
    throw new AccessError('The selected record is outside your assigned department.')
  }
}
function reportFor(state, reportId) {
  const report = state.reports.find(item => item.id === reportId)
  if (!report) throw new Error('Monthly report not found.')
  return report
}
function reportDepartment(state, report) {
  return report.departmentAtSubmission ?? vehicleFor(state, report.vehicleId).department
}
function samePerson(user, report, state) {
  if (report.submittedByUserId === user.id) return true
  if (state.reportHistory.some(entry => entry.reportId === report.id && entry.snapshot.submittedByUserId === user.id)) return true
  // Preserve safety when older fictional submissions have no account ID.
  return !report.submittedByUserId && report.operator.trim().toLowerCase() === user.displayName.trim().toLowerCase()
}
function recordInput(raw) {
  const input = object(raw, 'Report')
  return {
    vehicleId: input.vehicleId, period: input.period,
    startOdometer: input.startOdometer, endOdometer: input.endOdometer,
    fuelGallons: input.fuelGallons, fuelCost: input.fuelCost,
    condition: input.condition, notes: input.notes, operator: input.operator,
  }
}
function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(label + ' fields are required.')
  return value
}
function text(value, label, length = 400) {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > length) throw new Error(label + ' must be provided.')
  return value
}
function pickVehicle(input) {
  const raw = object(input, 'Vehicle')
  const fields = ['unit', 'department', 'year', 'make', 'model', 'kind', 'plate', 'licensed', 'odometer', 'custodian', 'notes']
  return Object.fromEntries(fields.filter(key => Object.prototype.hasOwnProperty.call(raw, key)).map(key => [key, raw[key]]))
}

/** Only these named transitions can mutate shared records. The caller's
 * identity is provided by an HttpOnly session and cannot be supplied in JSON. */
export function applyAction(state, user, type, payload) {
  const p = object(payload, 'Action')
  const actor = user.displayName
  switch (type) {
    case 'submit-report': {
      allowed(user, 'Driver')
      const input = recordInput(p)
      const vehicle = vehicleFor(state, input.vehicleId)
      const existing = state.reports.find(r => r.vehicleId === input.vehicleId && r.period === input.period)
      scope(user, existing?.departmentAtSubmission ?? vehicle.department)
      if (existing?.status === 'Returned' && existing.submittedByUserId && existing.submittedByUserId !== user.id) {
        throw new AccessError('Only the original submitting driver may correct this returned report.')
      }
      return submitMonthlyReport(state, { ...input, operator: actor }, user.id)
    }
    case 'review-report': {
      allowed(user, 'Supervisor', 'Fleet Admin')
      const report = reportFor(state, p.reportId)
      scope(user, reportDepartment(state, report))
      if (samePerson(user, report, state)) throw new AccessError('You cannot approve or review your own report.')
      if (p.decision !== 'Approved' && p.decision !== 'Returned') throw new Error('Choose Approve or Return.')
      return reviewMonthlyReport(state, report.id, p.decision, actor, p.note ?? '')
    }
    case 'reopen-report': {
      allowed(user, 'Supervisor', 'Fleet Admin')
      const report = reportFor(state, p.reportId)
      scope(user, reportDepartment(state, report))
      if (samePerson(user, report, state)) throw new AccessError('You cannot reopen your own report for supervisory correction.')
      return reopenApprovedReportForCorrection(state, report.id, actor, text(p.reason, 'Correction reason'))
    }
    case 'add-vehicle': {
      allowed(user, 'Fleet Admin')
      return addVehicle(state, pickVehicle(p.input), actor)
    }
    case 'update-vehicle': {
      allowed(user, 'Fleet Admin')
      vehicleFor(state, p.vehicleId)
      return updateVehicleRecord(state, p.vehicleId, pickVehicle(p.changes), actor)
    }
    case 'vehicle-status': {
      allowed(user, 'Fleet Admin')
      vehicleFor(state, p.vehicleId)
      return setVehicleStatus(state, p.vehicleId, p.status, actor, p.note ?? '')
    }
    case 'update-department': {
      allowed(user, 'Fleet Admin')
      return updateDepartmentProfile(state, p.name, object(p.input, 'Department'), actor)
    }
    case 'create-follow-up': {
      allowed(user, 'Supervisor', 'Fleet Admin')
      const vehicle = vehicleFor(state, p.vehicleId)
      const historicalReport = state.reports.find(report => report.vehicleId === p.vehicleId && report.period === p.period)
      scope(user, historicalReport?.departmentAtSubmission ?? vehicle.department)
      return recordReportFollowUp(state, vehicle.id, p.period, actor, p.note, p.dueOn, p.owner)
    }
    case 'update-follow-up': {
      allowed(user, 'Supervisor', 'Fleet Admin')
      const task = state.followUps.find(item => item.id === p.id)
      if (!task) throw new Error('Follow-up not found.')
      scope(user, task.departmentAtCreation ?? vehicleFor(state, task.vehicleId).department)
      return updateReportFollowUp(state, task.id, p.status, actor, object(p.options ?? {}, 'Follow-up options'))
    }
    case 'add-ticket': {
      allowed(user, 'Maintenance', 'Fleet Admin')
      const input = object(p.input, 'Maintenance')
      vehicleFor(state, input.vehicleId)
      return addMaintenanceTicket(state, {
        vehicleId: input.vehicleId, title: input.title,
        description: input.description, severity: input.severity, assignee: input.assignee,
      }, actor)
    }
    case 'update-ticket': {
      allowed(user, 'Maintenance', 'Fleet Admin')
      if (!state.tickets.some(ticket => ticket.id === p.ticketId)) throw new Error('Maintenance issue not found.')
      return updateMaintenanceTicket(state, p.ticketId, p.status, actor, object(p.details ?? {}, 'Maintenance details'))
    }
    case 'record-export': {
      allowed(user, 'Fleet Admin')
      return recordExportPreparation(state, p.scope, p.label, p.recordCount, actor)
    }
    default:
      throw new AccessError('Unknown or unauthorized shared operation.')
  }
}

/** Deny-by-default read scope; the browser does not receive other departments'
 * records to view, inspect or export. */
export function projectStateForUser(state, user) {
  if (user.role === 'Fleet Admin') return state
  if (user.role === 'Maintenance') {
    const linkedReportIds = new Set(state.tickets.map(ticket => ticket.sourceReportId).filter(Boolean))
    return {
      ...state,
      reports: state.reports.filter(report => linkedReportIds.has(report.id)),
      reportHistory: [],
      followUps: [],
      audit: state.audit.filter(entry => entry.action.toLowerCase().includes('maintenance') || entry.action.toLowerCase().includes('service hold') || entry.action.toLowerCase().includes('vehicle status')),
      departmentProfiles: [],
    }
  }
  const department = user.department
  // A transferred vehicle may still have pending submissions owned by the
  // previous department. That supervisor must be able to finish its review,
  // and the original driver must still see returned work they can correct.
  const historicPendingVehicleIds = new Set(
    state.reports
      .filter(report => report.status !== 'Approved' && report.departmentAtSubmission === department &&
        (user.role === 'Supervisor' || (user.role === 'Driver' && report.status === 'Returned' && report.submittedByUserId === user.id)))
      .map(report => report.vehicleId),
  )
  if (user.role === 'Supervisor') {
    for (const task of state.followUps) {
      if (task.status !== 'Closed' && task.departmentAtCreation === department) historicPendingVehicleIds.add(task.vehicleId)
    }
  }
  const visibleVehicles = state.vehicles.filter(v => v.department === department || historicPendingVehicleIds.has(v.id))
  const vehicleIds = new Set(visibleVehicles.map(v => v.id))
  const reports = state.reports.filter(r => {
    if ((r.departmentAtSubmission ?? state.vehicles.find(v => v.id === r.vehicleId)?.department) !== department || !vehicleIds.has(r.vehicleId)) return false
    return user.role !== 'Driver' || state.vehicles.some(vehicle => vehicle.id === r.vehicleId && vehicle.department === department) ||
      r.submittedByUserId === user.id
  })
  const reportIds = new Set(reports.map(r => r.id))
  const tickets = state.tickets.filter(t => vehicleIds.has(t.vehicleId))
  const ticketIds = new Set(tickets.map(t => t.id))
  const followUps = state.followUps.filter(item => vehicleIds.has(item.vehicleId) &&
    (item.departmentAtCreation ?? state.vehicles.find(v => v.id === item.vehicleId)?.department) === department)
  return {
    ...state, vehicles: visibleVehicles, reports, tickets, followUps,
    departmentProfiles: state.departmentProfiles.filter(p => p.name === department),
    reportHistory: state.reportHistory.filter(entry => reportIds.has(entry.reportId)),
    ticketHistory: state.ticketHistory.filter(entry => ticketIds.has(entry.ticketId)),
    audit: state.audit.filter(entry => entry.vehicleId && vehicleIds.has(entry.vehicleId)),
  }
}
