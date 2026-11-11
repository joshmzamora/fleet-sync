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
  notes?: string
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
  scheduledFor?: string
  resolutionNote?: string
  resolvedAt?: string
  actualCost?: number
}
export interface DepartmentProfile {
  name: string
  coordinator: string
  contact: string
  monthlyDueDay: number
  notes: string
}
export interface FollowUp {
  id: string
  vehicleId: string
  period: string
  actor: string
  note: string
  at: string
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
  departmentProfiles: DepartmentProfile[]
  followUps: FollowUp[]
}

export type ReportInput = Pick<MonthlyReport, 'vehicleId' | 'period' | 'startOdometer' | 'endOdometer' | 'fuelGallons' | 'fuelCost' | 'condition' | 'notes' | 'operator'>
export type TicketInput = Pick<MaintenanceTicket, 'vehicleId' | 'title' | 'description' | 'severity'> & { assignee?: string }
export type VehicleInput = Omit<Vehicle, 'id' | 'status'>
export interface FleetException {
  id: string
  vehicleId: string
  label: string
  detail: string
  type: 'Missing report' | 'Overdue report' | 'Awaiting approval' | 'Overdue approval' | 'Returned report' | 'Safety alert' | 'Service hold' | 'Open maintenance' | 'Overdue maintenance'
  priority: 'High' | 'Medium' | 'Low'
  reportId?: string
  ticketId?: string
  owner?: string
  dueDate?: string
  daysOverdue?: number
  lastFollowUpAt?: string
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
function parsePeriod(period: string): [number, number] {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new Error('Choose a valid reporting month.')
  const [year, month] = period.split('-').map(Number)
  return [year, month]
}
function localDay(date: Date): string {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-')
}
function daysAfter(date: string, now = new Date()): number {
  const [year, month, day] = date.split('-').map(Number)
  const midnight = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.floor((midnight - Date.UTC(year, month - 1, day)) / 86400000)
}

/** Institution-specific demo policy, default fifth of the following month. */
export function reportDueDate(period: string, dueDay = 5): string {
  const [year, month] = parsePeriod(period)
  if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 28) throw new Error('The monthly due day must be from 1 to 28.')
  return localDay(new Date(year, month, dueDay))
}

function defaultDepartmentProfile(name: string, vehicles: Vehicle[] = []): DepartmentProfile {
  const custodian = vehicles.find(v => v.department === name)?.custodian
  return {
    name,
    coordinator: custodian ?? 'Unassigned coordinator',
    contact: '',
    monthlyDueDay: 5,
    notes: 'Sample reporting policy. Confirm deadlines with the institution.',
  }
}
/** Converts original v1 browser data without discarding user-created records. */
function migrateFleetState(state: FleetState): FleetState {
  const names = new Set([...DEPARTMENTS, ...state.vehicles.map(v => v.department)])
  const existing = Array.isArray(state.departmentProfiles) ? state.departmentProfiles : []
  const departmentProfiles = [...names].sort().map(name => {
    const profile = existing.find(p => p && p.name === name)
    return profile
      ? {
        ...defaultDepartmentProfile(name, state.vehicles),
        ...profile,
        name,
        monthlyDueDay: Number.isInteger(profile.monthlyDueDay) && profile.monthlyDueDay >= 1 && profile.monthlyDueDay <= 28 ? profile.monthlyDueDay : 5,
      }
      : defaultDepartmentProfile(name, state.vehicles)
  })
  return {
    ...state,
    departmentProfiles,
    followUps: Array.isArray(state.followUps) ? state.followUps : [],
  }
}
export function getDepartmentProfile(state: FleetState, name: string): DepartmentProfile {
  return state.departmentProfiles?.find(p => p.name === name) ?? defaultDepartmentProfile(name, state.vehicles)
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
  // Prior-month examples make fiscal-quarter reconciliation and trend views
  // useful immediately; these are explicitly fictional.
  const historicalReports: MonthlyReport[] = []
  vehicles.filter(v => v.licensed).forEach((vehicle, index) => {
    for (const monthsBack of [1, 2]) {
      if ((monthsBack === 1 && index % 7 === 6) || (monthsBack === 2 && index % 3 === 2)) continue
      const end = Math.max(0, vehicle.odometer - (monthsBack === 1 ? 640 : 970))
      const month = shiftPeriod(period, -monthsBack)
      const status: ReportStatus = monthsBack === 1 && index === 3 ? 'Returned' : monthsBack === 1 && index === 5 ? 'Pending' : 'Approved'
      historicalReports.push({
        id: 'hist-' + vehicle.id + '-' + monthsBack,
        vehicleId: vehicle.id, period: month,
        startOdometer: Math.max(0, end - (115 + index * 9)),
        endOdometer: end,
        fuelGallons: 8 + index * 0.65,
        fuelCost: Math.round((27 + index * 2.7) * 100) / 100,
        condition: 'Good', notes: '', operator: vehicle.custodian,
        submittedAt: new Date(Date.now() - (monthsBack * 30 + 4) * 86400000).toISOString(),
        status,
        reviewedBy: status === 'Pending' ? undefined : 'Department Supervisor',
        reviewedAt: status === 'Pending' ? undefined : new Date(Date.now() - (monthsBack * 30 + 2) * 86400000).toISOString(),
        reviewNote: status === 'Returned' ? 'Clarify fuel receipt total.' : undefined,
        revision: 1,
      })
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
  return migrateFleetState({ schemaVersion: 1, vehicles, reports: [...reports, ...historicalReports], tickets, audit, departmentProfiles: [], followUps: [] })
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
    return migrateFleetState(value as FleetState)
  } catch { return createDemoFleet() }
}
export function saveFleetState(state: FleetState, storage: Pick<Storage, 'setItem'> | null = typeof localStorage !== 'undefined' ? localStorage : null): void {
  if (!storage) return
  storage.setItem(FLEET_STORAGE_KEY, JSON.stringify(state))
}
export function activeReportFor(state: FleetState, vehicleId: string, period: string): MonthlyReport | undefined {
  return state.reports.find(r => r.vehicleId === vehicleId && r.period === period)
}
export function getOdometerWarnings(state: FleetState, vehicleId: string, period: string, start: number, end: number): string[] {
  const earlier = state.reports
    .filter(r => r.vehicleId === vehicleId && r.period < period && r.status === 'Approved')
    .sort((a, b) => b.period.localeCompare(a.period))[0]
  const warnings: string[] = []
  if (earlier && Number.isFinite(start) && start > earlier.endOdometer) {
    warnings.push('Starting odometer is ' + (start - earlier.endOdometer).toLocaleString('en-US') + ' miles above the last approved month (' + earlier.period + '). Check for a missing reporting period.')
  }
  if (Number.isFinite(start) && Number.isFinite(end) && end - start > 4000) {
    warnings.push('More than 4,000 miles were recorded for one month. Verify the readings and explain the difference in notes.')
  }
  return warnings
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
  if (latestEarlier && start < latestEarlier.endOdometer) throw new Error('Starting odometer overlaps the previous approved reading for ' + latestEarlier.period + '.')
  const firstLater = state.reports.filter(r => r.vehicleId === vehicle.id && r.period > input.period && r.status === 'Approved').sort((a, b) => a.period.localeCompare(b.period))[0]
  if (firstLater && end > firstLater.startOdometer) throw new Error('Ending odometer exceeds the next approved month (' + firstLater.period + ').')
  if (end - start > 4000 && notes.length < 15) throw new Error('Explain unusually high monthly mileage in at least 15 characters of notes.')
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
    vehicles: input.condition === 'Unsafe'
      ? state.vehicles.map(v => v.id === vehicle.id && v.status !== 'Retired' ? { ...v, status: 'In maintenance' as VehicleStatus } : v)
      : state.vehicles,
    audit: [
      event(operator, prior ? 'Report resubmitted' : 'Report submitted', vehicle.unit + ' · ' + input.period, vehicle.id, reportId),
      ...(ticket ? [event('FleetSync', 'Maintenance issue raised', vehicle.unit + ' · ' + input.condition, vehicle.id, reportId)] : []),
      ...(escalateTicket ? [event('FleetSync', 'Maintenance escalated', vehicle.unit + ' · unsafe condition reported', vehicle.id, reportId)] : []),
      ...(input.condition === 'Unsafe' && vehicle.status !== 'In maintenance' ? [event('FleetSync', 'Service hold applied', vehicle.unit + ' · unsafe driver condition', vehicle.id, reportId)] : []),
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
  // Two months can be pending simultaneously. Validate against the currently
  // approved chronology at approval time as well as at initial submission.
  if (decision === 'Approved') {
    const earlier = state.reports.filter(r => r.vehicleId === report.vehicleId && r.period < report.period && r.status === 'Approved')
      .sort((a, b) => b.period.localeCompare(a.period))[0]
    const later = state.reports.filter(r => r.vehicleId === report.vehicleId && r.period > report.period && r.status === 'Approved')
      .sort((a, b) => a.period.localeCompare(b.period))[0]
    if (earlier && report.startOdometer < earlier.endOdometer) {
      throw new Error('This report overlaps the now-approved earlier month (' + earlier.period + '). Return it for correction.')
    }
    if (later && report.endOdometer > later.startOdometer) {
      throw new Error('This report overlaps the now-approved later month (' + later.period + '). Return it for correction.')
    }
  }
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

export interface MaintenanceUpdate {
  assignee?: string
  scheduledFor?: string
  resolutionNote?: string
  actualCost?: number
}
export function updateMaintenanceTicket(state: FleetState, ticketId: string, status: TicketStatus, actor = 'Maintenance', details: MaintenanceUpdate = {}): FleetState {
  const ticket = state.tickets.find(t => t.id === ticketId)
  if (!ticket) throw new Error('Maintenance issue not found.')
  if (!TICKET_STATUSES.includes(status)) throw new Error('Invalid maintenance status.')
  const assignee = details.assignee === undefined ? ticket.assignee : cleanText(details.assignee, 'Assigned technician', 0, 80) || undefined
  const scheduledFor = details.scheduledFor === undefined ? ticket.scheduledFor : cleanText(details.scheduledFor, 'Scheduled date', 0, 10) || undefined
  if (scheduledFor) {
    const parsed = new Date(scheduledFor + 'T12:00:00')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduledFor) || Number.isNaN(parsed.getTime()) || localDay(parsed) !== scheduledFor) {
      throw new Error('Enter a valid service date.')
    }
  }
  const resolutionNote = details.resolutionNote === undefined ? ticket.resolutionNote : cleanText(details.resolutionNote, 'Resolution note', 0, 1000) || undefined
  const actualCost = details.actualCost === undefined ? ticket.actualCost : finiteNonnegative(details.actualCost, 'Service cost')
  if (status === 'Resolved' && !resolutionNote?.trim()) throw new Error('Describe the repair or follow-up before resolving the issue.')
  const updated: MaintenanceTicket = {
    ...ticket, status, assignee, scheduledFor, resolutionNote, actualCost,
    resolvedAt: status === 'Resolved' ? (ticket.resolvedAt ?? stamp()) : undefined,
    updatedAt: stamp(),
  }
  if (ticket.status === status && ticket.assignee === updated.assignee && ticket.scheduledFor === updated.scheduledFor &&
      ticket.resolutionNote === updated.resolutionNote && ticket.actualCost === updated.actualCost) return state
  const vehicle = state.vehicles.find(v => v.id === ticket.vehicleId)
  return {
    ...state,
    tickets: state.tickets.map(t => t.id === ticketId ? updated : t),
    audit: [event(actor, ticket.status === status ? 'Maintenance details updated' : 'Maintenance ' + status.toLowerCase(), (vehicle?.unit ?? ticket.vehicleId) + ' · ' + ticket.title + (resolutionNote && status === 'Resolved' ? ' · ' + resolutionNote : ''), ticket.vehicleId), ...state.audit],
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
  if (state.vehicles.some(v => v.plate.toLowerCase() === plate.toLowerCase())) throw new Error('This license plate or asset tag is already assigned to a vehicle.')
  if (!VEHICLE_KINDS.includes(input.kind)) throw new Error('Choose a vehicle type.')
  if (!Number.isInteger(input.year) || input.year < 1990 || input.year > new Date().getFullYear() + 1) throw new Error('Enter a valid model year.')
  if (!Number.isInteger(input.odometer) || input.odometer < 0) throw new Error('Odometer must be a nonnegative whole number.')
  const notes = cleanText(input.notes ?? '', 'Vehicle notes', 0, 600)
  const vehicle: Vehicle = { ...input, id: id('v'), unit, department, make, model, custodian, plate, notes, status: 'Active' }
  const withVehicle = { ...state, vehicles: [...state.vehicles, vehicle], audit: [event(actor, 'Vehicle added', unit + ' · ' + make + ' ' + model, vehicle.id), ...state.audit] }
  return migrateFleetState(withVehicle)
}

export function updateDepartmentProfile(state: FleetState, name: string, input: Omit<DepartmentProfile, 'name'>, actor = 'Demo Fleet Admin'): FleetState {
  if (!state.vehicles.some(v => v.department === name) && !DEPARTMENTS.includes(name)) throw new Error('Department not found.')
  if (!Number.isInteger(input.monthlyDueDay) || input.monthlyDueDay < 1 || input.monthlyDueDay > 28) throw new Error('Choose a monthly due day from 1 to 28.')
  const profile: DepartmentProfile = {
    name,
    coordinator: cleanText(input.coordinator, 'Coordinator', 2, 80),
    contact: cleanText(input.contact, 'Contact', 0, 100),
    monthlyDueDay: input.monthlyDueDay,
    notes: cleanText(input.notes, 'Department notes', 0, 600),
  }
  const baseline = migrateFleetState(state)
  const old = getDepartmentProfile(baseline, name)
  if (JSON.stringify(profile) === JSON.stringify(old)) return state
  return {
    ...baseline, departmentProfiles: baseline.departmentProfiles.map(p => p.name === name ? profile : p),
    audit: [event(actor, 'Department policy updated', name + ' · coordinator ' + profile.coordinator + ' · monthly due day ' + profile.monthlyDueDay), ...state.audit],
  }
}

/** Logs an internal follow-up; sends no email, SMS or external notification. */
export function recordReportFollowUp(state: FleetState, vehicleId: string, period: string, actor: string, note: string): FleetState {
  const vehicle = state.vehicles.find(v => v.id === vehicleId)
  if (!vehicle) throw new Error('Vehicle not found.')
  parsePeriod(period)
  const by = cleanText(actor, 'Recorded by', 2, 80)
  const reason = cleanText(note, 'Follow-up note', 5, 400)
  const followUp: FollowUp = { id: id('followup'), vehicleId, period, actor: by, note: reason, at: stamp() }
  return {
    ...state,
    followUps: [followUp, ...(state.followUps ?? [])],
    audit: [event(by, 'Follow-up logged (not sent)', vehicle.unit + ' · ' + period + ' · ' + reason, vehicleId), ...state.audit],
  }
}
/** Audits that a local review worksheet was prepared; makes no state submission claim. */
export function recordExportPreparation(state: FleetState, scope: 'Monthly' | 'Quarterly', label: string, recordCount: number, actor = 'Demo Fleet Admin'): FleetState {
  if (scope !== 'Monthly' && scope !== 'Quarterly') throw new Error('Invalid review export scope.')
  if (!Number.isInteger(recordCount) || recordCount < 0) throw new Error('Invalid export record count.')
  const description = cleanText(label, 'Export label', 3, 80)
  const by = cleanText(actor, 'Prepared by', 2, 80)
  return {
    ...state,
    audit: [event(by, scope + ' review CSV prepared (local only)', description + ' · ' + recordCount + ' review row(s), not a TxFS submission'), ...state.audit],
  }
}

export function updateVehicleRecord(state: FleetState, vehicleId: string, changes: Partial<VehicleInput>, actor = 'Demo Fleet Admin'): FleetState {
  const existing = state.vehicles.find(v => v.id === vehicleId)
  if (!existing) throw new Error('Vehicle not found.')
  const next: Vehicle = { ...existing, ...changes, id: existing.id, status: existing.status }
  next.unit = cleanText(next.unit, 'Unit ID', 3, 40)
  next.department = cleanText(next.department, 'Department', 2, 80)
  next.make = cleanText(next.make, 'Make', 2, 80)
  next.model = cleanText(next.model, 'Model', 1, 80)
  next.custodian = cleanText(next.custodian, 'Custodian', 2, 80)
  next.plate = cleanText(next.plate, 'Plate or asset tag', 2, 30)
  next.notes = cleanText(next.notes ?? '', 'Vehicle notes', 0, 600)
  if (!VEHICLE_KINDS.includes(next.kind)) throw new Error('Choose a valid vehicle type.')
  if (!Number.isInteger(next.year) || next.year < 1990 || next.year > new Date().getFullYear() + 1) throw new Error('Enter a valid model year.')
  if (!Number.isInteger(next.odometer) || next.odometer < 0) throw new Error('Odometer must be a nonnegative whole number.')
  if (state.vehicles.some(v => v.id !== existing.id && v.unit.toLowerCase() === next.unit.toLowerCase())) throw new Error('Unit ID already exists.')
  if (state.vehicles.some(v => v.id !== existing.id && v.plate.toLowerCase() === next.plate.toLowerCase())) throw new Error('License or asset tag already exists.')
  const maxApproved = Math.max(0, ...state.reports.filter(r => r.vehicleId === vehicleId && r.status === 'Approved').map(r => r.endOdometer))
  if (next.odometer < maxApproved) throw new Error('Vehicle odometer cannot be below an approved report reading.')
  if (JSON.stringify(existing) === JSON.stringify(next)) return state
  return migrateFleetState({
    ...state,
    vehicles: state.vehicles.map(v => v.id === vehicleId ? next : v),
    audit: [event(actor, 'Vehicle record updated', existing.unit + ' · ' + existing.department + ' → ' + next.department, vehicleId), ...state.audit],
  })
}

export function setVehicleStatus(state: FleetState, vehicleId: string, status: VehicleStatus, actor = 'Demo Fleet Admin', note = ''): FleetState {
  const vehicle = state.vehicles.find(v => v.id === vehicleId)
  if (!vehicle) throw new Error('Vehicle not found.')
  if (!(['Active', 'In maintenance', 'Retired'] as VehicleStatus[]).includes(status)) throw new Error('Invalid vehicle status.')
  if (vehicle.status === status) return state
  const reason = cleanText(note, 'Status change reason', 5, 400)
  if (status === 'Active' && state.tickets.some(t => t.vehicleId === vehicleId && t.status !== 'Resolved' && t.severity === 'High')) {
    throw new Error('Resolve high-priority service issues before releasing this vehicle to active service.')
  }
  return {
    ...state,
    vehicles: state.vehicles.map(v => v.id === vehicleId ? { ...v, status } : v),
    audit: [event(actor, 'Vehicle status changed', vehicle.unit + ' · ' + vehicle.status + ' → ' + status + ' · ' + reason, vehicleId), ...state.audit],
  }
}

export function getExceptions(state: FleetState, period: string, department = 'All departments', asOf = new Date()): FleetException[] {
  const exceptions: FleetException[] = []
  for (const vehicle of state.vehicles) {
    if (vehicle.status === 'Retired' || (department !== 'All departments' && vehicle.department !== department)) continue
    const report = activeReportFor(state, vehicle.id, period)
    const profile = getDepartmentProfile(state, vehicle.department)
    const dueDate = reportDueDate(period, profile.monthlyDueDay)
    const daysOverdue = Math.max(0, daysAfter(dueDate, asOf))
    const lastFollowUpAt = (state.followUps ?? []).filter(f => f.vehicleId === vehicle.id && f.period === period).sort((a, b) => b.at.localeCompare(a.at))[0]?.at
    const owner = profile.coordinator
    if (!report) {
      const overdue = daysOverdue > 0
      exceptions.push({
        id: 'missing:' + vehicle.id + ':' + period, vehicleId: vehicle.id, label: vehicle.unit,
        detail: vehicle.department + ' · ' + displayPeriod(period) + (overdue ? ' · ' + daysOverdue + ' day(s) late' : ' · due ' + dueDate),
        type: overdue ? 'Overdue report' : 'Missing report', priority: overdue ? 'High' : 'Medium',
        owner, dueDate, daysOverdue, lastFollowUpAt,
      })
    } else if (report.status === 'Pending') {
      exceptions.push({
        id: 'pending:' + report.id, vehicleId: vehicle.id, reportId: report.id, label: vehicle.unit,
        detail: vehicle.department + ' · awaiting supervisor approval' + (daysOverdue > 0 ? ' · ' + daysOverdue + ' day(s) past due' : ''),
        type: daysOverdue > 0 ? 'Overdue approval' : 'Awaiting approval',
        priority: daysOverdue > 0 ? 'High' : 'Low', owner, dueDate, daysOverdue,
      })
    } else if (report.status === 'Returned') {
      exceptions.push({ id: 'returned:' + report.id, vehicleId: vehicle.id, reportId: report.id, label: vehicle.unit, detail: report.reviewNote || 'Report returned for correction', type: 'Returned report', priority: 'High', owner, dueDate, daysOverdue, lastFollowUpAt })
    }
    if (report?.condition === 'Unsafe' && state.tickets.some(t => t.sourceReportId === report.id && t.status !== 'Resolved')) {
      exceptions.push({ id: 'unsafe:' + report.id, vehicleId: vehicle.id, reportId: report.id, label: vehicle.unit, detail: report.notes || 'Unsafe condition noted', type: 'Safety alert', priority: 'High', owner })
    }
    if (vehicle.status === 'In maintenance') {
      exceptions.push({ id: 'hold:' + vehicle.id, vehicleId: vehicle.id, label: vehicle.unit, detail: 'Vehicle is held out of service. Document a release after repair review.', type: 'Service hold', priority: 'High', owner })
    }
  }
  for (const ticket of state.tickets) {
    if (ticket.status === 'Resolved') continue
    const vehicle = state.vehicles.find(v => v.id === ticket.vehicleId)
    if (!vehicle || (department !== 'All departments' && vehicle.department !== department)) continue
    const serviceOverdue = !!ticket.scheduledFor && daysAfter(ticket.scheduledFor, asOf) > 0 && ticket.status === 'Scheduled'
    exceptions.push({
      id: 'ticket:' + ticket.id, vehicleId: vehicle.id, ticketId: ticket.id,
      label: vehicle.unit, detail: ticket.title + ' · ' + (serviceOverdue ? 'scheduled work overdue' : ticket.status) + (ticket.assignee ? ' · ' + ticket.assignee : ' · unassigned'),
      type: serviceOverdue ? 'Overdue maintenance' : 'Open maintenance',
      priority: serviceOverdue ? 'High' : ticket.severity,
      owner: ticket.assignee ?? 'Unassigned', dueDate: ticket.scheduledFor,
      daysOverdue: serviceOverdue ? daysAfter(ticket.scheduledFor!, asOf) : undefined,
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
    overdue: getExceptions(state, period, department).filter(e => e.type === 'Overdue report' || e.type === 'Overdue approval').length,
    serviceHolds: vehicles.filter(v => v.status === 'In maintenance').length,
  }
}

export interface DepartmentScorecardRow {
  name: string
  coordinator: string
  contact: string
  monthlyDueDay: number
  vehicles: number
  submitted: number
  approved: number
  pending: number
  returned: number
  missing: number
  overdue: number
  openTickets: number
  completion: number
}
export function getDepartmentScorecard(state: FleetState, period: string, asOf = new Date()): DepartmentScorecardRow[] {
  return migrateFleetState(state).departmentProfiles
    .map(profile => {
      const vehicles = state.vehicles.filter(v => v.department === profile.name && v.status !== 'Retired')
      const reports = vehicles.map(v => activeReportFor(state, v.id, period)).filter((r): r is MonthlyReport => Boolean(r))
      const ids = new Set(vehicles.map(v => v.id))
      const due = reportDueDate(period, profile.monthlyDueDay)
      const late = daysAfter(due, asOf) > 0
      return {
        name: profile.name, coordinator: profile.coordinator, contact: profile.contact, monthlyDueDay: profile.monthlyDueDay,
        vehicles: vehicles.length, submitted: reports.length,
        approved: reports.filter(r => r.status === 'Approved').length,
        pending: reports.filter(r => r.status === 'Pending').length,
        returned: reports.filter(r => r.status === 'Returned').length,
        missing: vehicles.length - reports.length,
        overdue: late ? vehicles.length - reports.filter(r => r.status === 'Approved').length : 0,
        openTickets: state.tickets.filter(t => ids.has(t.vehicleId) && t.status !== 'Resolved').length,
        completion: vehicles.length ? Math.round(100 * reports.filter(r => r.status === 'Approved').length / vehicles.length) : 100,
      }
    })
    .filter(row => row.vehicles > 0)
    .sort((a, b) => b.overdue - a.overdue || a.completion - b.completion || a.name.localeCompare(b.name))
}

export function monthlyTrends(state: FleetState, endPeriod: string, count = 4, department = 'All departments') {
  if (!Number.isInteger(count) || count < 1 || count > 12) throw new Error('Trend window must contain 1–12 months.')
  return Array.from({ length: count }, (_, index) => {
    const period = shiftPeriod(endPeriod, index - count + 1)
    const m = fleetMetrics(state, period, department)
    return { period, submitted: m.reported, approved: m.approved, missing: m.missing, vehicles: m.vehicles, completion: m.completion, approvedRate: m.vehicles ? Math.round(100 * m.approved / m.vehicles) : 100 }
  })
}

export function fiscalQuarterForPeriod(period: string): { fiscalYear: number; quarter: 1 | 2 | 3 | 4 } {
  const [year, month] = parsePeriod(period)
  const fiscalYear = month >= 9 ? year + 1 : year
  const quarter = (month >= 9 ? Math.floor((month - 9) / 3) + 1 : Math.floor((month + 3) / 3) + 1) as 1 | 2 | 3 | 4
  return { fiscalYear, quarter }
}
export function fiscalQuarterMonths(fiscalYear: number, quarter: number): string[] {
  if (!Number.isInteger(fiscalYear) || fiscalYear < 2000 || fiscalYear > 2200 || !Number.isInteger(quarter) || quarter < 1 || quarter > 4) throw new Error('Choose a valid fiscal year and quarter.')
  return Array.from({ length: 3 }, (_, i) => currentPeriod(new Date(fiscalYear - 1, 8 + (quarter - 1) * 3 + i, 1)))
}
export function quarterDueDate(fiscalYear: number, quarter: number): string {
  const months = fiscalQuarterMonths(fiscalYear, quarter)
  const [year, month] = parsePeriod(months[2])
  // End-of-quarter date plus sixty calendar days, per OVFM's published maximum.
  return localDay(new Date(year, month, 60))
}
export function quarterWindowStartDate(fiscalYear: number, quarter: number): string {
  const months = fiscalQuarterMonths(fiscalYear, quarter)
  const [year, month] = parsePeriod(months[2])
  // Texas Government Code §2171.101(a): not before day 45 after quarter end.
  return localDay(new Date(year, month, 45))
}
export type QuarterReportStatus = ReportStatus | 'Missing'
export interface QuarterVehicleRow {
  vehicle: Vehicle
  monthlyStatus: Record<string, QuarterReportStatus>
  approvedMonths: number
  miles: number
  fuelCost: number
  ready: boolean
}
export function quarterReadiness(state: FleetState, fiscalYear: number, quarter: number, department = 'All departments') {
  const months = fiscalQuarterMonths(fiscalYear, quarter)
  const vehicles = state.vehicles.filter(v => v.licensed && v.status !== 'Retired' && (department === 'All departments' || department === v.department))
  const rows: QuarterVehicleRow[] = vehicles.map(vehicle => {
    const monthlyStatus: Record<string, QuarterReportStatus> = {}
    let approvedMonths = 0
    let miles = 0
    let fuelCost = 0
    for (const period of months) {
      const report = activeReportFor(state, vehicle.id, period)
      monthlyStatus[period] = report?.status ?? 'Missing'
      if (report?.status === 'Approved') {
        approvedMonths++
        miles += report.endOdometer - report.startOdometer
        fuelCost += report.fuelCost
      }
    }
    return { vehicle, monthlyStatus, approvedMonths, miles, fuelCost, ready: approvedMonths === 3 }
  })
  const counts = { Approved: 0, Pending: 0, Returned: 0, Missing: 0 }
  for (const row of rows) for (const month of months) counts[row.monthlyStatus[month]]++
  const expected = vehicles.length * 3
  return {
    fiscalYear, quarter, months, dueDate: quarterDueDate(fiscalYear, quarter), windowOpens: quarterWindowStartDate(fiscalYear, quarter),
    vehicles: rows, expected, approved: counts.Approved, pending: counts.Pending, returned: counts.Returned,
    missing: counts.Missing, readyVehicles: rows.filter(r => r.ready).length,
    completion: expected ? Math.round(100 * counts.Approved / expected) : 100,
  }
}

const CSV_COLUMNS = [
  'Unit ID (INTERNAL REVIEW ONLY - NOT A TxFS BATCH)', 'Department', 'Vehicle type', 'License / asset tag', 'Reporting month',
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

/** Quarter-wide reconciliation worksheet; never an official TxFS batching file. */
export function buildQuarterReviewCsv(state: FleetState, fiscalYear: number, quarter: number, department = 'All departments'): { csv: string; count: number } {
  const summary = quarterReadiness(state, fiscalYear, quarter, department)
  const header = [
    'Unit ID (STAGING ONLY - NOT A TxFS SUBMISSION)', 'Department', 'Vehicle type', 'Plate',
    'Fiscal year', 'Fiscal quarter', ...summary.months.map(m => m + ' review status'),
    'Approved months (of 3)', 'Approved distance (miles)', 'Approved fuel cost USD',
    'Quarter reconciliation', 'Service hold',
  ]
  const rows = summary.vehicles.map(row => [
    row.vehicle.unit, row.vehicle.department, row.vehicle.kind, row.vehicle.plate,
    'FY' + summary.fiscalYear, 'Q' + summary.quarter,
    ...summary.months.map(m => row.monthlyStatus[m]),
    row.approvedMonths, row.miles, row.fuelCost.toFixed(2),
    row.ready ? 'COMPLETE' : 'INCOMPLETE - FOLLOW UP',
    row.vehicle.status === 'In maintenance' ? 'HELD OUT OF SERVICE' : '',
  ])
  return { csv: [header, ...rows].map(row => row.map(safeCsvCell).join(',')).join('\r\n') + '\r\n', count: rows.length }
}
