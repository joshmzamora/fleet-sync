/**
 * FleetSync demo domain.
 *
 * This browser-only MVP deliberately stores fictional data in localStorage.
 * It does not grant permissions or submit records to a government system.
 */
export type Role = 'Fleet Admin' | 'Supervisor' | 'Driver' | 'Maintenance'
export type VehicleKind = 'Sedan' | 'SUV' | 'Pickup' | 'Van' | 'Box truck' | 'Utility cart'
export type VehicleStatus = 'Active' | 'In maintenance' | 'Retired'
export type ReportStatus = 'Pending' | 'Approved' | 'Returned'
export type VehicleCondition = 'Good' | 'Needs attention' | 'Unsafe'
export type Severity = 'Low' | 'Medium' | 'High'
export type TicketStatus = 'Open' | 'Scheduled' | 'Resolved'

export interface Vehicle {
  id: string
  unit: string
  department: string
  year: number
  make: string
  model: string
  kind: VehicleKind
  plate: string
  licensed: boolean
  odometer: number
  status: VehicleStatus
  custodian: string
}

export interface MonthlyReport {
  id: string
  vehicleId: string
  period: string
  startOdometer: number
  endOdometer: number
  fuelGallons: number
  fuelCost: number
  condition: VehicleCondition
  notes: string
  operator: string
  submittedAt: string
  status: ReportStatus
  reviewedBy?: string
  reviewedAt?: string
  reviewNote?: string
  revision: number
}

export interface MaintenanceTicket {
  id: string
  vehicleId: string
  title: string
  description: string
  severity: Severity
  status: TicketStatus
  createdAt: string
  updatedAt: string
  sourceReportId?: string
  assignee?: string
}

export interface AuditEntry {
  id: string
  at: string
  actor: string
  action: string
  detail: string
  vehicleId?: string
  reportId?: string
}

export interface FleetState {
  schemaVersion: 1
  vehicles: Vehicle[]
  reports: MonthlyReport[]
  tickets: MaintenanceTicket[]
  audit: AuditEntry[]
}

export type ReportInput = Pick<MonthlyReport, 'vehicleId' | 'period' | 'startOdometer' | 'endOdometer' | 'fuelGallons' | 'fuelCost' | 'condition' | 'notes' | 'operator'>
export type TicketInput = Pick<MaintenanceTicket, 'vehicleId' | 'title' | 'description' | 'severity'> & { assignee?: string }
export type VehicleInput = Omit<Vehicle, 'id' | 'status'>
export interface FleetException {
  id: string
  vehicleId: string
  label: string
  detail: string
  type: 'Missing report' | 'Awaiting approval' | 'Returned report' | 'Safety alert' | 'Open maintenance'
  priority: 'High' | 'Medium' | 'Low'
  reportId?: string
  ticketId?: string
}

export const FLEET_STORAGE_KEY = 'fleetsync-operations-demo-v1'
export const DEPARTMENTS = ['Facilities', 'Housing', 'Mail Services', 'Geosciences', 'Athletics', 'Campus Services', 'IT Services']
export const ROLES: Role[] = ['Fleet Admin', 'Supervisor', 'Driver', 'Maintenance']
export const VEHICLE_KINDS: VehicleKind[] = ['Sedan', 'SUV', 'Pickup', 'Van', 'Box truck', 'Utility cart']
export const CONDITIONS: VehicleCondition[] = ['Good', 'Needs attention', 'Unsafe']
export const SEVERITIES: Severity[] = ['Low', 'Medium', 'High']
export const TICKET_STATUSES: TicketStatus[] = ['Open', 'Scheduled', 'Resolved']

export function currentPeriod(date = new Date()): string {
  return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0')
}
export function shiftPeriod(period: string, delta: number): string {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new Error('Invalid report month.')
  const [y, m] = period.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return currentPeriod(d)
}
export function displayPeriod(period: string): string {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return period
  const [y, m] = period.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}
function id(prefix: string): string {
  const random = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)
  return prefix + '-' + random
}
function stamp(): string { return new Date().toISOString() }
function event(actor: string, action: string, detail: string, vehicleId?: string, reportId?: string): AuditEntry {
  return { id: id('evt'), at: stamp(), actor, action, detail, vehicleId, reportId }
}
function cleanText(value: string, field: string, min = 1, max = 240): string {
  const text = String(value ?? '').trim()
  if (text.length < min || text.length > max) throw new Error(field + ' must be ' + min + '–' + max + ' characters.')
  return text
}
function finiteNonnegative(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0) throw new Error(field + ' must be a nonnegative number.')
  return value
}

function seedVehicle(id: string, unit: string, department: string, year: number, make: string, model: string, kind: VehicleKind, plate: string, licensed: boolean, odometer: number, custodian: string): Vehicle {
  return { id, unit, department, year, make, model, kind, plate, licensed, odometer, custodian, status: 'Active' }
}

/** Repeatable fictional sample; these are not actual university vehicle records. */
export function createDemoFleet(period = currentPeriod()): FleetState {
  const vehicles: Vehicle[] = [
    seedVehicle('v001', 'UTD-0148', 'Facilities', 2018, 'Ford', 'F-150', 'Pickup', 'TX-DEM148', true, 68430, 'Morgan Chen'),
    seedVehicle('v002', 'UTD-0310', 'Mail Services', 2021, 'Ford', 'Transit 250', 'Van', 'TX-DEM310', true, 32910, 'Jordan Ellis'),
    seedVehicle('v003', 'UTD-0271', 'Geosciences', 2019, 'Toyota', 'Tacoma', 'Pickup', 'TX-DEM271', true, 57040, 'Avery Wells'),
    seedVehicle('v004', 'UTD-0477', 'Housing', 2022, 'Chevrolet', 'Equinox', 'SUV', 'TX-DEM477', true, 23100, 'Sam Patel'),
    seedVehicle('v005', 'UTD-0194', 'Mail Services', 2017, 'Isuzu', 'NPR', 'Box truck', 'TX-DEM194', true, 84200, 'Jordan Ellis'),
    seedVehicle('v006', 'UTD-0220', 'Facilities', 2016, 'Chevrolet', 'Silverado', 'Pickup', 'TX-DEM220', true, 111900, 'Morgan Chen'),
    seedVehicle('v007', 'UTD-0336', 'Athletics', 2020, 'Ford', 'Transit Connect', 'Van', 'TX-DEM336', true, 45110, 'Taylor Brooks'),
    seedVehicle('v008', 'UTD-0472', 'Campus Services', 2023, 'Toyota', 'Corolla', 'Sedan', 'TX-DEM472', true, 18420, 'Drew Carter'),
    seedVehicle('v009', 'UTD-0408', 'IT Services', 2021, 'Ram', 'ProMaster City', 'Van', 'TX-DEM408', true, 36610, 'Casey Nguyen'),
    seedVehicle('v010', 'UTD-0038', 'Geosciences', 2015, 'Ford', 'Expedition', 'SUV', 'TX-DEM038', true, 137260, 'Avery Wells'),
    seedVehicle('v011', 'UTD-0104', 'Housing', 2021, 'Club Car', 'Carryall 500', 'Utility cart', 'CART-104', false, 1360, 'Sam Patel'),
    seedVehicle('v012', 'UTD-0082', 'Facilities', 2022, 'E-Z-GO', 'Hauler 800', 'Utility cart', 'CART-082', false, 850, 'Morgan Chen'),
    seedVehicle('v013', 'UTD-0029', 'Athletics', 2019, 'Club Car', 'Tempo', 'Utility cart', 'CART-029', false, 2020, 'Taylor Brooks'),
    seedVehicle('v014', 'UTD-0060', 'Campus Services', 2024, 'E-Z-GO', 'Express', 'Utility cart', 'CART-060', false, 390, 'Drew Carter'),
    seedVehicle('v015', 'UTD-0112', 'Facilities', 2020, 'Ford', 'Ranger', 'Pickup', 'TX-DEM112', true, 48210, 'Morgan Chen'),
    seedVehicle('v016', 'UTD-0342', 'Housing', 2021, 'Nissan', 'NV200', 'Van', 'TX-DEM342', true, 41310, 'Sam Patel'),
  ]
  const statuses: ReportStatus[] = ['Approved', 'Pending', 'Approved', 'Pending', 'Returned', 'Approved', 'Pending', 'Approved', 'Pending', 'Pending', 'Approved']
  const reportVehicles = vehicles.filter(v => v.id !== 'v006' && v.id !== 'v010' && v.id !== 'v016' && v.id !== 'v013' && v.id !== 'v014')
  const reports: MonthlyReport[] = reportVehicles.map((vehicle, index) => {
    const attention = vehicle.id === 'v002' || vehicle.id === 'v005'
    return {
      id: 'r' + String(index + 1).padStart(3, '0'), vehicleId: vehicle.id,
      period, startOdometer: vehicle.odometer - (vehicle.licensed ? 210 + index * 17 : 15 + index),
      endOdometer: vehicle.odometer, fuelGallons: vehicle.licensed ? 15 + index * 1.3 : 0,
      fuelCost: vehicle.licensed ? Math.round((43 + index * 5.8) * 100) / 100 : 0,
      condition: attention ? 'Needs attention' : 'Good',
      notes: attention ? (vehicle.id === 'v002' ? 'Intermittent starting issue after overnight parking.' : 'Rear tire vibration at highway speed.') : '',
      operator: ['Jordan Ellis', 'Avery Wells', 'Morgan Chen', 'Sam Patel'][index % 4],
      submittedAt: new Date(Date.now() - (1 + index) * 86400000).toISOString(),
      status: statuses[index % statuses.length], reviewedBy: statuses[index % statuses.length] === 'Pending' ? undefined : 'Department Supervisor',
      reviewedAt: statuses[index % statuses.length] === 'Pending' ? undefined : new Date(Date.now() - index * 86400000).toISOString(),
      reviewNote: statuses[index % statuses.length] === 'Returned' ? 'Please confirm the final odometer reading.' : undefined,
      revision: 1,
    }
  })
  const tickets: MaintenanceTicket[] = [
    { id: 't001', vehicleId: 'v002', title: 'Intermittent starting issue', description: 'Driver reports occasional slow starts after overnight parking.', severity: 'Medium', status: 'Open', createdAt: stamp(), updatedAt: stamp(), sourceReportId: reports.find(r => r.vehicleId === 'v002')?.id, assignee: 'Garage team' },
    { id: 't002', vehicleId: 'v005', title: 'Rear tire vibration', description: 'Inspect tire balance and wear before next highway route.', severity: 'High', status: 'Scheduled', createdAt: stamp(), updatedAt: stamp(), sourceReportId: reports.find(r => r.vehicleId === 'v005')?.id, assignee: 'Service contractor' },
    { id: 't003', vehicleId: 'v006', title: 'Oil change overdue', description: 'Schedule preventive service and review prior maintenance history.', severity: 'Low', status: 'Open', createdAt: stamp(), updatedAt: stamp() },
  ]
  const audit: AuditEntry[] = [
    { id: 'evt-demo-1', at: stamp(), actor: 'Demo system', action: 'Demo initialized', detail: 'Fictional campus vehicle records loaded.' },
  ]
  return { schemaVersion: 1, vehicles, reports, tickets, audit }
}

export function loadFleetState(storage: Pick<Storage, 'getItem'> | null = typeof localStorage !== 'undefined' ? localStorage : null): FleetState {
  if (!storage) return createDemoFleet()
  try {
    const raw = storage.getItem(FLEET_STORAGE_KEY)
    if (!raw) return createDemoFleet()
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return createDemoFleet()
    const value = parsed as Partial<FleetState>
    if (value.schemaVersion !== 1 || !Array.isArray(value.vehicles) || !Array.isArray(value.reports) || !Array.isArray(value.tickets) || !Array.isArray(value.audit)) return createDemoFleet()
    return value as FleetState
  } catch { return createDemoFleet() }
}
export function saveFleetState(state: FleetState, storage: Pick<Storage, 'setItem'> | null = typeof localStorage !== 'undefined' ? localStorage : null): void {
  if (!storage) return
  storage.setItem(FLEET_STORAGE_KEY, JSON.stringify(state))
}
export function activeReportFor(state: FleetState, vehicleId: string, period: string): MonthlyReport | undefined {
  return state.reports.find(r => r.vehicleId === vehicleId && r.period === period)
}

export function submitMonthlyReport(state: FleetState, input: ReportInput): FleetState {
  const vehicle = state.vehicles.find(v => v.id === input.vehicleId)
  if (!vehicle || vehicle.status === 'Retired') throw new Error('Choose an active vehicle.')
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.period)) throw new Error('Choose a valid reporting month.')
  if (input.period > currentPeriod()) throw new Error('Future reporting months cannot be submitted.')
  const operator = cleanText(input.operator, 'Operator name', 2, 80)
  const notes = cleanText(input.notes ?? '', 'Notes', 0, 1200)
  const start = finiteNonnegative(Number(input.startOdometer), 'Starting odometer')
  const end = finiteNonnegative(Number(input.endOdometer), 'Ending odometer')
  const gallons = finiteNonnegative(Number(input.fuelGallons), 'Fuel quantity')
  const cost = finiteNonnegative(Number(input.fuelCost), 'Fuel cost')
  if (!Number.isInteger(start) || !Number.isInteger(end)) throw new Error('Odometer readings must be whole numbers.')
  if (end < start) throw new Error('Ending odometer must be at least the starting reading.')
  if (input.condition !== 'Good' && !notes) throw new Error('Describe any condition requiring attention.')
  if (!CONDITIONS.includes(input.condition)) throw new Error('Choose a valid vehicle condition.')
  const prior = state.reports.find(r => r.vehicleId === vehicle.id && r.period === input.period)
  if (prior && prior.status !== 'Returned') throw new Error('A report already exists for this vehicle and month.')
  const approvedEarlier = state.reports.filter(r => r.vehicleId === vehicle.id && r.period < input.period && r.status === 'Approved')
  const latestEarlier = approvedEarlier.sort((a, b) => b.period.localeCompare(a.period))[0]
  if (latestEarlier && end < latestEarlier.endOdometer) throw new Error('Ending reading is below a previously approved month. Confirm the odometer.')
  const reportId = prior?.id ?? id('r')
  const report: MonthlyReport = {
    ...input, operator, notes, startOdometer: start, endOdometer: end,
    fuelGallons: gallons, fuelCost: cost, id: reportId, submittedAt: stamp(),
    status: 'Pending', reviewedAt: undefined, reviewedBy: undefined, reviewNote: undefined,
    revision: (prior?.revision ?? 0) + 1,
  }
  const reports = prior ? state.reports.map(r => r.id === prior.id ? report : r) : [report, ...state.reports]
  const existingTicket = state.tickets.find(t => t.sourceReportId === reportId && t.status !== 'Resolved')
  const escalateTicket = input.condition === 'Unsafe' && existingTicket && existingTicket.severity !== 'High'
  const needsTicket = input.condition !== 'Good' && !existingTicket
  const ticket: MaintenanceTicket | null = needsTicket ? {
    id: id('t'), vehicleId: vehicle.id, title: input.condition === 'Unsafe' ? 'Safety-critical condition reported' : 'Vehicle condition follow-up',
    description: notes, severity: input.condition === 'Unsafe' ? 'High' : 'Medium',
    status: 'Open', createdAt: stamp(), updatedAt: stamp(), sourceReportId: reportId,
  } : null
  return {
    ...state, reports,
    tickets: ticket
      ? [ticket, ...state.tickets]
      : escalateTicket
        ? state.tickets.map(t => t.id === existingTicket.id
          ? { ...t, severity: 'High' as Severity, status: 'Open' as TicketStatus, title: 'Safety-critical condition reported', description: notes, updatedAt: stamp() }
          : t)
        : state.tickets,
    audit: [
      event(operator, prior ? 'Report resubmitted' : 'Report submitted', vehicle.unit + ' · ' + input.period, vehicle.id, reportId),
      ...(ticket ? [event('FleetSync', 'Maintenance issue raised', vehicle.unit + ' · ' + input.condition, vehicle.id, reportId)] : []),
      ...(escalateTicket ? [event('FleetSync', 'Maintenance escalated', vehicle.unit + ' · unsafe condition reported', vehicle.id, reportId)] : []),
      ...state.audit,
    ],
  }
}

export function reviewMonthlyReport(state: FleetState, reportId: string, decision: 'Approved' | 'Returned', reviewer: string, note = ''): FleetState {
  const report = state.reports.find(r => r.id === reportId)
  if (!report || report.status !== 'Pending') throw new Error('Only pending reports may be reviewed.')
  const actor = cleanText(reviewer, 'Reviewer', 2, 80)
  const reason = cleanText(note, 'Review note', decision === 'Returned' ? 3 : 0, 400)
  const vehicle = state.vehicles.find(v => v.id === report.vehicleId)
  const updated: MonthlyReport = { ...report, status: decision, reviewedBy: actor, reviewedAt: stamp(), reviewNote: reason }
  return {
    ...state,
    reports: state.reports.map(r => r.id === reportId ? updated : r),
    vehicles: decision === 'Approved'
      ? state.vehicles.map(v => v.id === report.vehicleId && report.endOdometer > v.odometer ? { ...v, odometer: report.endOdometer } : v)
      : state.vehicles,
    audit: [event(actor, 'Report ' + decision.toLowerCase(), (vehicle?.unit ?? report.vehicleId) + ' · ' + report.period + (reason ? ' · ' + reason : ''), report.vehicleId, report.id), ...state.audit],
  }
}

export function addMaintenanceTicket(state: FleetState, input: TicketInput, actor = 'Fleet Admin'): FleetState {
  const vehicle = state.vehicles.find(v => v.id === input.vehicleId)
  if (!vehicle) throw new Error('Choose a vehicle.')
  if (!SEVERITIES.includes(input.severity)) throw new Error('Choose a valid priority.')
  const title = cleanText(input.title, 'Issue title', 3, 100)
  const description = cleanText(input.description, 'Issue description', 5, 1200)
  const ticket: MaintenanceTicket = {
    id: id('t'), vehicleId: vehicle.id, title, description, severity: input.severity,
    status: 'Open', createdAt: stamp(), updatedAt: stamp(),
    assignee: (input.assignee ?? '').trim() || undefined,
  }
  return { ...state, tickets: [ticket, ...state.tickets], audit: [event(actor, 'Maintenance issue created', vehicle.unit + ' · ' + title, vehicle.id), ...state.audit] }
}

export function updateMaintenanceTicket(state: FleetState, ticketId: string, status: TicketStatus, actor = 'Maintenance'): FleetState {
  const ticket = state.tickets.find(t => t.id === ticketId)
  if (!ticket) throw new Error('Maintenance issue not found.')
  if (!TICKET_STATUSES.includes(status)) throw new Error('Invalid maintenance status.')
  if (ticket.status === status) return state
  const vehicle = state.vehicles.find(v => v.id === ticket.vehicleId)
  return {
    ...state,
    tickets: state.tickets.map(t => t.id === ticketId ? { ...t, status, updatedAt: stamp() } : t),
    audit: [event(actor, 'Maintenance ' + status.toLowerCase(), (vehicle?.unit ?? ticket.vehicleId) + ' · ' + ticket.title, ticket.vehicleId), ...state.audit],
  }
}

export function addVehicle(state: FleetState, input: VehicleInput, actor = 'Fleet Admin'): FleetState {
  const unit = cleanText(input.unit, 'Unit ID', 3, 40)
  if (state.vehicles.some(v => v.unit.toLowerCase() === unit.toLowerCase())) throw new Error('This unit ID is already in use.')
  const department = cleanText(input.department, 'Department', 2, 80)
  const make = cleanText(input.make, 'Make', 2, 80)
  const model = cleanText(input.model, 'Model', 1, 80)
  const custodian = cleanText(input.custodian, 'Custodian', 2, 80)
  const plate = cleanText(input.plate, 'Plate / asset tag', 2, 30)
  if (!VEHICLE_KINDS.includes(input.kind)) throw new Error('Choose a vehicle type.')
  if (!Number.isInteger(input.year) || input.year < 1990 || input.year > new Date().getFullYear() + 1) throw new Error('Enter a valid model year.')
  if (!Number.isInteger(input.odometer) || input.odometer < 0) throw new Error('Odometer must be a nonnegative whole number.')
  const vehicle: Vehicle = { ...input, id: id('v'), unit, department, make, model, custodian, plate, status: 'Active' }
  return { ...state, vehicles: [...state.vehicles, vehicle], audit: [event(actor, 'Vehicle added', unit + ' · ' + make + ' ' + model, vehicle.id), ...state.audit] }
}

export function getExceptions(state: FleetState, period: string, department = 'All departments'): FleetException[] {
  const exceptions: FleetException[] = []
  for (const vehicle of state.vehicles) {
    if (vehicle.status === 'Retired' || (department !== 'All departments' && vehicle.department !== department)) continue
    const report = activeReportFor(state, vehicle.id, period)
    if (!report) {
      exceptions.push({ id: 'missing:' + vehicle.id, vehicleId: vehicle.id, label: vehicle.unit, detail: vehicle.department + ' has not submitted ' + displayPeriod(period), type: 'Missing report', priority: 'Medium' })
    } else if (report.status === 'Pending') {
      exceptions.push({ id: 'pending:' + report.id, vehicleId: vehicle.id, reportId: report.id, label: vehicle.unit, detail: vehicle.department + ' · awaiting supervisor signoff', type: 'Awaiting approval', priority: 'Low' })
    } else if (report.status === 'Returned') {
      exceptions.push({ id: 'returned:' + report.id, vehicleId: vehicle.id, reportId: report.id, label: vehicle.unit, detail: report.reviewNote || 'Report returned for correction', type: 'Returned report', priority: 'High' })
    }
    if (report?.condition === 'Unsafe') {
      exceptions.push({ id: 'unsafe:' + report.id, vehicleId: vehicle.id, reportId: report.id, label: vehicle.unit, detail: report.notes || 'Unsafe condition noted', type: 'Safety alert', priority: 'High' })
    }
  }
  for (const ticket of state.tickets) {
    if (ticket.status === 'Resolved') continue
    const vehicle = state.vehicles.find(v => v.id === ticket.vehicleId)
    if (!vehicle || (department !== 'All departments' && vehicle.department !== department)) continue
    exceptions.push({
      id: 'ticket:' + ticket.id, vehicleId: vehicle.id, ticketId: ticket.id,
      label: vehicle.unit, detail: ticket.title + ' · ' + ticket.status,
      type: 'Open maintenance', priority: ticket.severity,
    })
  }
  const rank = { High: 0, Medium: 1, Low: 2 }
  return exceptions.sort((a, b) => rank[a.priority] - rank[b.priority] || a.label.localeCompare(b.label))
}

export function fleetMetrics(state: FleetState, period: string, department = 'All departments') {
  const vehicles = state.vehicles.filter(v => v.status !== 'Retired' && (department === 'All departments' || v.department === department))
  const ids = new Set(vehicles.map(v => v.id))
  const reports = state.reports.filter(r => r.period === period && ids.has(r.vehicleId))
  const tickets = state.tickets.filter(t => t.status !== 'Resolved' && ids.has(t.vehicleId))
  return {
    vehicles: vehicles.length, licensed: vehicles.filter(v => v.licensed).length,
    reported: reports.length, pending: reports.filter(r => r.status === 'Pending').length,
    approved: reports.filter(r => r.status === 'Approved').length,
    returned: reports.filter(r => r.status === 'Returned').length,
    missing: vehicles.length - reports.length, tickets: tickets.length,
    completion: vehicles.length ? Math.round(100 * reports.length / vehicles.length) : 100,
    miles: reports.filter(r => r.status === 'Approved').reduce((sum, r) => sum + (r.endOdometer - r.startOdometer), 0),
    fuelCost: reports.filter(r => r.status === 'Approved').reduce((sum, r) => sum + r.fuelCost, 0),
  }
}

const CSV_COLUMNS = [
  'Unit ID', 'Department', 'Vehicle type', 'License / asset tag', 'Reporting month',
  'Starting odometer', 'Ending odometer', 'Distance reported', 'Fuel gallons', 'Fuel cost USD',
  'Vehicle condition', 'Operator', 'Submitted UTC', 'Supervisor', 'Approved UTC',
]

function safeCsvCell(value: string | number | undefined): string {
  const raw = String(value ?? '')
  // Escape spreadsheets interpreting untrusted cell values as formulas.
  const guarded = /^[\s]*[=+@\-\t\r]/.test(raw) && !/^-\d+(?:\.\d+)?$/.test(raw) ? "'" + raw : raw
  return '"' + guarded.replace(/"/g, '""') + '"'
}

/** Review-ready staging CSV. NOT a Comptroller-certified TxFS batching layout. */
export function buildReviewCsv(state: FleetState, period: string, department = 'All departments'): { csv: string; count: number } {
  const records = state.reports.filter(r => {
    const vehicle = state.vehicles.find(v => v.id === r.vehicleId)
    return r.period === period && r.status === 'Approved' && vehicle?.licensed && (department === 'All departments' || vehicle?.department === department)
  })
  const rows = records.map(r => {
    const v = state.vehicles.find(vehicle => vehicle.id === r.vehicleId)!
    return [v.unit, v.department, v.kind, v.plate, r.period, r.startOdometer, r.endOdometer,
      r.endOdometer - r.startOdometer, r.fuelGallons, r.fuelCost.toFixed(2),
      r.condition, r.operator, r.submittedAt, r.reviewedBy, r.reviewedAt]
  })
  return { csv: [CSV_COLUMNS, ...rows].map(row => row.map(safeCsvCell).join(',')).join('\r\n') + '\r\n', count: rows.length }
}
