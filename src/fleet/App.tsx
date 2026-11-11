import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import {
  AlertCircle,
  AlertTriangle,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Building2,
  CalendarDays,
  CarFront,
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  Clock3,
  Download,
  ExternalLink,
  FileCheck2,
  FileClock,
  FileSpreadsheet,
  FileText,
  Filter,
  Fuel,
  Gauge,
  History,
  Info,
  LayoutDashboard,
  MapPinned,
  Menu,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Send,
  Settings2,
  ShieldAlert,
  Truck,
  UserRound,
  Wrench,
  X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import {
  addMaintenanceTicket,
  addVehicle,
  activeReportFor,
  buildQuarterReviewCsv,
  buildReviewCsv,
  CONDITIONS,
  createDemoFleet,
  currentPeriod,
  DEPARTMENTS,
  displayPeriod,
  fiscalQuarterForPeriod,
  fiscalQuarterMonths,
  fleetMetrics,
  getDepartmentScorecard,
  getExceptions,
  getOdometerWarnings,
  loadFleetState,
  monthlyTrends as getMonthlyTrends,
  quarterReadiness,
  recordExportPreparation,
  recordReportFollowUp,
  reportDueDate,
  reviewMonthlyReport,
  ROLES,
  saveFleetState,
  SEVERITIES,
  setVehicleStatus,
  shiftPeriod,
  submitMonthlyReport,
  TICKET_STATUSES,
  updateDepartmentProfile,
  updateMaintenanceTicket,
  updateVehicleRecord,
  VEHICLE_KINDS,
} from './domain'
import type {
  DepartmentProfile,
  FleetException,
  FleetState,
  MaintenanceTicket,
  MonthlyReport,
  ReportInput,
  Role,
  Severity,
  TicketInput,
  TicketStatus,
  Vehicle,
  VehicleCondition,
  VehicleInput,
  VehicleKind,
  VehicleStatus,
} from './domain'
import './styles.css'

type View = 'overview' | 'reports' | 'vehicles' | 'maintenance' | 'exports'
type ReportsTab = 'submit' | 'review' | 'history'
type TicketFilter = 'Active' | 'All' | TicketStatus

type ReportDraft = {
  startOdometer: string
  endOdometer: string
  fuelGallons: string
  fuelCost: string
  condition: VehicleCondition
  notes: string
  operator: string
}

type VehicleDraft = {
  unit: string
  department: string
  year: string
  make: string
  model: string
  kind: VehicleKind
  plate: string
  licensed: boolean
  odometer: string
  custodian: string
  notes: string
}

type TicketDraft = {
  vehicleId: string
  title: string
  description: string
  severity: Severity
  assignee: string
}

type ServiceEdit = {
  status: TicketStatus
  assignee: string
  scheduledFor: string
  resolutionNote: string
  actualCost: string
}

type DepartmentDraft = Pick<DepartmentProfile, 'coordinator' | 'contact' | 'monthlyDueDay' | 'notes'>

type Toast = { id: number; kind: 'success' | 'error' | 'info'; message: string }

const NAV: { id: View; label: string; icon: LucideIcon; description: string }[] = [
  { id: 'overview', label: 'Exceptions', icon: LayoutDashboard, description: 'Reports requiring action' },
  { id: 'reports', label: 'Monthly reports', icon: ClipboardList, description: 'Driver logs and supervisor approval' },
  { id: 'vehicles', label: 'Vehicle directory', icon: Truck, description: 'Asset records and custodians' },
  { id: 'maintenance', label: 'Work orders', icon: Wrench, description: 'Service assignments and resolution' },
  { id: 'exports', label: 'Quarterly review', icon: FileSpreadsheet, description: 'Quarter reconciliation and audit history' },
]

const currency = (value: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)
const whole = (value: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value)
const timestamp = (date: string) => {
  const d = new Date(date)
  return Number.isNaN(d.getTime())
    ? date
    : d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function blankReportDraft(vehicle?: Vehicle, report?: MonthlyReport): ReportDraft {
  return {
    startOdometer: String(report?.startOdometer ?? vehicle?.odometer ?? 0),
    endOdometer: String(report?.endOdometer ?? vehicle?.odometer ?? 0),
    fuelGallons: String(report?.fuelGallons ?? 0),
    fuelCost: String(report?.fuelCost ?? 0),
    condition: report?.condition ?? 'Good',
    notes: report?.notes ?? '',
    operator: report?.operator ?? '',
  }
}

function latestApprovedOdometer(state: FleetState, vehicleId: string, period: string): number | null {
  const earlier = state.reports
    .filter((report) => report.vehicleId === vehicleId && report.status === 'Approved' && report.period < period)
    .sort((a, b) => b.period.localeCompare(a.period))
  return earlier[0]?.endOdometer ?? null
}

function reportDraftFor(state: FleetState, vehicle?: Vehicle, period = currentPeriod()): ReportDraft {
  if (!vehicle) return blankReportDraft()
  const existing = activeReportFor(state, vehicle.id, period)
  if (existing) return blankReportDraft(vehicle, existing)
  // Previous approved mileage is stronger evidence than a vehicle's current reading
  // when entering historical months. The draft remains editable.
  const baseline = latestApprovedOdometer(state, vehicle.id, period) ?? vehicle.odometer
  return blankReportDraft({ ...vehicle, odometer: baseline })
}

function elapsedDays(iso: string, now = new Date()) {
  const elapsed = now.getTime() - new Date(iso).getTime()
  return Number.isFinite(elapsed) ? Math.max(0, Math.floor(elapsed / 86400000)) : 0
}

function mileageWarnings(
  state: FleetState,
  vehicle: Vehicle | undefined,
  period: string,
  draft: ReportDraft,
): { kind: 'error' | 'warning' | 'info'; message: string }[] {
  if (!vehicle) return []
  const warnings: { kind: 'error' | 'warning' | 'info'; message: string }[] = []
  const start = draft.startOdometer.trim() === '' ? NaN : Number(draft.startOdometer)
  const end = draft.endOdometer.trim() === '' ? NaN : Number(draft.endOdometer)
  const earlier = latestApprovedOdometer(state, vehicle.id, period)
  if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < 0) {
    warnings.push({ kind: 'error', message: 'Enter nonnegative whole-number readings for both odometers.' })
    return warnings
  }
  if (end < start) warnings.push({ kind: 'error', message: 'Ending odometer is below the starting reading. Correct it before submitting.' })
  if (earlier !== null && start < earlier) warnings.push({
    kind: 'error',
    message: 'Starting reading overlaps the last approved month (' + whole(earlier) + ' mi). Correct it before submitting.',
  })
  if (earlier !== null && end < earlier) warnings.push({
    kind: 'error',
    message: 'Ending reading is below the previously approved month (' + whole(earlier) + ' mi). The report will be rejected.',
  })
  const nextApproved = state.reports
    .filter((report) => report.vehicleId === vehicle.id && report.status === 'Approved' && report.period > period)
    .sort((a, b) => a.period.localeCompare(b.period))[0]
  if (nextApproved && end > nextApproved.startOdometer) warnings.push({
    kind: 'error',
    message: 'Ending reading is higher than the next approved reporting month (' + nextApproved.period + ', ' + whole(nextApproved.startOdometer) + ' mi).',
  })
  if (end >= start && end - start > 3000) warnings.push({
    kind: 'warning',
    message: 'Mileage change of ' + whole(end - start) + ' mi is unusually high for one month. Confirm both readings and add context.',
  })
  if (end === start && vehicle.kind !== 'Utility cart') warnings.push({
    kind: 'info',
    message: 'No mileage change was entered. Confirm the vehicle was unused before submitting.',
  })
  for (const message of getOdometerWarnings(state, vehicle.id, period, start, end)) {
    warnings.push({ kind: 'warning', message })
  }
  if (end - start > 4000 && draft.notes.trim().length < 15) warnings.push({
    kind: 'error',
    message: 'More than 4,000 mi requires at least 15 characters explaining the high mileage in notes.',
  })
  return warnings
}

function preferredReportVehicle(state: FleetState, period: string, department = 'All departments') {
  const candidates = state.vehicles.filter((vehicle) => vehicle.status !== 'Retired' && (department === 'All departments' || vehicle.department === department))
  return candidates.find((vehicle) => !activeReportFor(state, vehicle.id, period)) ??
    candidates.find((vehicle) => activeReportFor(state, vehicle.id, period)?.status === 'Returned') ??
    candidates[0]
}

function blankVehicleDraft(): VehicleDraft {
  return {
    unit: '',
    department: DEPARTMENTS[0],
    year: String(new Date().getFullYear()),
    make: '',
    model: '',
    kind: 'Pickup',
    plate: '',
    licensed: true,
    odometer: '0',
    custodian: '',
    notes: '',
  }
}

function blankTicketDraft(vehicleId = ''): TicketDraft {
  return { vehicleId, title: '', description: '', severity: 'Medium', assignee: '' }
}

function serviceEditFor(ticket: MaintenanceTicket): ServiceEdit {
  return {
    status: ticket.status,
    assignee: ticket.assignee ?? '',
    scheduledFor: ticket.scheduledFor ?? '',
    resolutionNote: ticket.resolutionNote ?? '',
    actualCost: ticket.actualCost === undefined ? '' : String(ticket.actualCost),
  }
}

function vehicleEditFor(vehicle: Vehicle): VehicleDraft {
  return {
    unit: vehicle.unit,
    department: vehicle.department,
    year: String(vehicle.year),
    make: vehicle.make,
    model: vehicle.model,
    kind: vehicle.kind,
    plate: vehicle.plate,
    licensed: vehicle.licensed,
    odometer: String(vehicle.odometer),
    custodian: vehicle.custodian,
    notes: vehicle.notes ?? '',
  }
}

function dateLabel(date: string) {
  const parsed = new Date(date.length === 10 ? date + 'T12:00:00' : date)
  return Number.isNaN(parsed.getTime()) ? date : parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fiscalQuarterLabel(fiscalYear: number, quarter: number) {
  return 'FY ' + fiscalYear + ' · Q' + quarter
}

function Tone({
  children,
  tone,
  icon,
}: {
  children: ReactNode
  tone?: string
  icon?: ReactNode
}) {
  return <span className={'fleet-chip fleet-chip--' + (tone ?? String(children).toLowerCase().replace(/\s+/g, '-'))}>{icon}{children}</span>
}

function Empty({
  icon: Icon = ClipboardList,
  title,
  description,
  action,
}: {
  icon?: LucideIcon
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <div className="fleet-empty" role="status">
      <span className="fleet-empty__icon"><Icon size={27} strokeWidth={1.6} /></span>
      <strong>{title}</strong>
      <p>{description}</p>
      {action}
    </div>
  )
}

function SectionTitle({
  eyebrow,
  title,
  action,
  description,
}: {
  eyebrow?: string
  title: string
  action?: ReactNode
  description?: string
}) {
  return (
    <div className="fleet-section-title fleet-card__header">
      <div>
        {eyebrow && <span className="fleet-eyebrow">{eyebrow}</span>}
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {action && <div className="fleet-section-title__action">{action}</div>}
    </div>
  )
}

function FleetCard({ className = '', children, role }: { className?: string; children: ReactNode; role?: 'tabpanel' }) {
  return <section role={role} className={'fleet-card ' + className}>{children}</section>
}

function Field({
  label,
  htmlFor,
  hint,
  children,
  className = '',
}: {
  label: string
  htmlFor: string
  hint?: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={'fleet-field ' + className + (className.includes('fleet-field--full') ? ' full' : '')}>
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && <span className="fleet-field__hint">{hint}</span>}
    </div>
  )
}

function VehicleName({ vehicle }: { vehicle?: Vehicle }) {
  if (!vehicle) return <span className="fleet-text-muted">Unknown vehicle</span>
  return (
    <span className="fleet-vehicle-name">
      <strong>{vehicle.unit}</strong>
      <small>{vehicle.year} {vehicle.make} {vehicle.model}</small>
    </span>
  )
}

function MetaLine({ label, value }: { label: string; value: ReactNode }) {
  return <div className="fleet-meta-line"><span>{label}</span><strong>{value}</strong></div>
}

export default function FleetApp() {
  const [fleet, setFleet] = useState<FleetState>(() => loadFleetState())
  const fleetRef = useRef(fleet)
  const [role, setRole] = useState<Role>('Fleet Admin')
  const [view, setView] = useState<View>('overview')
  const [period, setPeriod] = useState(currentPeriod)
  const [department, setDepartment] = useState('All departments')
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextToastId = useRef(0)
  const toastTimers = useRef<ReturnType<typeof setTimeout>[]>([])
  const [reportsTab, setReportsTab] = useState<ReportsTab>('submit')
  const [reportVehicleId, setReportVehicleId] = useState(() => preferredReportVehicle(fleet, currentPeriod())?.id ?? '')
  const [reportDraft, setReportDraft] = useState<ReportDraft>(() => {
    const vehicle = preferredReportVehicle(fleet, currentPeriod())
    return reportDraftFor(fleet, vehicle)
  })
  const [reviewer, setReviewer] = useState('Demo Supervisor')
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({})
  const [selectedReviewId, setSelectedReviewId] = useState<string | null>(null)
  const [vehicleSearch, setVehicleSearch] = useState('')
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(fleet.vehicles[0]?.id ?? null)
  const [vehicleFormOpen, setVehicleFormOpen] = useState(false)
  const [vehicleDraft, setVehicleDraft] = useState<VehicleDraft>(blankVehicleDraft)
  const [ticketFilter, setTicketFilter] = useState<TicketFilter>('Active')
  const [ticketFormOpen, setTicketFormOpen] = useState(false)
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null)
  const [ticketDraft, setTicketDraft] = useState<TicketDraft>(() => blankTicketDraft(fleet.vehicles[0]?.id))
  const [auditSearch, setAuditSearch] = useState('')
  const [showAllExceptions, setShowAllExceptions] = useState(false)
  const [exceptionFilter, setExceptionFilter] = useState<'All' | 'Reports' | 'Service'>('All')
  const [editingDepartment, setEditingDepartment] = useState<string | null>(null)
  const [departmentDraft, setDepartmentDraft] = useState<DepartmentDraft>({ coordinator: '', contact: '', monthlyDueDay: 5, notes: '' })
  const [followUpFor, setFollowUpFor] = useState<string | null>(null)
  const [followUpNote, setFollowUpNote] = useState('')
  const [followUpActor, setFollowUpActor] = useState('Demo Fleet Coordinator')
  const [vehicleEditId, setVehicleEditId] = useState<string | null>(null)
  const [vehicleEditDraft, setVehicleEditDraft] = useState<VehicleDraft>(blankVehicleDraft)
  const [vehicleStatusDraft, setVehicleStatusDraft] = useState<VehicleStatus>('Active')
  const [vehicleStatusNote, setVehicleStatusNote] = useState('')
  const [serviceEditId, setServiceEditId] = useState<string | null>(null)
  const [serviceEdit, setServiceEdit] = useState<ServiceEdit>({ status: 'Open', assignee: '', scheduledFor: '', resolutionNote: '', actualCost: '' })
  const [quarterScope, setQuarterScope] = useState(() => fiscalQuarterForPeriod(currentPeriod()))

  const toast = useCallback((message: string, kind: Toast['kind'] = 'success') => {
    const id = ++nextToastId.current
    setToasts((current) => [...current.slice(-2), { id, message, kind }])
    const timer = setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), 5500)
    toastTimers.current.push(timer)
  }, [])

  useEffect(() => () => toastTimers.current.forEach(clearTimeout), [])

  useEffect(() => {
    const closeMobileDrawer = () => {
      if (window.innerWidth > 900) setMobileNavOpen(false)
    }
    const escapeDrawer = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileNavOpen(false)
    }
    window.addEventListener('resize', closeMobileDrawer)
    window.addEventListener('keydown', escapeDrawer)
    return () => {
      window.removeEventListener('resize', closeMobileDrawer)
      window.removeEventListener('keydown', escapeDrawer)
    }
  }, [])

  const commit = (change: (current: FleetState) => FleetState, message: string): boolean => {
    try {
      const next = change(fleetRef.current)
      // Write before updating the view so a quota/private-mode failure cannot
      // make a user believe a record persisted when it did not.
      saveFleetState(next)
      fleetRef.current = next
      setFleet(next)
      toast(message)
      return true
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not save the change.', 'error')
      return false
    }
  }

  const departments = useMemo(
    () => Array.from(new Set([...DEPARTMENTS, ...fleet.vehicles.map((vehicle) => vehicle.department)])).sort(),
    [fleet.vehicles],
  )
  const filteredVehicles = useMemo(
    () => fleet.vehicles.filter((vehicle) => department === 'All departments' || vehicle.department === department),
    [fleet.vehicles, department],
  )
  const filteredIds = useMemo(() => new Set(filteredVehicles.map((vehicle) => vehicle.id)), [filteredVehicles])
  const filteredReports = useMemo(
    () => fleet.reports.filter((report) => report.period === period && filteredIds.has(report.vehicleId)),
    [fleet.reports, period, filteredIds],
  )
  const filteredTickets = useMemo(
    () => fleet.tickets.filter((ticket) => filteredIds.has(ticket.vehicleId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [fleet.tickets, filteredIds],
  )
  const overviewTickets = useMemo(() => {
    const severityRank: Record<Severity, number> = { High: 0, Medium: 1, Low: 2 }
    return filteredTickets
      .filter((ticket) => ticket.status !== 'Resolved')
      .sort((a, b) => severityRank[a.severity] - severityRank[b.severity] || a.createdAt.localeCompare(b.createdAt))
      .slice(0, 5)
  }, [filteredTickets])
  const metrics = useMemo(() => fleetMetrics(fleet, period, department), [fleet, period, department])
  const exceptions = useMemo(() => getExceptions(fleet, period, department), [fleet, period, department])
  const displayedExceptions = useMemo(() => exceptions.filter((item) =>
    exceptionFilter === 'All' ||
    (exceptionFilter === 'Reports'
      ? !/maintenance|service hold|safety/i.test(item.type)
      : /maintenance|service hold|safety/i.test(item.type)),
  ), [exceptions, exceptionFilter])
  const pendingReports = useMemo(() => filteredReports.filter((report) => report.status === 'Pending'), [filteredReports])
  const selectedVehicle = fleet.vehicles.find((vehicle) => vehicle.id === selectedVehicleId)
  const reportVehicle = fleet.vehicles.find((vehicle) => vehicle.id === reportVehicleId)
  const reportExisting = reportVehicle ? activeReportFor(fleet, reportVehicle.id, period) : undefined
  const exportData = useMemo(() => buildReviewCsv(fleet, period, department), [fleet, period, department])
  const exportRecords = useMemo(
    () => filteredReports.filter((report) => report.status === 'Approved' && fleet.vehicles.some((vehicle) => vehicle.id === report.vehicleId && vehicle.licensed)),
    [filteredReports, fleet.vehicles],
  )
  const mileageAlerts = useMemo(
    () => mileageWarnings(fleet, reportVehicle, period, reportDraft),
    [fleet, reportVehicle, period, reportDraft],
  )
  const hardMileageError = mileageAlerts.some((warning) => warning.kind === 'error')
  const monthlyTrends = useMemo(() => getMonthlyTrends(fleet, period, 6, department), [fleet, period, department])
  const trendMaximum = Math.max(1, ...monthlyTrends.map((item) => item.submitted))
  const activeTicketAges = useMemo(
    () => filteredTickets.filter((ticket) => ticket.status !== 'Resolved').map((ticket) => elapsedDays(ticket.createdAt)),
    [filteredTickets],
  )
  const oldestTicketAge = Math.max(0, ...activeTicketAges)
  const departmentScorecard = useMemo(() => getDepartmentScorecard(fleet, period).map((row) => ({
    ...row,
    profile: fleet.departmentProfiles.find((item) => item.name === row.name),
    dueDate: reportDueDate(period, row.monthlyDueDay),
  })), [fleet, period])
  const scorecardVisible = departmentScorecard.filter((row) => department === 'All departments' || row.name === department)
  const quarterMonths = fiscalQuarterMonths(quarterScope.fiscalYear, quarterScope.quarter)
  const quarterData = useMemo(
    () => quarterReadiness(fleet, quarterScope.fiscalYear, quarterScope.quarter, department),
    [fleet, quarterScope, department],
  )
  const quarterExport = useMemo(
    () => buildQuarterReviewCsv(fleet, quarterScope.fiscalYear, quarterScope.quarter, department),
    [fleet, quarterScope, department],
  )

  useEffect(() => {
    const vehicle = filteredVehicles.find((item) => item.id === reportVehicleId && item.status !== 'Retired') ??
      filteredVehicles.find((item) => item.status !== 'Retired')
    setReportVehicleId(vehicle?.id ?? '')
    setReportDraft(reportDraftFor(fleet, vehicle, period))
    // The form should refresh on filter/period changes, not on unrelated audit events.
  }, [department, period, reportVehicleId, fleet.vehicles])

  useEffect(() => {
    if (selectedVehicleId && filteredIds.has(selectedVehicleId)) return
    setSelectedVehicleId(filteredVehicles[0]?.id ?? null)
  }, [filteredIds, selectedVehicleId, filteredVehicles])

  useEffect(() => {
    setVehicleStatusDraft(selectedVehicle?.status ?? 'Active')
    setVehicleStatusNote('')
    setVehicleEditId(null)
  }, [selectedVehicleId, selectedVehicle?.status])

  useEffect(() => {
    setTicketDraft((draft) => {
      if (filteredIds.has(draft.vehicleId)) return draft
      const nextId = filteredVehicles[0]?.id ?? ''
      return draft.vehicleId === nextId ? draft : { ...draft, vehicleId: nextId }
    })
  }, [filteredIds, filteredVehicles])

  const changePage = (page: View) => {
    setView(page)
    setMobileNavOpen(false)
    if (page !== 'maintenance') setSelectedTicketId(null)
  }

  const changeRole = (next: Role) => {
    setRole(next)
    if (next === 'Driver') {
      const vehicle = preferredReportVehicle(fleetRef.current, period, department)
      setReportVehicleId(vehicle?.id ?? '')
      setReportDraft(reportDraftFor(fleetRef.current, vehicle, period))
      setReportsTab('submit')
      changePage('reports')
    } else if (next === 'Supervisor') {
      setReportsTab('review')
      changePage('reports')
    } else if (next === 'Maintenance') {
      changePage('maintenance')
    } else {
      changePage('overview')
    }
  }

  const changePeriod = (next: string) => {
    if (/^\d{4}-(0[1-9]|1[0-2])$/.test(next) && next <= currentPeriod()) {
      setPeriod(next)
      setQuarterScope(fiscalQuarterForPeriod(next))
    }
  }

  const openReport = (vehicleId: string, targetPeriod = period) => {
    const vehicle = fleetRef.current.vehicles.find((candidate) => candidate.id === vehicleId)
    if (!vehicle) return
    if (department !== 'All departments' && department !== vehicle.department) setDepartment('All departments')
    if (targetPeriod !== period) setPeriod(targetPeriod)
    setReportVehicleId(vehicleId)
    setReportDraft(reportDraftFor(fleetRef.current, vehicle, targetPeriod))
    setReportsTab('submit')
    changePage('reports')
  }

  const openReview = (reportId: string, targetPeriod = period) => {
    if (targetPeriod !== period) setPeriod(targetPeriod)
    setSelectedReviewId(reportId)
    setReportsTab('review')
    changePage('reports')
  }

  const openTicket = (ticketId?: string, vehicleId?: string) => {
    if (ticketId) {
      setSelectedTicketId(ticketId)
      setTicketFilter('All')
      setTicketFormOpen(false)
      const ticket = fleetRef.current.tickets.find((candidate) => candidate.id === ticketId)
      if (ticket) {
        setServiceEditId(ticket.id)
        setServiceEdit(serviceEditFor(ticket))
        const vehicle = fleetRef.current.vehicles.find((candidate) => candidate.id === ticket.vehicleId)
        if (vehicle && department !== 'All departments' && department !== vehicle.department) setDepartment(vehicle.department)
      }
    } else if (vehicleId) {
      setTicketDraft(blankTicketDraft(vehicleId))
      setTicketFormOpen(true)
      setSelectedTicketId(null)
    }
    changePage('maintenance')
  }

  const exceptionAction = (item: FleetException) => {
    if (/missing|overdue report|returned/i.test(item.type)) openReport(item.vehicleId)
    else if (/approval/i.test(item.type) && item.reportId) openReview(item.reportId)
    else if (/maintenance/i.test(item.type)) openTicket(item.ticketId, item.ticketId ? undefined : item.vehicleId)
    else if (item.type === 'Safety alert') {
      const linkedTicket = fleetRef.current.tickets.find((ticket) =>
        ticket.vehicleId === item.vehicleId && ticket.sourceReportId === item.reportId && ticket.status !== 'Resolved')
      openTicket(linkedTicket?.id, linkedTicket ? undefined : item.vehicleId)
    }
    else {
      setSelectedVehicleId(item.vehicleId)
      changePage('vehicles')
    }
  }

  const beginDepartmentEdit = (name: string) => {
    const profile = fleet.departmentProfiles.find((item) => item.name === name)
    setEditingDepartment(name)
    setDepartmentDraft({
      coordinator: profile?.coordinator ?? '',
      contact: profile?.contact ?? '',
      monthlyDueDay: profile?.monthlyDueDay ?? 5,
      notes: profile?.notes ?? '',
    })
  }

  const handleDepartmentSave = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!editingDepartment) return
    if (commit(
      (current) => updateDepartmentProfile(current, editingDepartment, departmentDraft, 'Demo Fleet Admin'),
      editingDepartment + ' accountability settings saved locally.',
    )) setEditingDepartment(null)
  }

  const beginFollowUp = (item: FleetException) => {
    setFollowUpFor(item.id)
    setFollowUpNote('')
  }

  const handleFollowUp = (event: FormEvent<HTMLFormElement>, item: FleetException) => {
    event.preventDefault()
    if (commit(
      (current) => recordReportFollowUp(current, item.vehicleId, period, followUpActor, followUpNote),
      'Follow-up recorded in the local audit trail. No message was sent.',
    )) {
      setFollowUpFor(null)
      setFollowUpNote('')
    }
  }

  const beginVehicleEdit = (vehicle: Vehicle) => {
    setVehicleEditId(vehicle.id)
    setVehicleEditDraft(vehicleEditFor(vehicle))
    setVehicleStatusDraft(vehicle.status)
    setVehicleStatusNote('')
  }

  const handleVehicleEdit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!vehicleEditId) return
    const patch: Partial<VehicleInput> = {
      unit: vehicleEditDraft.unit,
      department: vehicleEditDraft.department,
      year: Number(vehicleEditDraft.year),
      make: vehicleEditDraft.make,
      model: vehicleEditDraft.model,
      kind: vehicleEditDraft.kind,
      plate: vehicleEditDraft.plate,
      licensed: vehicleEditDraft.licensed,
      odometer: Number(vehicleEditDraft.odometer),
      custodian: vehicleEditDraft.custodian,
      notes: vehicleEditDraft.notes,
    }
    if (commit((current) => updateVehicleRecord(current, vehicleEditId, patch, 'Demo Fleet Admin'), 'Vehicle record updated locally.')) {
      setVehicleEditId(null)
      if (department !== 'All departments' && department !== patch.department) setDepartment('All departments')
    }
  }

  const handleVehicleStatus = (vehicle: Vehicle) => {
    if (vehicleStatusDraft === vehicle.status) return
    if (vehicleStatusDraft === 'Retired' && !window.confirm('Retire ' + vehicle.unit + ' in this local demo? It will no longer be expected to submit new monthly reports.')) return
    if (vehicle.status === 'In maintenance' && vehicleStatusDraft === 'Active' && !window.confirm('Mark ' + vehicle.unit + ' active? Confirm the required real-world inspection or release is handled separately.')) return
    if (commit(
      (current) => setVehicleStatus(current, vehicle.id, vehicleStatusDraft, 'Demo Fleet Admin', vehicleStatusNote),
      vehicle.unit + ' status updated to ' + vehicleStatusDraft.toLowerCase() + '.',
    )) setVehicleStatusNote('')
  }

  const beginServiceEdit = (ticket: MaintenanceTicket) => {
    setServiceEditId(ticket.id)
    setSelectedTicketId(ticket.id)
    setServiceEdit(serviceEditFor(ticket))
  }

  const handleServiceUpdate = (event: FormEvent<HTMLFormElement>, ticket: MaintenanceTicket) => {
    event.preventDefault()
    if (serviceEdit.status === 'Resolved' && !serviceEdit.resolutionNote.trim() && !ticket.resolutionNote) {
      toast('Add a resolution note before resolving the issue.', 'error')
      return
    }
    const details = {
      assignee: serviceEdit.assignee,
      scheduledFor: serviceEdit.scheduledFor,
      resolutionNote: serviceEdit.resolutionNote,
      actualCost: serviceEdit.actualCost.trim() ? Number(serviceEdit.actualCost) : undefined,
    }
    if (commit(
      (current) => updateMaintenanceTicket(current, ticket.id, serviceEdit.status, 'Demo ' + role, details),
      ticket.title + ' updated with service follow-through.',
    )) setServiceEditId(null)
  }

  const handleReportSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!reportVehicleId) return toast('Choose a vehicle to report.', 'error')
    if (hardMileageError) return toast('Correct the odometer errors before submitting.', 'error')
    const input: ReportInput = {
      vehicleId: reportVehicleId,
      period,
      startOdometer: Number(reportDraft.startOdometer),
      endOdometer: Number(reportDraft.endOdometer),
      fuelGallons: Number(reportDraft.fuelGallons),
      fuelCost: Number(reportDraft.fuelCost),
      condition: reportDraft.condition,
      notes: reportDraft.notes,
      operator: reportDraft.operator,
    }
    if (commit((current) => submitMonthlyReport(current, input), 'Monthly report sent to the demo supervisor queue.')) {
      setReportsTab('history')
    }
  }

  const handleReview = (reportId: string, decision: 'Approved' | 'Returned') => {
    const note = reviewNotes[reportId] ?? ''
    if (commit((current) => reviewMonthlyReport(current, reportId, decision, reviewer, note), decision === 'Approved'
      ? 'Report approved in this local demo.'
      : 'Report returned to driver for correction.')) {
      setSelectedReviewId(null)
      setReviewNotes((previous) => ({ ...previous, [reportId]: '' }))
    }
  }

  const handleAddVehicle = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const input: VehicleInput = {
      unit: vehicleDraft.unit,
      department: vehicleDraft.department,
      year: Number(vehicleDraft.year),
      make: vehicleDraft.make,
      model: vehicleDraft.model,
      kind: vehicleDraft.kind,
      plate: vehicleDraft.plate,
      licensed: vehicleDraft.licensed,
      odometer: Number(vehicleDraft.odometer),
      custodian: vehicleDraft.custodian,
    }
    if (commit((current) => addVehicle(current, input, 'Demo Fleet Admin'), 'Vehicle added to your local demo fleet.')) {
      const added = fleetRef.current.vehicles.find((vehicle) => vehicle.unit === vehicleDraft.unit.trim())
      if (added) setSelectedVehicleId(added.id)
      if (department !== 'All departments' && department !== vehicleDraft.department) setDepartment(vehicleDraft.department)
      setVehicleFormOpen(false)
      setVehicleDraft(blankVehicleDraft())
    }
  }

  const handleAddTicket = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const input: TicketInput = {
      vehicleId: ticketDraft.vehicleId,
      title: ticketDraft.title,
      description: ticketDraft.description,
      severity: ticketDraft.severity,
      assignee: ticketDraft.assignee,
    }
    if (commit((current) => addMaintenanceTicket(current, input, 'Demo ' + role), 'Maintenance issue added to your local queue.')) {
      setTicketDraft(blankTicketDraft(ticketDraft.vehicleId))
      setTicketFormOpen(false)
      setTicketFilter('Active')
    }
  }

  const downloadStagingCsv = (csv: string, count: number, filename: string, scope: 'Monthly' | 'Quarterly', label: string) => {
    if (!count) return toast('No vehicles or reports match the selected review scope.', 'error')
    try {
      const file = new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(file)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 5000)
      commit(
        (current) => recordExportPreparation(current, scope, label, count, 'Demo Fleet Admin'),
        scope + ' reconciliation worksheet downloaded locally and logged. No TxFS submission occurred.',
      )
    } catch (error) {
      toast(error instanceof Error ? error.message : 'CSV download failed.', 'error')
    }
  }

  const downloadCsv = () => downloadStagingCsv(
    exportData.csv,
    exportData.count,
    'fleetsync-monthly-review-only-' + period + (department !== 'All departments' ? '-' + department.toLowerCase().replace(/[^a-z0-9]+/g, '-') : '') + '.csv',
    'Monthly',
    displayPeriod(period) + ' · ' + department + ' · internal review staging',
  )

  const downloadQuarterCsv = () => downloadStagingCsv(
    quarterExport.csv,
    quarterExport.count,
    'fleetsync-quarterly-reconciliation-FY' + quarterScope.fiscalYear + '-Q' + quarterScope.quarter + (department !== 'All departments' ? '-' + department.toLowerCase().replace(/[^a-z0-9]+/g, '-') : '') + '.csv',
    'Quarterly',
    fiscalQuarterLabel(quarterScope.fiscalYear, quarterScope.quarter) + ' · ' + department + ' · internal review staging',
  )

  const openQuarterGap = (vehicle: Vehicle, targetPeriod: string) => {
    const report = activeReportFor(fleetRef.current, vehicle.id, targetPeriod)
    if (report?.status === 'Approved') return
    if (report?.status === 'Pending') openReview(report.id, targetPeriod)
    else openReport(vehicle.id, targetPeriod)
  }

  const resetDemo = () => {
    if (!window.confirm('Reset FleetSync to fictional sample records? Your changes saved in this browser will be replaced.')) return
    const next = createDemoFleet(currentPeriod())
    if (!commit(() => next, 'Fictional demo records restored.')) return
    setPeriod(currentPeriod())
    setDepartment('All departments')
    setView('overview')
    setReportsTab('submit')
    const firstReportable = preferredReportVehicle(next, currentPeriod())
    setReportVehicleId(firstReportable?.id ?? '')
    setReportDraft(reportDraftFor(next, firstReportable, currentPeriod()))
    setVehicleFormOpen(false)
    setTicketFormOpen(false)
    setEditingDepartment(null)
    setFollowUpFor(null)
    setExceptionFilter('All')
    setVehicleEditId(null)
    setServiceEditId(null)
    setQuarterScope(fiscalQuarterForPeriod(currentPeriod()))
    setVehicleSearch('')
    setAuditSearch('')
    setShowAllExceptions(false)
    setSelectedVehicleId(next.vehicles[0]?.id ?? null)
    setSelectedTicketId(null)
    setTicketDraft(blankTicketDraft(next.vehicles[0]?.id))
    setMobileNavOpen(false)
  }

  const auditEntries = useMemo(() => {
    const query = auditSearch.trim().toLowerCase()
    return fleet.audit.filter((entry) => {
      if (department !== 'All departments' && entry.vehicleId && !filteredIds.has(entry.vehicleId)) return false
      return !query || [entry.actor, entry.action, entry.detail].some((item) => item.toLowerCase().includes(query))
    })
  }, [fleet.audit, auditSearch, department, filteredIds])

  const completion = Math.max(0, Math.min(100, metrics.completion))
  const navCurrent = NAV.find((item) => item.id === view) ?? NAV[0]

  return (
    <div className="fleet-app" data-role={role}>
      <a className="fleet-skip-link" href="#fleet-main">Skip to main content</a>
      {mobileNavOpen && (
        <button
          type="button"
          className="fleet-overlay is-visible"
          onClick={() => setMobileNavOpen(false)}
          aria-label="Close navigation"
        />
      )}
      <aside className={'fleet-sidebar ' + (mobileNavOpen ? 'is-open' : '')} aria-label="FleetSync navigation">
        <div className="fleet-brand">
          <span className="fleet-brand-mark fleet-brand__mark"><Truck size={23} /></span>
          <span className="fleet-brand-copy fleet-brand__copy"><strong>FleetSync</strong><small>OPERATIONS</small></span>
          {mobileNavOpen && <button type="button" className="fleet-icon-button fleet-sidebar__close" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)}><X size={20} /></button>}
        </div>
        <div className="fleet-sidebar__body">
          <div className="fleet-nav-label fleet-nav__eyebrow">OPERATIONS</div>
          <nav className="fleet-nav" aria-label="Main navigation">
            {NAV.map((item) => {
              const Icon = item.icon
              return (
                <button
                  type="button"
                  key={item.id}
                  className={'fleet-nav__item ' + (view === item.id ? 'is-active' : '')}
                  aria-current={view === item.id ? 'page' : undefined}
                  onClick={() => changePage(item.id)}
                >
                  <Icon size={19} strokeWidth={1.85} />
                  <span>{item.label}</span>
                  {item.id === 'reports' && metrics.pending > 0 && <span className="fleet-nav__count">{metrics.pending}</span>}
                  {item.id === 'overview' && exceptions.length > 0 && <span className="fleet-nav__count">{exceptions.length}</span>}
                  {item.id === 'maintenance' && metrics.tickets > 0 && <span className="fleet-nav__count">{metrics.tickets}</span>}
                </button>
              )
            })}
          </nav>
          <div className="fleet-nav-label fleet-nav__eyebrow fleet-nav__eyebrow--secondary">REFERENCE</div>
          <a className="fleet-nav__item fleet-nav__external" href="/campus-map">
            <MapPinned size={19} strokeWidth={1.85} /><span>Campus map</span><ExternalLink size={15} />
          </a>
        </div>
        <div className="fleet-sidebar__footer">
          <div className="fleet-sidebar__demo"><strong>Demonstration workspace</strong></div>
          <p>Fictional records stored in this browser.</p>
          <button type="button" className="fleet-sidebar__reset" onClick={resetDemo}><RotateCcw size={15} /> Reset demo data</button>
          <span className="fleet-sidebar__version">Not connected to university systems</span>
        </div>
      </aside>

      <div className="fleet-workspace">
        <header className="fleet-topbar">
          <div className="fleet-topbar-left fleet-topbar__left">
            <button type="button" className="fleet-mobile-menu fleet-menu-button" aria-label="Open navigation" aria-expanded={mobileNavOpen} onClick={() => setMobileNavOpen(true)}><Menu size={22} /></button>
            <span className="fleet-breadcrumbs fleet-topbar__breadcrumb"><span>Fleet operations</span><ChevronRight size={15} /><strong>{navCurrent.label}</strong></span>
          </div>
          <div className="fleet-topbar-right fleet-topbar__right">
            <a className="fleet-topbar__map-link" href="/campus-map"><MapPinned size={17} /> Campus map <ExternalLink size={13} /></a>
            <div className="fleet-role-switch">
              <UserRound size={17} />
              <label className="fleet-sr-only" htmlFor="fleet-role">Switch demo role</label>
              <select id="fleet-role" value={role} onChange={(event) => changeRole(event.target.value as Role)}>
                {ROLES.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
              <ChevronDown size={14} aria-hidden="true" />
            </div>
          </div>
        </header>

        <main id="fleet-main" className="fleet-main" tabIndex={-1}>
          <div className="fleet-demo-notice" role="note">
            <Info size={16} />
            <span><strong>Demo roles, not access control.</strong> Sample records and workflows are fictional. This prototype does not connect to UT Dallas systems or TxFS.</span>
          </div>

          <div className="fleet-page">
            <div className="fleet-page-heading fleet-header">
              <div className="fleet-page-heading__copy">
                <span className="fleet-eyebrow">{view === 'overview' ? displayPeriod(period) + ' · ' + department : navCurrent.description}</span>
                <h1>{view === 'overview' ? 'Exceptions and reporting' : navCurrent.label}</h1>
                <p>
                  {view === 'overview' && 'Open actions, department reporting deadlines, and unresolved service work.'}
                  {view === 'reports' && 'Submit mileage and condition records. Approve or return department reports.'}
                  {view === 'vehicles' && 'Vehicle details, assigned departments, custodians, and service status.'}
                  {view === 'maintenance' && 'Assign, schedule, and document vehicle maintenance work.'}
                  {view === 'exports' && 'Reconcile three monthly periods and prepare review-only CSV worksheets.'}
                </p>
              </div>
              <div className="fleet-page-heading__actions">
                {view === 'overview' && <button className="fleet-button fleet-button--primary" type="button" onClick={() => {
                  const vehicle = preferredReportVehicle(fleetRef.current, period, department)
                  setReportVehicleId(vehicle?.id ?? '')
                  setReportDraft(reportDraftFor(fleetRef.current, vehicle, period))
                  setReportsTab('submit')
                  changePage('reports')
                }}><Plus size={17} /> New report</button>}
                {view === 'vehicles' && <button className="fleet-button fleet-button--primary" type="button" onClick={() => setVehicleFormOpen(true)}><Plus size={17} /> Add vehicle</button>}
                {view === 'maintenance' && <button className="fleet-button fleet-button--primary" type="button" onClick={() => { setTicketDraft(blankTicketDraft(filteredVehicles[0]?.id)); setTicketFormOpen(true) }}><Plus size={17} /> New issue</button>}
                {view === 'exports' && <button className="fleet-button fleet-button--primary" type="button" disabled={!exportData.count} onClick={downloadCsv}><Download size={17} /> Download monthly CSV</button>}
              </div>
            </div>

            <div className="fleet-filters" aria-label="Fleet scope filters">
              <div className="fleet-filter">
                <CalendarDays size={17} />
                <label htmlFor="fleet-period">Reporting month</label>
                <div className="fleet-month-controls">
                  <button type="button" aria-label="Previous month" title="Previous month" onClick={() => changePeriod(shiftPeriod(period, -1))}><ChevronLeft size={17} /></button>
                  <input id="fleet-period" className="fleet-input fleet-input--month" type="month" value={period} max={currentPeriod()} onChange={(event) => changePeriod(event.target.value)} />
                  <button type="button" aria-label="Next month" title="Next month" disabled={period >= currentPeriod()} onClick={() => changePeriod(shiftPeriod(period, 1))}><ChevronRight size={17} /></button>
                </div>
              </div>
              <div className="fleet-filter">
                <Building2 size={17} />
                <label htmlFor="fleet-department">Department</label>
                <select id="fleet-department" className="fleet-select" value={department} onChange={(event) => setDepartment(event.target.value)}>
                  <option>All departments</option>
                  {departments.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </div>
              <span className="fleet-filter__scope"><Filter size={15} /> {filteredVehicles.length} directory units ({filteredVehicles.filter((vehicle) => vehicle.status !== 'Retired').length} expected to report)</span>
            </div>

            {view === 'overview' && (
              <>
                <div className="fleet-ops-summary" aria-label="Current fleet status">
                  {[
                    { label: 'Units expected to report', value: metrics.vehicles, detail: metrics.licensed + ' licensed' },
                    { label: 'Reporting coverage', value: completion + '%', detail: metrics.reported + ' submitted' },
                    { label: 'Overdue reporting', value: metrics.overdue, detail: metrics.missing + ' missing' },
                    { label: 'Supervisor queue', value: metrics.pending, detail: metrics.returned + ' returned' },
                    { label: 'Open work orders', value: metrics.tickets, detail: metrics.serviceHolds + ' service holds' },
                  ].map((item) => (
                    <div className="fleet-ops-summary__item" key={item.label}>
                      <span className="fleet-ops-summary__label">{item.label}</span>
                      <strong className="fleet-ops-summary__number">{item.value}</strong>
                      <span className="fleet-ops-summary__detail">{item.detail}</span>
                    </div>
                  ))}
                </div>

                <div className="fleet-grid fleet-overview-grid" style={{ gridTemplateColumns: 'minmax(0, 1fr)' }}>
                  <FleetCard className="fleet-actions-card">
                    <SectionTitle title="Exceptions requiring action" description="Reporting and service issues for the selected month. Service holds show the vehicle's current status." action={<Tone tone={exceptions.length ? 'pending' : 'approved'}>{exceptions.length} open</Tone>} />
                    <div className="fleet-exception-toolbar" role="group" aria-label="Exception category">
                      {(['All', 'Reports', 'Service'] as const).map((filter) => (
                        <button type="button" className={'fleet-button fleet-button--small ' + (exceptionFilter === filter ? 'fleet-button--primary' : 'fleet-button--quiet')} aria-pressed={exceptionFilter === filter} key={filter} onClick={() => { setExceptionFilter(filter); setShowAllExceptions(false) }}>
                          {filter}
                        </button>
                      ))}
                    </div>
                    {displayedExceptions.length ? (
                      <div className="fleet-table-wrap">
                        <table className="fleet-table fleet-exceptions-table">
                          <thead><tr><th scope="col">Priority</th><th scope="col">Unit / department</th><th scope="col">Exception</th><th scope="col">Responsible</th><th scope="col">Due / aging</th><th scope="col">Actions</th></tr></thead>
                          <tbody>{(showAllExceptions ? displayedExceptions : displayedExceptions.slice(0, 6)).map((item) => {
                            const vehicle = fleet.vehicles.find((candidate) => candidate.id === item.vehicleId)
                            const isReporting = /missing|overdue report|approval|returned/i.test(item.type)
                            const actionLabel = /approval/i.test(item.type) ? 'Review' : /returned/i.test(item.type) ? 'Correct' : /missing|overdue report/i.test(item.type) ? 'Submit' : /service hold/i.test(item.type) ? 'View unit' : 'Manage'
                            return (
                              <Fragment key={item.id}>
                                <tr className={'fleet-exception-row fleet-exception-row--' + item.priority.toLowerCase()}>
                                  <td><Tone tone={item.priority.toLowerCase()}>{item.priority}</Tone></td>
                                  <td><strong>{item.label}</strong><small className="fleet-table__meta">{vehicle?.department}</small></td>
                                  <td><strong>{item.type}</strong><small className="fleet-table__meta">{item.detail}</small>{item.type === 'Service hold' && <small className="fleet-table__meta">Current vehicle status</small>}</td>
                                  <td>{item.owner || 'Unassigned'}{item.lastFollowUpAt && <small className="fleet-table__meta">Last follow-up {dateLabel(item.lastFollowUpAt)}</small>}</td>
                                  <td>{item.dueDate ? dateLabel(item.dueDate) : '—'}{typeof item.daysOverdue === 'number' && item.daysOverdue > 0 && <small className="fleet-table__meta fleet-urgency">{item.daysOverdue} days overdue</small>}</td>
                                  <td><div className="fleet-exception__actions">
                                    <button className="fleet-button fleet-button--small fleet-button--quiet" type="button" onClick={() => exceptionAction(item)} aria-label={actionLabel + ' for ' + item.label}>{actionLabel} <ArrowRight size={14} /></button>
                                    {isReporting && <button className="fleet-button fleet-button--small fleet-button--quiet" type="button" aria-expanded={followUpFor === item.id} onClick={() => followUpFor === item.id ? setFollowUpFor(null) : beginFollowUp(item)}>Follow-up</button>}
                                  </div></td>
                                </tr>
                                {followUpFor === item.id && (
                                  <tr className="fleet-exception-follow-up-row"><td colSpan={6}>
                                    <form className="fleet-form fleet-follow-up-form" onSubmit={(event) => handleFollowUp(event, item)}>
                                      <div className="fleet-profile-form__heading"><h3>Record internal follow-up · {item.label}</h3><button type="button" className="fleet-icon-button" aria-label="Close follow-up form" onClick={() => setFollowUpFor(null)}><X size={17} /></button></div>
                                      <div className="fleet-form-grid">
                                        <Field htmlFor={'follow-actor-' + item.id} label="Recorded by"><input id={'follow-actor-' + item.id} className="fleet-input" value={followUpActor} maxLength={80} minLength={2} required onChange={(event) => setFollowUpActor(event.target.value)} /></Field>
                                        <Field htmlFor={'follow-note-' + item.id} label="Follow-up note" hint="Audit note only. No email, SMS, or task notification is sent." className="fleet-field--full"><textarea id={'follow-note-' + item.id} className="fleet-textarea" value={followUpNote} rows={2} minLength={5} maxLength={400} required placeholder="Record contact attempt, response, or next step" onChange={(event) => setFollowUpNote(event.target.value)} /></Field>
                                      </div>
                                      <div className="fleet-form-actions"><button className="fleet-button fleet-button--primary fleet-button--small" type="submit"><Check size={15} /> Save note</button><button className="fleet-button fleet-button--quiet fleet-button--small" type="button" onClick={() => setFollowUpFor(null)}>Cancel</button></div>
                                    </form>
                                  </td></tr>
                                )}
                              </Fragment>
                            )
                          })}</tbody>
                        </table>
                      </div>
                    ) : <Empty icon={CheckCheck} title={exceptions.length ? 'No ' + exceptionFilter.toLowerCase() + ' exceptions' : 'No open exceptions'} description="No matching issues for the selected reporting scope." />}
                    {displayedExceptions.length > 6 && <button className="fleet-button fleet-button--quiet fleet-button--block" type="button" onClick={() => setShowAllExceptions((value) => !value)}>{showAllExceptions ? 'Show fewer exceptions' : 'Show all ' + displayedExceptions.length + ' exceptions'} <ChevronDown size={16} /></button>}
                  </FleetCard>
                </div>

                <FleetCard className="fleet-department-scorecard">
                  <SectionTitle title="Reporting by department" description="Assigned coordinator, due day, approval progress and overdue items. Due dates are configurable demo policy, not a verified university deadline." action={<Tone tone="muted">{scorecardVisible.length} departments</Tone>} />
                  <div className="fleet-table-wrap">
                    <table className="fleet-table fleet-scorecard-table">
                      <thead><tr><th scope="col">Department / coordinator</th><th scope="col">Due</th><th scope="col">Reports</th><th scope="col">Exceptions</th><th scope="col">Actions</th></tr></thead>
                      <tbody>{scorecardVisible.map((row) => (
                        <tr key={row.name}>
                          <td><strong>{row.name}</strong><small className="fleet-table__meta">{row.profile?.coordinator || 'Coordinator to be assigned'}</small>{row.profile?.contact && <small className="fleet-table__meta">{row.profile.contact}</small>}</td>
                          <td>{dateLabel(row.dueDate)}<small className="fleet-table__meta">Day {row.profile?.monthlyDueDay ?? 5}</small></td>
                          <td><div className="fleet-scorecard-metrics"><strong>{row.approved}/{row.vehicles} approved</strong><span>{row.completion}%</span></div><div className="fleet-progress fleet-progress--compact"><span style={{ width: Math.min(100, row.completion) + '%' }} /></div><small className="fleet-table__meta">{row.submitted} submitted · {row.pending} pending</small></td>
                          <td>{row.overdue > 0 ? <Tone tone="high">{row.overdue} overdue</Tone> : row.missing > 0 || row.returned > 0 ? <Tone tone="pending">{row.missing} missing · {row.returned} returned</Tone> : <Tone tone="approved">On track</Tone>}</td>
                          <td><div className="fleet-scorecard-row__actions"><button className="fleet-button fleet-button--small fleet-button--quiet" type="button" onClick={() => beginDepartmentEdit(row.name)}><Settings2 size={15} /> Edit</button><button className="fleet-button fleet-button--small fleet-button--quiet" type="button" onClick={() => { setDepartment(row.name); setExceptionFilter('All') }}>Focus <ArrowRight size={14} /></button></div></td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                  {editingDepartment && (
                    <form className="fleet-form fleet-profile-form" onSubmit={handleDepartmentSave}>
                      <div className="fleet-profile-form__heading"><h3>Edit {editingDepartment} coordination</h3><button type="button" className="fleet-icon-button" aria-label="Close department settings" onClick={() => setEditingDepartment(null)}><X size={18} /></button></div>
                      <div className="fleet-form-grid fleet-form-grid--wide">
                        <Field label="Coordinator" htmlFor="fleet-dept-coordinator"><input id="fleet-dept-coordinator" className="fleet-input" minLength={2} maxLength={80} value={departmentDraft.coordinator} required onChange={(event) => setDepartmentDraft((draft) => ({ ...draft, coordinator: event.target.value }))} /></Field>
                        <Field label="Contact detail" htmlFor="fleet-dept-contact"><input id="fleet-dept-contact" className="fleet-input" maxLength={100} value={departmentDraft.contact} placeholder="Optional local reference" onChange={(event) => setDepartmentDraft((draft) => ({ ...draft, contact: event.target.value }))} /></Field>
                        <Field label="Monthly due day (1–28)" htmlFor="fleet-dept-day"><input id="fleet-dept-day" className="fleet-input" type="number" min={1} max={28} step={1} value={departmentDraft.monthlyDueDay} required onChange={(event) => setDepartmentDraft((draft) => ({ ...draft, monthlyDueDay: Number(event.target.value) }))} /></Field>
                        <Field label="Internal guidance" htmlFor="fleet-dept-notes" className="fleet-field--full"><textarea id="fleet-dept-notes" className="fleet-textarea" maxLength={600} rows={2} value={departmentDraft.notes} onChange={(event) => setDepartmentDraft((draft) => ({ ...draft, notes: event.target.value }))} placeholder="Submission handoff, review checklist or notes" /></Field>
                      </div>
                      <div className="fleet-form-actions"><button className="fleet-button fleet-button--primary" type="submit"><Check size={16} /> Save department settings</button><button className="fleet-button fleet-button--quiet" type="button" onClick={() => setEditingDepartment(null)}>Cancel</button></div>
                    </form>
                  )}
                </FleetCard>

                <FleetCard className="fleet-overview-card fleet-open-work-orders">
                  <SectionTitle title="Open work orders" description="Highest-priority unresolved work across the selected department." action={<button type="button" className="fleet-button fleet-button--quiet fleet-button--small" onClick={() => changePage('maintenance')}>All work orders <ArrowRight size={15} /></button>} />
                  <div className="fleet-table-wrap">
                    <table className="fleet-table fleet-overview-work-table">
                      <thead><tr><th scope="col">Unit</th><th scope="col">Issue</th><th scope="col">Priority</th><th scope="col">Assigned</th><th scope="col">Scheduled</th><th scope="col">Action</th></tr></thead>
                      <tbody>{overviewTickets.map((ticket) => {
                        const vehicle = fleet.vehicles.find((item) => item.id === ticket.vehicleId)
                        return <tr key={ticket.id}><td><strong>{vehicle?.unit ?? ticket.vehicleId}</strong><small className="fleet-table__meta">{vehicle?.department}</small></td><td><strong>{ticket.title}</strong><small className="fleet-table__meta">{ticket.status} · {elapsedDays(ticket.createdAt)} days open</small></td><td><Tone tone={ticket.severity.toLowerCase()}>{ticket.severity}</Tone></td><td>{ticket.assignee || 'Unassigned'}</td><td>{ticket.scheduledFor ? dateLabel(ticket.scheduledFor) : 'Unscheduled'}</td><td><button type="button" className="fleet-button fleet-button--small fleet-button--quiet" onClick={() => openTicket(ticket.id)}>Manage <ArrowRight size={14} /></button></td></tr>
                      })}</tbody>
                    </table>
                  </div>
                  {!overviewTickets.length && <Empty icon={CheckCheck} title="No active work orders" description="No unresolved service tickets for the selected department." />}
                </FleetCard>

                <div className="fleet-grid fleet-insights-grid">
                  <FleetCard className="fleet-trends">
                    <SectionTitle title="Reporting trend · six months" description="Monthly submissions and approvals. Select a month to change the reporting scope." action={<BarChart3 size={20} />} />
                    <div className="fleet-trend-bars" role="group" aria-label="Reports submitted and approved by month">
                      {monthlyTrends.map((month) => (
                        <button type="button" className={'fleet-trend-month ' + (month.period === period ? 'is-active' : '')} key={month.period} onClick={() => changePeriod(month.period)} title={displayPeriod(month.period) + ': ' + month.submitted + ' submitted, ' + month.approved + ' approved'}>
                          <span className="fleet-trend-month__value">{month.submitted}</span>
                          <span className="fleet-trend-month__bars">
                            <span className="fleet-trend-bar fleet-trend-bar--submitted" style={{ height: (month.submitted ? Math.max(8, 100 * month.submitted / trendMaximum) : 0) + '%' }} />
                            <span className="fleet-trend-bar fleet-trend-bar--approved" style={{ height: (month.approved ? Math.max(8, 100 * month.approved / trendMaximum) : 0) + '%' }} />
                          </span>
                          <small>{new Date(month.period + '-01T12:00:00').toLocaleDateString('en-US', { month: 'short' })}</small>
                        </button>
                      ))}
                    </div>
                    <div className="fleet-chart-legend"><span><i className="fleet-legend-dot fleet-legend-dot--submitted" /> Submitted</span><span><i className="fleet-legend-dot fleet-legend-dot--approved" /> Approved</span></div>
                  </FleetCard>
                  <FleetCard className="fleet-maintenance-aging">
                    <SectionTitle title="Unresolved work order aging" description="Elapsed days since a maintenance issue was opened." action={<Wrench size={20} />} />
                    <div className="fleet-aging-summary"><strong>{oldestTicketAge}d</strong><span>Oldest open issue</span></div>
                    <div className="fleet-aging-buckets">
                      <div><span>Under 7 days</span><strong>{activeTicketAges.filter((age) => age < 7).length}</strong></div>
                      <div><span>7–29 days</span><strong>{activeTicketAges.filter((age) => age >= 7 && age < 30).length}</strong></div>
                      <div><span>30+ days</span><strong>{activeTicketAges.filter((age) => age >= 30).length}</strong></div>
                    </div>
                    <button className="fleet-button fleet-button--quiet fleet-button--block" type="button" onClick={() => changePage('maintenance')}>Manage service queue <ArrowRight size={16} /></button>
                  </FleetCard>
                </div>

                <FleetCard>
                    <SectionTitle title="Recent audit activity" description="Actions recorded in this browser. This is a demo activity history." action={<button type="button" className="fleet-button fleet-button--quiet fleet-button--small" onClick={() => changePage('exports')}>View audit log <ArrowRight size={15} /></button>} />
                  <div className="fleet-audit-list fleet-audit-list--compact">
                    {auditEntries.slice(0, 4).map((entry) => (
                      <div className="fleet-audit-row" key={entry.id}>
                        <div><strong>{entry.action}</strong><p>{entry.detail}</p></div>
                        <time dateTime={entry.at} className="fleet-audit-row__date">{timestamp(entry.at)}</time>
                      </div>
                    ))}
                  </div>
                </FleetCard>
              </>
            )}

            {view === 'reports' && (
              <>
                <div className="fleet-tabs" role="tablist" aria-label="Monthly report workflows">
                  <button id="fleet-report-submit-tab" role="tab" type="button" className={'fleet-tab ' + (reportsTab === 'submit' ? 'is-active' : '')} aria-selected={reportsTab === 'submit'} onClick={() => setReportsTab('submit')}><Send size={17} /> Submit report</button>
                  <button id="fleet-report-review-tab" role="tab" type="button" className={'fleet-tab ' + (reportsTab === 'review' ? 'is-active' : '')} aria-selected={reportsTab === 'review'} onClick={() => setReportsTab('review')}><ClipboardCheck size={17} /> Supervisor review <span className="fleet-tab__count">{pendingReports.length}</span></button>
                  <button id="fleet-report-history-tab" role="tab" type="button" className={'fleet-tab ' + (reportsTab === 'history' ? 'is-active' : '')} aria-selected={reportsTab === 'history'} onClick={() => setReportsTab('history')}><History size={17} /> All reports</button>
                </div>
                {reportsTab === 'submit' && (
                  <div role="tabpanel" aria-labelledby="fleet-report-submit-tab" className="fleet-grid fleet-reports-layout">
                    <FleetCard>
                      <SectionTitle eyebrow="DRIVER WORKFLOW" title="Monthly vehicle use report" description={'Record vehicle activity for ' + displayPeriod(period) + '. This demo queues a supervisor review.'} />
                      <div className="fleet-banner fleet-banner--info"><Info size={18} /><span>Enter the information for one vehicle. Returned reports can be corrected and resubmitted under the same record.</span></div>
                      <form className="fleet-form" onSubmit={handleReportSubmit}>
                        <div className="fleet-form-grid">
                          <Field label="Vehicle / unit" htmlFor="fleet-report-vehicle" className="fleet-field--full">
                            <select className="fleet-select" id="fleet-report-vehicle" value={reportVehicleId} required onChange={(event) => {
                              const id = event.target.value
                              const vehicle = fleet.vehicles.find((item) => item.id === id)
                              setReportVehicleId(id)
                              setReportDraft(reportDraftFor(fleet, vehicle, period))
                            }}>
                              {filteredVehicles.filter((vehicle) => vehicle.status !== 'Retired').map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.unit} · {vehicle.year} {vehicle.make} {vehicle.model}</option>)}
                            </select>
                          </Field>
                          <Field label="Starting odometer (miles)" htmlFor="fleet-report-start">
                            <input className="fleet-input" id="fleet-report-start" type="number" min="0" step="1" value={reportDraft.startOdometer} onChange={(event) => setReportDraft((draft) => ({ ...draft, startOdometer: event.target.value }))} required disabled={Boolean(reportExisting && reportExisting.status !== 'Returned')} />
                          </Field>
                          <Field label="Ending odometer (miles)" htmlFor="fleet-report-end">
                            <input className="fleet-input" id="fleet-report-end" type="number" min="0" step="1" value={reportDraft.endOdometer} onChange={(event) => setReportDraft((draft) => ({ ...draft, endOdometer: event.target.value }))} required disabled={Boolean(reportExisting && reportExisting.status !== 'Returned')} />
                          </Field>
                          <Field label="Fuel purchased (gallons)" htmlFor="fleet-report-fuel">
                            <input className="fleet-input" id="fleet-report-fuel" type="number" min="0" step="0.01" value={reportDraft.fuelGallons} onChange={(event) => setReportDraft((draft) => ({ ...draft, fuelGallons: event.target.value }))} required disabled={Boolean(reportExisting && reportExisting.status !== 'Returned')} />
                          </Field>
                          <Field label="Fuel cost (USD)" htmlFor="fleet-report-cost">
                            <input className="fleet-input" id="fleet-report-cost" type="number" min="0" step="0.01" value={reportDraft.fuelCost} onChange={(event) => setReportDraft((draft) => ({ ...draft, fuelCost: event.target.value }))} required disabled={Boolean(reportExisting && reportExisting.status !== 'Returned')} />
                          </Field>
                          <Field label="Vehicle condition" htmlFor="fleet-report-condition">
                            <select className="fleet-select" id="fleet-report-condition" value={reportDraft.condition} onChange={(event) => setReportDraft((draft) => ({ ...draft, condition: event.target.value as VehicleCondition }))} disabled={Boolean(reportExisting && reportExisting.status !== 'Returned')}>
                              {CONDITIONS.map((condition) => <option key={condition}>{condition}</option>)}
                            </select>
                          </Field>
                          <Field label="Driver / operator name" htmlFor="fleet-report-operator">
                            <input className="fleet-input" id="fleet-report-operator" value={reportDraft.operator} onChange={(event) => setReportDraft((draft) => ({ ...draft, operator: event.target.value }))} placeholder="e.g. Demo Operator" maxLength={80} required disabled={Boolean(reportExisting && reportExisting.status !== 'Returned')} />
                          </Field>
                          <Field label="Condition / usage notes" htmlFor="fleet-report-notes" hint="Required if the condition is Needs attention or Unsafe." className="fleet-field--full">
                            <textarea className="fleet-textarea" id="fleet-report-notes" value={reportDraft.notes} onChange={(event) => setReportDraft((draft) => ({ ...draft, notes: event.target.value }))} maxLength={1200} rows={4} placeholder="Record issues, unusual mileage, or other observations" disabled={Boolean(reportExisting && reportExisting.status !== 'Returned')} />
                          </Field>
                        </div>
                        {!reportExisting || reportExisting.status === 'Returned' ? (
                          <div className="fleet-odometer-alerts" role="status" aria-live="polite">
                            <div className="fleet-odometer-alert fleet-odometer-alert--info"><Gauge size={17} /><span>Calculated use: <strong>{Number.isFinite(Number(reportDraft.endOdometer) - Number(reportDraft.startOdometer)) ? whole(Math.max(0, Number(reportDraft.endOdometer) - Number(reportDraft.startOdometer))) : '—'} mi</strong>. Pre-filled values come from the latest approved earlier month when available. Confirm both meter readings.</span></div>
                            {mileageAlerts.map((alert, index) => (
                              <div className={'fleet-odometer-alert fleet-odometer-alert--' + alert.kind} key={index}>
                                {alert.kind === 'error' ? <AlertTriangle size={17} /> : <Info size={17} />}
                                <span>{alert.message}</span>
                              </div>
                            ))}
                            {reportDraft.condition !== 'Good' && <div className={'fleet-odometer-alert fleet-odometer-alert--' + (reportDraft.condition === 'Unsafe' ? 'error' : 'warning')}><ShieldAlert size={17} /><span>{reportDraft.condition === 'Unsafe' ? 'An unsafe condition will create or escalate a high-priority maintenance issue and place the vehicle on a service hold in the demo. Releasing it requires a separate review.' : 'A condition needing attention will generate a maintenance issue for follow-through.'}</span></div>}
                          </div>
                        ) : null}
                        <div className="fleet-form-actions fleet-form__actions">
                          <button className="fleet-button fleet-button--primary" type="submit" disabled={!reportVehicleId || hardMileageError || Boolean(reportExisting && reportExisting.status !== 'Returned')}>
                            <Send size={17} /> {reportExisting?.status === 'Returned' ? 'Resubmit corrected report' : 'Submit for review'}
                          </button>
                        </div>
                      </form>
                    </FleetCard>
                    <div className="fleet-stack">
                      <FleetCard className="fleet-context-card">
                        <SectionTitle eyebrow="SELECTED VEHICLE" title="Reporting context" />
                        {reportVehicle ? (
                          <>
                            <div className="fleet-context-vehicle"><span><Truck size={24} /></span><VehicleName vehicle={reportVehicle} /></div>
                            <MetaLine label="Department" value={reportVehicle.department} />
                            <MetaLine label="Custodian" value={reportVehicle.custodian} />
                            <MetaLine label="Current stored odometer" value={whole(reportVehicle.odometer) + ' mi'} />
                            <MetaLine label="Previous approved reading" value={latestApprovedOdometer(fleet, reportVehicle.id, period) === null ? 'None on file' : whole(latestApprovedOdometer(fleet, reportVehicle.id, period)!) + ' mi'} />
                            <MetaLine label="Reporting month" value={displayPeriod(period)} />
                            <MetaLine label="Vehicle availability" value={<Tone tone={reportVehicle.status === 'Active' ? 'approved' : reportVehicle.status === 'Retired' ? 'muted' : 'high'}>{reportVehicle.status}</Tone>} />
                            <MetaLine label="Report status" value={reportExisting ? <Tone tone={reportExisting.status.toLowerCase()}>{reportExisting.status}</Tone> : <Tone tone="muted">Not submitted</Tone>} />
                            {reportExisting?.status === 'Returned' && <div className="fleet-banner fleet-banner--warning"><AlertTriangle size={17} /><span><strong>Returned for correction</strong>{reportExisting.reviewNote && <small>{reportExisting.reviewNote}</small>}</span></div>}
                            {reportExisting?.status === 'Pending' && <div className="fleet-banner fleet-banner--info"><Clock3 size={17} /><span>Already submitted for this month. Awaiting supervisor review.</span></div>}
                            {reportExisting?.status === 'Approved' && <div className="fleet-banner fleet-banner--success"><CheckCircle2 size={17} /><span>This report is approved and locked for the current month.</span></div>}
                          </>
                        ) : <Empty title="No vehicle selected" description="Try another department filter." />}
                      </FleetCard>
                      <FleetCard>
                        <SectionTitle eyebrow="HOW IT WORKS" title="Report lifecycle" />
                        <ol className="fleet-lifecycle">
                          <li><span>01</span><div><strong>Driver submits</strong><small>Monthly use and condition are recorded.</small></div></li>
                          <li><span>02</span><div><strong>Supervisor reviews</strong><small>Approve or return for correction.</small></div></li>
                          <li><span>03</span><div><strong>Admin prepares</strong><small>Approved licensed vehicle records are available for review-only CSV export.</small></div></li>
                        </ol>
                      </FleetCard>
                    </div>
                  </div>
                )}
                {reportsTab === 'review' && (
                  <FleetCard role="tabpanel" className="fleet-review-card">
                    <SectionTitle eyebrow="SUPERVISOR WORKFLOW" title="Pending approval" description={'Review submissions for ' + displayPeriod(period) + '. Approvals update the vehicle odometer and audit trail.'} action={<Tone tone="pending">{pendingReports.length} awaiting review</Tone>} />
                    <div className="fleet-reviewer-row">
                      <Field htmlFor="fleet-reviewer" label="Reviewer name">
                        <input id="fleet-reviewer" className="fleet-input" value={reviewer} onChange={(event) => setReviewer(event.target.value)} maxLength={80} placeholder="Demo Supervisor" />
                      </Field>
                    </div>
                    {pendingReports.length ? (
                      <div className="fleet-review-list">
                        {pendingReports.map((report) => {
                          const vehicle = fleet.vehicles.find((candidate) => candidate.id === report.vehicleId)
                          return (
                            <article className={'fleet-review-item ' + (selectedReviewId === report.id ? 'is-highlighted' : '')} key={report.id}>
                              <div className="fleet-review-item__heading">
                                <div className="fleet-review-item__identity"><span className="fleet-review-item__icon"><Truck size={21} /></span><VehicleName vehicle={vehicle} /></div>
                                <Tone tone="pending">Pending review</Tone>
                              </div>
                              <div className="fleet-review-item__meta"><span>{vehicle?.department}</span><span>Submitted by {report.operator}</span><span>{timestamp(report.submittedAt)}</span></div>
                              <div className="fleet-review-item__stats">
                                <div><small>Distance</small><strong>{whole(report.endOdometer - report.startOdometer)} mi</strong></div>
                                <div><small>Odometer</small><strong>{whole(report.endOdometer)}</strong></div>
                                <div><small>Fuel</small><strong>{report.fuelGallons.toFixed(2)} gal</strong></div>
                                <div><small>Cost</small><strong>{currency(report.fuelCost)}</strong></div>
                              </div>
                              <div className="fleet-review-item__condition"><strong>Vehicle condition</strong><Tone tone={report.condition === 'Good' ? 'approved' : report.condition === 'Unsafe' ? 'high' : 'medium'}>{report.condition}</Tone></div>
                              {report.notes && <p className="fleet-review-item__notes">“{report.notes}”</p>}
                              <Field htmlFor={'fleet-review-note-' + report.id} label="Review note (required to return)" className="fleet-field--full">
                                <textarea
                                  id={'fleet-review-note-' + report.id}
                                  className="fleet-textarea"
                                  rows={2}
                                  maxLength={400}
                                  value={reviewNotes[report.id] ?? ''}
                                  onChange={(event) => setReviewNotes((previous) => ({ ...previous, [report.id]: event.target.value }))}
                                  placeholder="Feedback for the operator, if needed"
                                />
                              </Field>
                              <div className="fleet-form-actions fleet-review-item__actions">
                                <button type="button" className="fleet-button fleet-button--primary" onClick={() => handleReview(report.id, 'Approved')}><Check size={17} /> Approve report</button>
                                <button type="button" className="fleet-button fleet-button--danger fleet-button--danger-outline" onClick={() => handleReview(report.id, 'Returned')}><ArrowLeft size={17} /> Return for correction</button>
                              </div>
                            </article>
                          )
                        })}
                      </div>
                    ) : <Empty icon={CheckCircle2} title="No pending reports" description="There are no submissions awaiting supervisor review in the selected month and department." action={<button type="button" className="fleet-button fleet-button--quiet" onClick={() => setReportsTab('history')}>View all monthly reports <ArrowRight size={16} /></button>} />}
                  </FleetCard>
                )}
                {reportsTab === 'history' && (
                  <FleetCard role="tabpanel" className="fleet-history-card">
                    <SectionTitle eyebrow="MONTHLY RECORDS" title={displayPeriod(period) + ' reports'} description="All submitted reports for the selected scope, including returned records." action={<Tone tone="muted">{filteredReports.length} records</Tone>} />
                    <div className="fleet-table-wrap">
                      <table className="fleet-table">
                        <thead><tr><th scope="col">Vehicle</th><th scope="col">Operator</th><th scope="col">Distance</th><th scope="col">Condition</th><th scope="col">Status</th><th scope="col">Action</th></tr></thead>
                        <tbody>
                          {filteredReports.map((report) => {
                            const vehicle = fleet.vehicles.find((item) => item.id === report.vehicleId)
                            return (
                              <tr key={report.id}>
                                <td><VehicleName vehicle={vehicle} /></td>
                                <td>{report.operator}<small className="fleet-table__meta">{timestamp(report.submittedAt)}</small></td>
                                <td>{whole(report.endOdometer - report.startOdometer)} mi</td>
                                <td><Tone tone={report.condition === 'Good' ? 'approved' : report.condition === 'Unsafe' ? 'high' : 'medium'}>{report.condition}</Tone></td>
                                <td><Tone tone={report.status.toLowerCase()}>{report.status}</Tone></td>
                                <td>
                                  {report.status === 'Returned' && <button className="fleet-button fleet-button--small fleet-button--quiet" type="button" onClick={() => openReport(report.vehicleId)}>Correct <ArrowRight size={15} /></button>}
                                  {report.status === 'Pending' && <button className="fleet-button fleet-button--small fleet-button--quiet" type="button" onClick={() => openReview(report.id)}>Review <ArrowRight size={15} /></button>}
                                  {report.status === 'Approved' && <span className="fleet-table__muted">Complete</span>}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                    {!filteredReports.length && <Empty icon={FileClock} title="No reports for this month" description="Select another month or department, or submit the first report." />}
                  </FleetCard>
                )}
              </>
            )}

            {view === 'vehicles' && (
              <>
                {vehicleFormOpen && (
                  <FleetCard className="fleet-create-card">
                    <SectionTitle eyebrow="DIRECTORY MANAGEMENT" title="Add a vehicle or campus asset" description="This adds a fictional record to your browser's demo fleet." action={<button type="button" className="fleet-icon-button" aria-label="Close new vehicle form" onClick={() => setVehicleFormOpen(false)}><X size={19} /></button>} />
                    <form className="fleet-form" onSubmit={handleAddVehicle}>
                      <div className="fleet-form-grid fleet-form-grid--wide">
                        <Field htmlFor="fleet-new-unit" label="Unit ID"><input className="fleet-input" id="fleet-new-unit" value={vehicleDraft.unit} maxLength={40} required placeholder="DEMO-1001" onChange={(event) => setVehicleDraft((draft) => ({ ...draft, unit: event.target.value }))} /></Field>
                        <Field htmlFor="fleet-new-department" label="Department"><select className="fleet-select" id="fleet-new-department" value={vehicleDraft.department} onChange={(event) => setVehicleDraft((draft) => ({ ...draft, department: event.target.value }))}>{departments.map((item) => <option key={item}>{item}</option>)}</select></Field>
                        <Field htmlFor="fleet-new-year" label="Model year"><input className="fleet-input" id="fleet-new-year" type="number" min="1990" max={new Date().getFullYear() + 1} step="1" value={vehicleDraft.year} onChange={(event) => setVehicleDraft((draft) => ({ ...draft, year: event.target.value }))} required /></Field>
                        <Field htmlFor="fleet-new-make" label="Make"><input className="fleet-input" id="fleet-new-make" maxLength={80} value={vehicleDraft.make} onChange={(event) => setVehicleDraft((draft) => ({ ...draft, make: event.target.value }))} required /></Field>
                        <Field htmlFor="fleet-new-model" label="Model"><input className="fleet-input" id="fleet-new-model" maxLength={80} value={vehicleDraft.model} onChange={(event) => setVehicleDraft((draft) => ({ ...draft, model: event.target.value }))} required /></Field>
                        <Field htmlFor="fleet-new-kind" label="Vehicle type"><select className="fleet-select" id="fleet-new-kind" value={vehicleDraft.kind} onChange={(event) => setVehicleDraft((draft) => ({ ...draft, kind: event.target.value as VehicleKind }))}>{VEHICLE_KINDS.map((kind) => <option key={kind}>{kind}</option>)}</select></Field>
                        <Field htmlFor="fleet-new-plate" label="License plate / asset tag"><input className="fleet-input" id="fleet-new-plate" maxLength={30} value={vehicleDraft.plate} onChange={(event) => setVehicleDraft((draft) => ({ ...draft, plate: event.target.value }))} required /></Field>
                        <Field htmlFor="fleet-new-odometer" label="Current odometer"><input className="fleet-input" id="fleet-new-odometer" type="number" min="0" step="1" value={vehicleDraft.odometer} onChange={(event) => setVehicleDraft((draft) => ({ ...draft, odometer: event.target.value }))} required /></Field>
                        <Field htmlFor="fleet-new-custodian" label="Assigned custodian"><input className="fleet-input" id="fleet-new-custodian" maxLength={80} value={vehicleDraft.custodian} onChange={(event) => setVehicleDraft((draft) => ({ ...draft, custodian: event.target.value }))} required /></Field>
                        <label className="fleet-checkbox-field"><input type="checkbox" checked={vehicleDraft.licensed} onChange={(event) => setVehicleDraft((draft) => ({ ...draft, licensed: event.target.checked }))} /><span>State licensed vehicle</span></label>
                      </div>
                      <div className="fleet-form-actions fleet-form__actions"><button className="fleet-button fleet-button--primary" type="submit"><Plus size={17} /> Add vehicle</button><button className="fleet-button fleet-button--quiet" type="button" onClick={() => setVehicleFormOpen(false)}>Cancel</button></div>
                    </form>
                  </FleetCard>
                )}
                <div className="fleet-grid fleet-vehicles-layout">
                  <FleetCard className="fleet-vehicle-list-card">
                    <SectionTitle eyebrow="FLEET DIRECTORY" title="Vehicle inventory" action={<Tone tone="muted">{filteredVehicles.length} units</Tone>} />
                    <div className="fleet-search">
                      <Search size={18} />
                      <label className="fleet-sr-only" htmlFor="fleet-vehicle-search">Search units, makes, plates, or custodians</label>
                      <input id="fleet-vehicle-search" className="fleet-input" type="search" placeholder="Search vehicles, plates, people..." value={vehicleSearch} onChange={(event) => setVehicleSearch(event.target.value)} />
                      {vehicleSearch && <button type="button" aria-label="Clear vehicle search" onClick={() => setVehicleSearch('')}><X size={16} /></button>}
                    </div>
                    <div className="fleet-vehicle-list">
                      {filteredVehicles.filter((vehicle) => [vehicle.unit, vehicle.make, vehicle.model, vehicle.plate, vehicle.custodian, vehicle.department].some((field) => field.toLowerCase().includes(vehicleSearch.trim().toLowerCase()))).map((vehicle) => {
                        const report = activeReportFor(fleet, vehicle.id, period)
                        return (
                          <button type="button" key={vehicle.id} className={'fleet-vehicle-row ' + (selectedVehicleId === vehicle.id ? 'is-active' : '')} onClick={() => { setSelectedVehicleId(vehicle.id); setVehicleStatusDraft(vehicle.status); setVehicleEditId(null) }} aria-pressed={selectedVehicleId === vehicle.id}>
                            <span className="fleet-vehicle-row__icon"><CarFront size={21} /></span>
                            <span className="fleet-vehicle-row__copy"><strong>{vehicle.unit}</strong><small>{vehicle.year} {vehicle.make} {vehicle.model}</small><small>{vehicle.department}</small></span>
                            <span className="fleet-vehicle-row__status"><Tone tone={report?.status.toLowerCase() ?? 'muted'}>{report?.status ?? 'Missing'}</Tone><ChevronRight size={17} /></span>
                          </button>
                        )
                      })}
                    </div>
                    {!filteredVehicles.length && <Empty icon={Truck} title="No vehicles in this scope" description="Select another department or add a vehicle." />}
                    {filteredVehicles.length > 0 && !filteredVehicles.some((vehicle) => [vehicle.unit, vehicle.make, vehicle.model, vehicle.plate, vehicle.custodian, vehicle.department].some((field) => field.toLowerCase().includes(vehicleSearch.trim().toLowerCase()))) && <Empty icon={Search} title="No matching vehicles" description="Try another search or clear the search field." />}
                  </FleetCard>
                  <FleetCard className="fleet-vehicle-detail">
                    {selectedVehicle && filteredIds.has(selectedVehicle.id) ? (
                      <>
                        <div className="fleet-vehicle-detail__hero"><span className="fleet-vehicle-detail__icon"><Truck size={33} strokeWidth={1.5} /></span><Tone tone={selectedVehicle.status === 'Active' ? 'approved' : selectedVehicle.status === 'Retired' ? 'muted' : 'medium'}>{selectedVehicle.status}</Tone></div>
                        <span className="fleet-eyebrow">UNIT PROFILE</span>
                        <h2>{selectedVehicle.unit}</h2>
                        <p className="fleet-vehicle-detail__subtitle">{selectedVehicle.year} {selectedVehicle.make} {selectedVehicle.model} · {selectedVehicle.kind}</p>
                        <div className="fleet-vehicle-detail__meta">
                          <MetaLine label="Department" value={selectedVehicle.department} />
                          <MetaLine label="Custodian" value={selectedVehicle.custodian} />
                          <MetaLine label="License / asset tag" value={selectedVehicle.plate} />
                          <MetaLine label="Licensed" value={selectedVehicle.licensed ? 'Yes' : 'No · campus asset'} />
                          <MetaLine label="Odometer" value={whole(selectedVehicle.odometer) + ' mi'} />
                          {selectedVehicle.notes && <MetaLine label="Unit notes" value={selectedVehicle.notes} />}
                          <MetaLine label={displayPeriod(period) + ' report'} value={activeReportFor(fleet, selectedVehicle.id, period) ? <Tone tone={activeReportFor(fleet, selectedVehicle.id, period)!.status.toLowerCase()}>{activeReportFor(fleet, selectedVehicle.id, period)!.status}</Tone> : <Tone tone="muted">Missing</Tone>} />
                          <MetaLine label="Service issues" value={fleet.tickets.filter((ticket) => ticket.vehicleId === selectedVehicle.id && ticket.status !== 'Resolved').length + ' open'} />
                        </div>
                        <div className="fleet-vehicle-detail__actions"><button type="button" className="fleet-button fleet-button--primary" onClick={() => openReport(selectedVehicle.id)}><FileText size={16} /> Monthly report</button><button type="button" className="fleet-button fleet-button--quiet" onClick={() => openTicket(undefined, selectedVehicle.id)}><Wrench size={16} /> Raise issue</button><button type="button" className="fleet-button fleet-button--quiet" onClick={() => vehicleEditId === selectedVehicle.id ? setVehicleEditId(null) : beginVehicleEdit(selectedVehicle)} aria-expanded={vehicleEditId === selectedVehicle.id}><Pencil size={16} /> Edit vehicle</button></div>
                        {vehicleEditId === selectedVehicle.id && (
                          <form className="fleet-form fleet-vehicle-edit-form" onSubmit={handleVehicleEdit}>
                            <div className="fleet-profile-form__heading"><h3>Edit {selectedVehicle.unit} details</h3><button type="button" className="fleet-icon-button" aria-label="Cancel vehicle edit" onClick={() => setVehicleEditId(null)}><X size={18} /></button></div>
                            <div className="fleet-form-grid fleet-form-grid--wide">
                              <Field htmlFor="fleet-edit-unit" label="Unit ID"><input id="fleet-edit-unit" className="fleet-input" value={vehicleEditDraft.unit} minLength={3} maxLength={40} required onChange={(event) => setVehicleEditDraft((draft) => ({ ...draft, unit: event.target.value }))} /></Field>
                              <Field htmlFor="fleet-edit-department" label="Department"><select id="fleet-edit-department" className="fleet-select" value={vehicleEditDraft.department} onChange={(event) => setVehicleEditDraft((draft) => ({ ...draft, department: event.target.value }))}>{departments.map((item) => <option key={item}>{item}</option>)}</select></Field>
                              <Field htmlFor="fleet-edit-year" label="Year"><input id="fleet-edit-year" className="fleet-input" type="number" min={1990} max={new Date().getFullYear() + 1} step={1} value={vehicleEditDraft.year} required onChange={(event) => setVehicleEditDraft((draft) => ({ ...draft, year: event.target.value }))} /></Field>
                              <Field htmlFor="fleet-edit-make" label="Make"><input id="fleet-edit-make" className="fleet-input" maxLength={80} value={vehicleEditDraft.make} required onChange={(event) => setVehicleEditDraft((draft) => ({ ...draft, make: event.target.value }))} /></Field>
                              <Field htmlFor="fleet-edit-model" label="Model"><input id="fleet-edit-model" className="fleet-input" maxLength={80} value={vehicleEditDraft.model} required onChange={(event) => setVehicleEditDraft((draft) => ({ ...draft, model: event.target.value }))} /></Field>
                              <Field htmlFor="fleet-edit-kind" label="Vehicle type"><select id="fleet-edit-kind" className="fleet-select" value={vehicleEditDraft.kind} onChange={(event) => setVehicleEditDraft((draft) => ({ ...draft, kind: event.target.value as VehicleKind }))}>{VEHICLE_KINDS.map((kind) => <option key={kind}>{kind}</option>)}</select></Field>
                              <Field htmlFor="fleet-edit-plate" label="Plate / asset tag"><input id="fleet-edit-plate" className="fleet-input" maxLength={30} value={vehicleEditDraft.plate} required onChange={(event) => setVehicleEditDraft((draft) => ({ ...draft, plate: event.target.value }))} /></Field>
                              <Field htmlFor="fleet-edit-odometer" label="Recorded odometer"><input id="fleet-edit-odometer" className="fleet-input" type="number" min={0} step={1} value={vehicleEditDraft.odometer} required onChange={(event) => setVehicleEditDraft((draft) => ({ ...draft, odometer: event.target.value }))} /></Field>
                              <Field htmlFor="fleet-edit-custodian" label="Custodian"><input id="fleet-edit-custodian" className="fleet-input" maxLength={80} value={vehicleEditDraft.custodian} required onChange={(event) => setVehicleEditDraft((draft) => ({ ...draft, custodian: event.target.value }))} /></Field>
                              <label className="fleet-checkbox-field"><input type="checkbox" checked={vehicleEditDraft.licensed} onChange={(event) => setVehicleEditDraft((draft) => ({ ...draft, licensed: event.target.checked }))} /><span>Licensed vehicle (eligible for state reporting review)</span></label>
                              <Field htmlFor="fleet-edit-notes" label="Unit notes" className="fleet-field--full"><textarea id="fleet-edit-notes" className="fleet-textarea" maxLength={600} rows={3} value={vehicleEditDraft.notes} onChange={(event) => setVehicleEditDraft((draft) => ({ ...draft, notes: event.target.value }))} placeholder="Record use restrictions, handoff guidance or other internal notes" /></Field>
                            </div>
                            <div className="fleet-form-actions"><button type="submit" className="fleet-button fleet-button--primary"><Check size={16} /> Save vehicle details</button><button type="button" className="fleet-button fleet-button--quiet" onClick={() => setVehicleEditId(null)}>Cancel</button></div>
                          </form>
                        )}
                        <section className="fleet-vehicle-status-actions" aria-label="Vehicle service status">
                          <h3>Availability & service hold</h3>
                          <p className="fleet-text-muted">Status changes are logged in the local audit. Releasing a vehicle is a manual administrative action, separate from resolving repair tickets.</p>
                          {selectedVehicle.status === 'In maintenance' && <div className="fleet-banner fleet-banner--warning"><ShieldAlert size={18} /><span>This unit is held out of service. Resolve high-priority issues before marking it active. Complete real-world safety release procedures outside this demo.</span></div>}
                          <Field htmlFor="fleet-vehicle-status" label="New status"><select id="fleet-vehicle-status" className="fleet-select" value={vehicleStatusDraft} onChange={(event) => setVehicleStatusDraft(event.target.value as VehicleStatus)}>{(['Active', 'In maintenance', 'Retired'] as VehicleStatus[]).map((status) => <option key={status}>{status}</option>)}</select></Field>
                          {vehicleStatusDraft !== selectedVehicle.status && (
                            <>
                              <Field htmlFor="fleet-vehicle-status-note" label="Reason for status change (required)"><textarea id="fleet-vehicle-status-note" className="fleet-textarea" minLength={5} maxLength={400} required rows={2} value={vehicleStatusNote} placeholder="Record the hold, release review, or retirement reason" onChange={(event) => setVehicleStatusNote(event.target.value)} /></Field>
                              <button type="button" className="fleet-button fleet-button--primary" disabled={vehicleStatusNote.trim().length < 5} onClick={() => handleVehicleStatus(selectedVehicle)}><Check size={16} /> Save vehicle status</button>
                            </>
                          )}
                        </section>
                      </>
                    ) : <Empty icon={Truck} title="Select a vehicle" description="Choose a unit from the directory to inspect its profile." />}
                  </FleetCard>
                </div>
              </>
            )}

            {view === 'maintenance' && (
              <>
                <div className="fleet-grid fleet-maintenance-layout">
                  <FleetCard className="fleet-maintenance-card">
                    <SectionTitle eyebrow="SERVICE WORKFLOW" title="Maintenance queue" description="Issues remain visible across reporting months. Department scope still applies." action={<Tone tone="medium">{filteredTickets.filter((ticket) => ticket.status !== 'Resolved').length} active</Tone>} />
                    <div className="fleet-tabs fleet-tabs--compact" role="group" aria-label="Filter maintenance status">
                      {(['Active', 'All', ...TICKET_STATUSES] as TicketFilter[]).map((status) => <button type="button" key={status} className={'fleet-tab ' + (ticketFilter === status ? 'is-active' : '')} aria-pressed={ticketFilter === status} onClick={() => setTicketFilter(status)}>{status}</button>)}
                    </div>
                    <div className="fleet-ticket-list">
                      {filteredTickets.filter((ticket) => ticketFilter === 'All' || (ticketFilter === 'Active' ? ticket.status !== 'Resolved' : ticket.status === ticketFilter)).map((ticket) => {
                        const vehicle = fleet.vehicles.find((item) => item.id === ticket.vehicleId)
                        const daysOpen = elapsedDays(ticket.createdAt)
                        const serviceOverdue = ticket.status === 'Scheduled' && ticket.scheduledFor && ticket.scheduledFor < new Date().toISOString().slice(0, 10)
                        return (
                          <article className={'fleet-ticket ' + (selectedTicketId === ticket.id ? 'is-highlighted' : '') + (serviceOverdue ? ' is-overdue' : '')} key={ticket.id}>
                            <div className="fleet-ticket__top"><div><span className="fleet-ticket__unit">{vehicle?.unit ?? ticket.vehicleId} · {vehicle?.department}</span><h3>{ticket.title}</h3></div><Tone tone={ticket.severity.toLowerCase()}>{ticket.severity} priority</Tone></div>
                            <p>{ticket.description}</p>
                            <div className="fleet-ticket__meta">
                              <span><Clock3 size={15} /> Opened {dateLabel(ticket.createdAt)} · {daysOpen}d ago</span>
                              <span><UserRound size={15} /> {ticket.assignee || 'Unassigned'}</span>
                              {ticket.scheduledFor && <span className={serviceOverdue ? 'fleet-urgency' : ''}><CalendarDays size={15} /> Service {dateLabel(ticket.scheduledFor)}{serviceOverdue ? ' · overdue' : ''}</span>}
                              {ticket.sourceReportId && <span><FileText size={14} /> Raised from monthly report</span>}
                              {ticket.actualCost !== undefined && <span><Fuel size={15} /> Service cost {currency(ticket.actualCost)}</span>}
                              {ticket.resolvedAt && <span><CheckCircle2 size={15} /> Resolved {dateLabel(ticket.resolvedAt)}</span>}
                            </div>
                            {ticket.resolutionNote && <p className="fleet-ticket__resolution"><CheckCircle2 size={15} /> <span>Resolution: {ticket.resolutionNote}</span></p>}
                            <div className="fleet-ticket__bottom">
                              <Tone tone={ticket.status.toLowerCase()}>{ticket.status}</Tone>
                              <button type="button" className="fleet-button fleet-button--small fleet-button--quiet" onClick={() => serviceEditId === ticket.id ? setServiceEditId(null) : beginServiceEdit(ticket)} aria-expanded={serviceEditId === ticket.id}><Settings2 size={16} /> {serviceEditId === ticket.id ? 'Close editor' : 'Update work'} <ChevronDown size={15} /></button>
                            </div>
                            {serviceEditId === ticket.id && (
                              <form className="fleet-form fleet-maintenance-editor" onSubmit={(event) => handleServiceUpdate(event, ticket)}>
                                <div className="fleet-maintenance-editor__heading"><h4>Service follow-through</h4><p>Changes are recorded in the local audit. A resolved ticket still requires an explicit administrative release from any vehicle service hold.</p></div>
                                <div className="fleet-form-grid">
                                  <Field label="Work status" htmlFor={'fleet-service-status-' + ticket.id}><select id={'fleet-service-status-' + ticket.id} className="fleet-select" value={serviceEdit.status} onChange={(event) => setServiceEdit((draft) => ({ ...draft, status: event.target.value as TicketStatus }))}>{TICKET_STATUSES.map((status) => <option key={status}>{status}</option>)}</select></Field>
                                  <Field label="Assigned technician / team" htmlFor={'fleet-service-assignee-' + ticket.id}><input id={'fleet-service-assignee-' + ticket.id} className="fleet-input" maxLength={80} value={serviceEdit.assignee} placeholder="Garage team" onChange={(event) => setServiceEdit((draft) => ({ ...draft, assignee: event.target.value }))} /></Field>
                                  <Field label="Scheduled service date" htmlFor={'fleet-service-date-' + ticket.id}><input id={'fleet-service-date-' + ticket.id} className="fleet-input" type="date" value={serviceEdit.scheduledFor} required={serviceEdit.status === 'Scheduled'} onChange={(event) => setServiceEdit((draft) => ({ ...draft, scheduledFor: event.target.value }))} /></Field>
                                  <Field label="Actual service cost (USD)" htmlFor={'fleet-service-cost-' + ticket.id}><input id={'fleet-service-cost-' + ticket.id} className="fleet-input" type="number" min={0} step="0.01" value={serviceEdit.actualCost} placeholder="Optional" onChange={(event) => setServiceEdit((draft) => ({ ...draft, actualCost: event.target.value }))} /></Field>
                                  <Field label="Repair outcome / resolution note" htmlFor={'fleet-service-resolution-' + ticket.id} hint="Required when marking resolved. Record the action performed and any follow-up." className="fleet-field--full"><textarea id={'fleet-service-resolution-' + ticket.id} className="fleet-textarea" maxLength={1000} rows={3} required={serviceEdit.status === 'Resolved'} value={serviceEdit.resolutionNote} placeholder="Explain service performed, parts, testing, or next steps" onChange={(event) => setServiceEdit((draft) => ({ ...draft, resolutionNote: event.target.value }))} /></Field>
                                </div>
                                <div className="fleet-form-actions"><button className="fleet-button fleet-button--primary" type="submit"><Check size={16} /> Save service update</button><button type="button" className="fleet-button fleet-button--quiet" onClick={() => setServiceEditId(null)}>Cancel</button></div>
                              </form>
                            )}
                          </article>
                        )
                      })}
                      {!filteredTickets.some((ticket) => ticketFilter === 'All' || (ticketFilter === 'Active' ? ticket.status !== 'Resolved' : ticket.status === ticketFilter)) && <Empty icon={CheckCircle2} title="No issues in this queue" description="No maintenance tickets match the selected status and department." />}
                    </div>
                  </FleetCard>
                  <div className="fleet-stack">
                    {ticketFormOpen && (
                      <FleetCard className="fleet-create-card">
                        <SectionTitle eyebrow="NEW SERVICE ISSUE" title="Create a maintenance ticket" action={<button type="button" className="fleet-icon-button" aria-label="Close maintenance issue form" onClick={() => setTicketFormOpen(false)}><X size={19} /></button>} />
                        <form className="fleet-form" onSubmit={handleAddTicket}>
                          <Field label="Vehicle" htmlFor="fleet-new-ticket-vehicle"><select className="fleet-select" id="fleet-new-ticket-vehicle" value={ticketDraft.vehicleId} required onChange={(event) => setTicketDraft((draft) => ({ ...draft, vehicleId: event.target.value }))}>{filteredVehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.unit} · {vehicle.make} {vehicle.model}</option>)}</select></Field>
                          <Field label="Issue title" htmlFor="fleet-new-ticket-title"><input className="fleet-input" id="fleet-new-ticket-title" maxLength={100} required value={ticketDraft.title} placeholder="e.g. Brake system inspection" onChange={(event) => setTicketDraft((draft) => ({ ...draft, title: event.target.value }))} /></Field>
                          <Field label="Severity" htmlFor="fleet-new-ticket-severity"><select className="fleet-select" id="fleet-new-ticket-severity" value={ticketDraft.severity} onChange={(event) => setTicketDraft((draft) => ({ ...draft, severity: event.target.value as Severity }))}>{SEVERITIES.map((severity) => <option key={severity}>{severity}</option>)}</select></Field>
                          <Field label="Assigned to (optional)" htmlFor="fleet-new-ticket-assignee"><input className="fleet-input" id="fleet-new-ticket-assignee" maxLength={80} value={ticketDraft.assignee} placeholder="Demo garage team" onChange={(event) => setTicketDraft((draft) => ({ ...draft, assignee: event.target.value }))} /></Field>
                          <Field label="Description" htmlFor="fleet-new-ticket-description"><textarea className="fleet-textarea" id="fleet-new-ticket-description" rows={4} maxLength={1200} required value={ticketDraft.description} placeholder="Describe the issue, symptoms and follow-up needed" onChange={(event) => setTicketDraft((draft) => ({ ...draft, description: event.target.value }))} /></Field>
                          <div className="fleet-form-actions fleet-form__actions"><button type="submit" className="fleet-button fleet-button--primary"><Plus size={17} /> Create issue</button></div>
                        </form>
                      </FleetCard>
                    )}
                    <FleetCard className="fleet-maintenance-summary">
                      <SectionTitle eyebrow="MAINTENANCE STATUS" title="Service at a glance" />
                      <div className="fleet-ticket-counts">
                        <div><span className="fleet-ticket-counts__dot fleet-ticket-counts__dot--open" /><strong>{filteredTickets.filter((ticket) => ticket.status === 'Open').length}</strong><small>Open</small></div>
                        <div><span className="fleet-ticket-counts__dot fleet-ticket-counts__dot--scheduled" /><strong>{filteredTickets.filter((ticket) => ticket.status === 'Scheduled').length}</strong><small>Scheduled</small></div>
                        <div><span className="fleet-ticket-counts__dot fleet-ticket-counts__dot--resolved" /><strong>{filteredTickets.filter((ticket) => ticket.status === 'Resolved').length}</strong><small>Resolved</small></div>
                      </div>
                      <p className="fleet-text-muted">A reported vehicle condition requiring attention automatically creates a service ticket when one is not already active for that report.</p>
                      {!ticketFormOpen && <button type="button" className="fleet-button fleet-button--quiet fleet-button--block" onClick={() => { setTicketDraft(blankTicketDraft(filteredVehicles[0]?.id)); setTicketFormOpen(true) }}><Plus size={16} /> Log a service issue</button>}
                    </FleetCard>
                    <FleetCard className="fleet-warning-card">
                      <h3>Service holds and safety reports</h3><p>Unsafe driver reports generate a high-priority work order and set a demo service hold. Resolving the work order does not automatically release the vehicle. Real safety decisions remain outside this prototype.</p>
                    </FleetCard>
                  </div>
                </div>
              </>
            )}

            {view === 'exports' && (
              <>
                <div className="fleet-banner fleet-banner--warning fleet-export-disclaimer"><AlertTriangle size={21} /><div><strong>Internal review staging only. No state submission.</strong><p>Monthly and fiscal quarterly CSV worksheets are fictional administrative reconciliation aids. They are not validated TxFS batch layouts, have not been certified by Texas OVFM, and are never transmitted to state systems.</p></div></div>
                <FleetCard className="fleet-quarterly-panel">
                  <SectionTitle
                    eyebrow="FISCAL QUARTER RECONCILIATION"
                    title="Three-month readiness"
                    description="Texas-style fiscal quarters run September–November, December–February, March–May, and June–August. Only licensed vehicles are counted in this staging review."
                    action={<Tone tone={quarterData.completion === 100 ? 'approved' : 'pending'}>{fiscalQuarterLabel(quarterScope.fiscalYear, quarterScope.quarter)}</Tone>}
                  />
                  <p className="fleet-text-muted fleet-quarterly-current-note">In-progress quarters may show missing months that are not yet overdue. Department monthly due dates are fictional demo settings and separate from the state's quarterly submission window.</p>
                  <div className="fleet-quarterly-controls">
                    <Field label="Fiscal year" htmlFor="fleet-quarter-year">
                      <select id="fleet-quarter-year" className="fleet-select" value={quarterScope.fiscalYear} onChange={(event) => setQuarterScope((previous) => ({ ...previous, fiscalYear: Number(event.target.value) }))}>
                        {Array.from(new Set([fiscalQuarterForPeriod(currentPeriod()).fiscalYear, quarterScope.fiscalYear, ...Array.from({ length: 4 }, (_, index) => fiscalQuarterForPeriod(currentPeriod()).fiscalYear - index - 1)])).sort((a, b) => b - a).map((year) => <option key={year} value={year}>FY {year}</option>)}
                      </select>
                    </Field>
                    <Field label="Fiscal quarter" htmlFor="fleet-quarter-number">
                      <select id="fleet-quarter-number" className="fleet-select" value={quarterScope.quarter} onChange={(event) => setQuarterScope((previous) => ({ ...previous, quarter: Number(event.target.value) as 1 | 2 | 3 | 4 }))}>
                        {[1, 2, 3, 4].map((quarter) => <option key={quarter} value={quarter}>Quarter {quarter}</option>)}
                      </select>
                    </Field>
                    <span className="fleet-quarterly-controls__due"><CalendarDays size={17} /> Statutory quarterly filing window: {dateLabel(quarterData.windowOpens)} – {dateLabel(quarterData.dueDate)} (45–60 days after quarter end)</span>
                  </div>
                  <div className="fleet-quarterly-stats" aria-label="Quarterly completeness totals">
                    <div><strong>{quarterData.completion}%</strong><span>Month records approved</span></div>
                    <div><strong>{quarterData.approved}/{quarterData.expected}</strong><span>Approved / expected</span></div>
                    <div><strong>{quarterData.readyVehicles}/{quarterData.vehicles.length}</strong><span>Vehicles complete (all 3)</span></div>
                    <div><strong>{quarterData.missing + quarterData.returned + quarterData.pending}</strong><span>Gaps to reconcile</span></div>
                  </div>
                  <div className="fleet-progress" role="progressbar" aria-label="Quarterly monthly record approval completeness" aria-valuenow={quarterData.completion} aria-valuemin={0} aria-valuemax={100}><span style={{ width: quarterData.completion + '%' }} /></div>
                  <div className="fleet-quarterly-months">
                    {quarterMonths.map((month) => {
                      const approved = quarterData.vehicles.filter((item) => item.monthlyStatus[month] === 'Approved').length
                      const pending = quarterData.vehicles.filter((item) => item.monthlyStatus[month] === 'Pending').length
                      const returned = quarterData.vehicles.filter((item) => item.monthlyStatus[month] === 'Returned').length
                      const missing = quarterData.vehicles.filter((item) => item.monthlyStatus[month] === 'Missing').length
                      return (
                        <div className={'fleet-quarterly-month ' + (month > currentPeriod() ? 'is-upcoming' : '')} key={month}>
                          <h3>{displayPeriod(month)}</h3>
                          {month > currentPeriod() && <span className="fleet-eyebrow">UPCOMING MONTH</span>}
                          <div className="fleet-quarterly-month__counts"><strong>{approved}/{quarterData.vehicles.length}</strong><span>Approved</span></div>
                          <div className="fleet-quarterly-month__detail">{pending > 0 && <Tone tone="pending">{pending} pending</Tone>}{returned > 0 && <Tone tone="returned">{returned} returned</Tone>}{missing > 0 && <Tone tone="muted">{missing} missing</Tone>}{approved === quarterData.vehicles.length && <Tone tone="approved">Complete</Tone>}</div>
                        </div>
                      )
                    })}
                  </div>
                  <div className="fleet-quarterly-grid">
                    <SectionTitle eyebrow="RECONCILIATION MATRIX" title="Vehicle-by-month status" description="Open each missing, returned or pending month to complete the workflow. Approved rows are read-only." action={<button type="button" className="fleet-button fleet-button--primary" disabled={!quarterExport.count} onClick={downloadQuarterCsv}><Download size={16} /> Download quarter review ({quarterExport.count})</button>} />
                    <div className="fleet-table-wrap">
                      <table className="fleet-table fleet-quarterly-reconcile">
                        <thead><tr><th scope="col">Licensed vehicle</th>{quarterMonths.map((month) => <th scope="col" key={month}>{displayPeriod(month)}</th>)}<th scope="col">Quarter total</th><th scope="col">Reconciliation</th></tr></thead>
                        <tbody>{quarterData.vehicles.slice().sort((a, b) => Number(a.ready) - Number(b.ready) || a.vehicle.unit.localeCompare(b.vehicle.unit)).map((row) => (
                          <tr key={row.vehicle.id} className={row.ready ? 'is-ready' : 'has-gaps'}>
                            <td><VehicleName vehicle={row.vehicle} /><small className="fleet-table__meta">{row.vehicle.department}</small></td>
                            {quarterMonths.map((month) => {
                              const status = row.monthlyStatus[month]
                              return (
                                <td key={month}>
                                  {status === 'Approved'
                                    ? <Tone tone="approved"><Check size={12} /> Approved</Tone>
                                    : <button type="button" className="fleet-quarterly-gap" aria-label={status + ' for ' + row.vehicle.unit + ' in ' + displayPeriod(month) + '. Open workflow'} onClick={() => openQuarterGap(row.vehicle, month)} disabled={month > currentPeriod()}>
                                      <Tone tone={status === 'Missing' ? 'muted' : status.toLowerCase()}>{status}</Tone><ArrowRight size={14} />
                                    </button>}
                                </td>
                              )
                            })}
                            <td><strong>{whole(row.miles)} mi</strong><small className="fleet-table__meta">{currency(row.fuelCost)}</small></td>
                            <td><Tone tone={row.ready ? 'approved' : 'returned'}>{row.ready ? 'All 3 approved' : row.approvedMonths + ' of 3 approved'}</Tone></td>
                          </tr>
                        ))}</tbody>
                      </table>
                    </div>
                    {!quarterData.vehicles.length && <Empty icon={Truck} title="No licensed vehicles in this scope" description="Choose another department or add a licensed vehicle to include it in the quarter reconciliation." />}
                    <p className="fleet-text-muted">Quarter review CSV includes all licensed vehicles and missing or incomplete months for reconciliation. It is not an official TxFS import or proof of submission.</p>
                  </div>
                </FleetCard>
                <div className="fleet-kpi-grid fleet-kpi-grid--three">
                  {[
                    { label: 'Approved reports', value: String(metrics.approved), icon: FileCheck2 },
                    { label: 'Monthly review rows', value: String(exportData.count), icon: FileSpreadsheet },
                    { label: 'Licensed rows not approved', value: String(Math.max(0, metrics.licensed - exportData.count)), icon: AlertCircle },
                  ].map((item) => { const Icon = item.icon; return <div className="fleet-kpi-card" key={item.label}><div className="fleet-kpi-top fleet-kpi-card__top"><span className="fleet-kpi-label">{item.label}</span><span className="fleet-kpi-icon"><Icon size={22} /></span></div><strong className="fleet-kpi-value fleet-kpi-card__value">{item.value}</strong><small className="fleet-kpi-bottom">{displayPeriod(period)}</small></div> })}
                </div>
                <FleetCard className="fleet-export-card">
                  <SectionTitle eyebrow="MONTHLY WORKSHEET · SEPARATE FROM QUARTERLY" title="Approved vehicle usage preview" description="Only approved records for licensed vehicles in the selected reporting month. This is a separate internal review CSV." action={<button type="button" className="fleet-button fleet-button--primary" disabled={!exportData.count} onClick={downloadCsv}><ArrowDownToLine size={17} /> Download monthly review ({exportData.count})</button>} />
                  <div className="fleet-table-wrap">
                    <table className="fleet-table">
                      <thead><tr><th scope="col">Unit</th><th scope="col">Department</th><th scope="col">Period</th><th scope="col">Distance</th><th scope="col">Fuel</th><th scope="col">Reviewed by</th></tr></thead>
                      <tbody>{exportRecords.map((report) => {
                        const vehicle = fleet.vehicles.find((item) => item.id === report.vehicleId)
                        return <tr key={report.id}><td><strong>{vehicle?.unit}</strong></td><td>{vehicle?.department}</td><td>{displayPeriod(report.period)}</td><td>{whole(report.endOdometer - report.startOdometer)} mi</td><td>{currency(report.fuelCost)}</td><td>{report.reviewedBy ?? '—'}</td></tr>
                      })}</tbody>
                    </table>
                  </div>
                  {!exportRecords.length && <Empty icon={FileSpreadsheet} title="No export-ready records" description="Only approved monthly reports for licensed vehicles will appear here." action={<button type="button" className="fleet-button fleet-button--quiet" onClick={() => { setReportsTab('review'); changePage('reports') }}>Review reports <ArrowRight size={16} /></button>} />}
                </FleetCard>
                <FleetCard className="fleet-audit-card">
                  <SectionTitle eyebrow="TRACEABILITY" title="Activity & audit log" description="Locally recorded demo actions. This log is illustrative and has no tamper protection or server validation." action={<Tone tone="muted">{auditEntries.length} entries</Tone>} />
                  <div className="fleet-search fleet-audit-search"><Search size={18} /><label className="fleet-sr-only" htmlFor="fleet-audit-search">Search audit activity</label><input id="fleet-audit-search" className="fleet-input" type="search" placeholder="Search actions, actors, and details..." value={auditSearch} onChange={(event) => setAuditSearch(event.target.value)} /></div>
                  <div className="fleet-audit-list">
                    {auditEntries.map((entry) => (
                      <div className="fleet-audit-row" key={entry.id}>
                        <div className="fleet-audit-row__copy"><strong>{entry.action}</strong><p>{entry.detail}</p><small>By {entry.actor}</small></div>
                        <time dateTime={entry.at} className="fleet-audit-row__date">{timestamp(entry.at)}</time>
                      </div>
                    ))}
                    {!auditEntries.length && <Empty icon={History} title="No matching activity" description="Clear the search or choose another department." />}
                  </div>
                </FleetCard>
              </>
            )}
          </div>
        </main>
      </div>
      {toasts.length > 0 && (
        <div className="fleet-toast-stack" aria-live="polite" aria-atomic="false">
          {toasts.map((item) => (
            <div className={'fleet-toast fleet-toast--' + item.kind} role={item.kind === 'error' ? 'alert' : 'status'} key={item.id}>
              {item.kind === 'error' ? <AlertCircle size={19} /> : item.kind === 'success' ? <CheckCircle2 size={19} /> : <Info size={19} />}
              <span>{item.message}</span>
              <button type="button" aria-label="Dismiss message" onClick={() => setToasts((current) => current.filter((toastItem) => toastItem.id !== item.id))}><X size={16} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
