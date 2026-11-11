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
  getOpenFollowUps,
  getReportHistory,
  getReportQualityIssues,
  getTicketHistory,
  loadFleetState,
  monthlyTrends as getMonthlyTrends,
  quarterReadiness,
  recordExportPreparation,
  recordReportFollowUp,
  reopenApprovedReportForCorrection,
  updateReportFollowUp,
  requiresMonthlyReport,
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
  FollowUp,
  MaintenanceTicket,
  MonthlyReport,
  ReportHistoryEntry,
  ReportInput,
  Role,
  Severity,
  TicketInput,
  TicketHistoryEntry,
  TicketStatus,
  Vehicle,
  VehicleCondition,
  VehicleInput,
  VehicleKind,
  VehicleStatus,
} from './domain'
import { sharedClient, SharedApiError } from './shared-client'
import type { SharedCommand, SharedImportPreview, SharedUser } from './shared-client'
import './styles.css'

type View = 'overview' | 'reports' | 'vehicles' | 'maintenance' | 'exports'
type ReportsTab = 'submit' | 'review' | 'history'
type TicketFilter = 'Active' | 'All' | TicketStatus
type ExceptionFilter = 'All' | 'Reports' | 'Service'
const UI_STORAGE_KEY = 'fleetsync-operations-ui-v1'

type SavedFilters = {
  period: string
  department: string
  vehicleSearch: string
  auditSearch: string
  exceptionFilter: ExceptionFilter
  ticketFilter: TicketFilter
  quarterScope: { fiscalYear: number; quarter: 1 | 2 | 3 | 4 }
  quarterQualityFilter: 'All' | 'Incomplete' | 'Quality'
  showClosedFollowUps: boolean
}

function restoreFilters(): SavedFilters {
  const defaults: SavedFilters = {
    period: currentPeriod(),
    department: 'All departments',
    vehicleSearch: '',
    auditSearch: '',
    exceptionFilter: 'All',
    ticketFilter: 'Active',
    quarterScope: fiscalQuarterForPeriod(currentPeriod()),
    quarterQualityFilter: 'All',
    showClosedFollowUps: false,
  }
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(UI_STORAGE_KEY) ?? 'null')
    if (!parsed || typeof parsed !== 'object') return defaults
    const value = parsed as Partial<SavedFilters>
    return {
      period: typeof value.period === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value.period) && value.period <= currentPeriod() ? value.period : defaults.period,
      department: typeof value.department === 'string' && value.department.length <= 80 ? value.department : defaults.department,
      vehicleSearch: typeof value.vehicleSearch === 'string' ? value.vehicleSearch.slice(0, 120) : '',
      auditSearch: typeof value.auditSearch === 'string' ? value.auditSearch.slice(0, 120) : '',
      exceptionFilter: value.exceptionFilter === 'Reports' || value.exceptionFilter === 'Service' ? value.exceptionFilter : 'All',
      ticketFilter: value.ticketFilter && (value.ticketFilter === 'All' || value.ticketFilter === 'Active' || TICKET_STATUSES.includes(value.ticketFilter as TicketStatus))
        ? value.ticketFilter : 'Active',
      quarterScope: value.quarterScope && Number.isInteger(value.quarterScope.fiscalYear) && value.quarterScope.fiscalYear >= 2000 && value.quarterScope.fiscalYear <= 2200 &&
        [1, 2, 3, 4].includes(value.quarterScope.quarter)
        ? value.quarterScope : fiscalQuarterForPeriod(typeof value.period === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value.period) ? value.period : currentPeriod()),
      quarterQualityFilter: value.quarterQualityFilter === 'Incomplete' || value.quarterQualityFilter === 'Quality' ? value.quarterQualityFilter : 'All',
      showClosedFollowUps: value.showClosedFollowUps === true,
    }
  } catch {
    return defaults
  }
}

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
  reopenReason: string
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
  const candidates = state.vehicles.filter((vehicle) => requiresMonthlyReport(vehicle, period) && (department === 'All departments' || vehicle.department === department))
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
    reopenReason: '',
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

function localDateOffset(days: number) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-')
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

function FleetCard({ className = '', children, role, id }: { className?: string; children: ReactNode; role?: 'tabpanel'; id?: string }) {
  return <section id={id} tabIndex={id ? -1 : undefined} role={role} className={'fleet-card ' + className + (id ? ' fleet-record-anchor' : '')}>{children}</section>
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

function ReportHistoryLedger({ entries }: { entries: ReportHistoryEntry[] }) {
  return (
    <section className="fleet-history-ledger" aria-label="Report correction and approval history">
      <h3>Submission and correction history</h3>
      <p className="fleet-text-muted">Saved local snapshots, newest first. Prior revisions are retained when reports are returned and resubmitted.</p>
      {entries.length ? (
        <ol className="fleet-history-ledger__entries">
          {entries.map((entry) => (
            <li className="fleet-history-entry" key={entry.id}>
              <div className="fleet-history-entry__heading">
                <strong>Revision {entry.revision} · {entry.action}</strong>
                <time dateTime={entry.at}>{timestamp(entry.at)}</time>
              </div>
              <div className="fleet-history-entry__meta">
                <span>By {entry.actor}</span>
                <Tone tone={entry.snapshot.status.toLowerCase()}>{entry.snapshot.status}</Tone>
                <span>{whole(entry.snapshot.startOdometer)} → {whole(entry.snapshot.endOdometer)} mi</span>
                <span>{entry.snapshot.condition}</span>
              </div>
              {entry.snapshot.reviewNote && <p><strong>Review feedback:</strong> {entry.snapshot.reviewNote}</p>}
              {entry.snapshot.notes && <p><strong>Report notes:</strong> {entry.snapshot.notes}</p>}
            </li>
          ))}
        </ol>
      ) : <p className="fleet-text-muted">No saved history snapshots are available for this record.</p>}
    </section>
  )
}

function TicketHistoryLedger({ entries }: { entries: TicketHistoryEntry[] }) {
  return (
    <section className="fleet-history-ledger fleet-work-order-history" aria-label="Work order status and resolution history">
      <h4>Work order activity</h4>
      {entries.length ? (
        <ol className="fleet-history-ledger__entries">
          {entries.map((entry) => (
            <li className="fleet-history-entry" key={entry.id}>
              <div className="fleet-history-entry__heading"><strong>{entry.action}</strong><time dateTime={entry.at}>{timestamp(entry.at)}</time></div>
              <div className="fleet-history-entry__meta">
                <span>By {entry.actor}</span>
                <Tone tone={entry.snapshot.status.toLowerCase()}>{entry.snapshot.status}</Tone>
                <span>{entry.snapshot.assignee || 'Unassigned'}</span>
                {entry.snapshot.scheduledFor && <span>Scheduled {dateLabel(entry.snapshot.scheduledFor)}</span>}
              </div>
              {entry.snapshot.resolutionNote && <p><strong>Resolution:</strong> {entry.snapshot.resolutionNote}</p>}
            </li>
          ))}
        </ol>
      ) : <p className="fleet-text-muted">No saved changes for this work order.</p>}
    </section>
  )
}

export default function FleetApp() {
  const [fleet, setFleet] = useState<FleetState>(() => loadFleetState())
  const fleetRef = useRef(fleet)
  const demoSnapshotRef = useRef(fleet)
  const demoRoleRef = useRef<Role>('Fleet Admin')
  const importCandidateRef = useRef<FleetState | null>(null)
  const sharedRevisionRef = useRef<number | null>(null)
  const preserveDraftOnRefreshRef = useRef(false)
  const busyRef = useRef(false)
  const [connectionMode, setConnectionMode] = useState<'demo' | 'shared'>('demo')
  const sharedMode = connectionMode === 'shared'
  const [sharedStatus, setSharedStatus] = useState<'checking' | 'login' | 'ready' | 'error'>('login')
  const [sharedUser, setSharedUser] = useState<SharedUser | null>(null)
  const [sharedBusy, setSharedBusy] = useState(false)
  const [sharedError, setSharedError] = useState('')
  const [sharedUsername, setSharedUsername] = useState('')
  const [sharedPassword, setSharedPassword] = useState('')
  const [importPreview, setImportPreview] = useState<SharedImportPreview | null>(null)
  const [importConfirmed, setImportConfirmed] = useState(false)
  const [importPanelOpen, setImportPanelOpen] = useState(false)
  const [initialFilters] = useState(restoreFilters)
  const [role, setRole] = useState<Role>('Fleet Admin')
  const [view, setView] = useState<View>('overview')
  const [period, setPeriod] = useState(initialFilters.period)
  const [department, setDepartment] = useState(initialFilters.department)
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
  const [expandedReportId, setExpandedReportId] = useState<string | null>(null)
  const [vehicleSearch, setVehicleSearch] = useState(initialFilters.vehicleSearch)
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(fleet.vehicles[0]?.id ?? null)
  const [vehicleFormOpen, setVehicleFormOpen] = useState(false)
  const [vehicleDraft, setVehicleDraft] = useState<VehicleDraft>(blankVehicleDraft)
  const [ticketFilter, setTicketFilter] = useState<TicketFilter>(initialFilters.ticketFilter)
  const [workSearch, setWorkSearch] = useState('')
  const [workPriority, setWorkPriority] = useState<'All' | Severity>('All')
  const [workAssignment, setWorkAssignment] = useState<'All' | 'Mine' | 'Unassigned'>('All')
  const [ticketFormOpen, setTicketFormOpen] = useState(false)
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null)
  const [expandedTicketHistoryId, setExpandedTicketHistoryId] = useState<string | null>(null)
  const [ticketDraft, setTicketDraft] = useState<TicketDraft>(() => blankTicketDraft(fleet.vehicles[0]?.id))
  const [auditSearch, setAuditSearch] = useState(initialFilters.auditSearch)
  const [showAllExceptions, setShowAllExceptions] = useState(false)
  const [exceptionFilter, setExceptionFilter] = useState<ExceptionFilter>(initialFilters.exceptionFilter)
  const [editingDepartment, setEditingDepartment] = useState<string | null>(null)
  const [departmentDraft, setDepartmentDraft] = useState<DepartmentDraft>({ coordinator: '', contact: '', monthlyDueDay: 5, notes: '' })
  const [followUpFor, setFollowUpFor] = useState<string | null>(null)
  const [followUpNote, setFollowUpNote] = useState('')
  const [followUpActor, setFollowUpActor] = useState('Demo Fleet Coordinator')
  const [followUpOwner, setFollowUpOwner] = useState('')
  const [followUpDueOn, setFollowUpDueOn] = useState(() => localDateOffset(3))
  const [editingFollowUpId, setEditingFollowUpId] = useState<string | null>(null)
  const [taskActor, setTaskActor] = useState('Demo Fleet Coordinator')
  const [taskOwner, setTaskOwner] = useState('')
  const [taskDueOn, setTaskDueOn] = useState(() => localDateOffset(3))
  const [taskOutcome, setTaskOutcome] = useState('')
  const [showClosedFollowUps, setShowClosedFollowUps] = useState(initialFilters.showClosedFollowUps)
  const [vehicleEditId, setVehicleEditId] = useState<string | null>(null)
  const [vehicleEditDraft, setVehicleEditDraft] = useState<VehicleDraft>(blankVehicleDraft)
  const [vehicleStatusDraft, setVehicleStatusDraft] = useState<VehicleStatus>('Active')
  const [vehicleStatusNote, setVehicleStatusNote] = useState('')
  const [serviceEditId, setServiceEditId] = useState<string | null>(null)
  const [serviceEdit, setServiceEdit] = useState<ServiceEdit>({ status: 'Open', assignee: '', scheduledFor: '', resolutionNote: '', actualCost: '', reopenReason: '' })
  const [quarterScope, setQuarterScope] = useState(initialFilters.quarterScope)
  const [quarterQualityFilter, setQuarterQualityFilter] = useState<'All' | 'Incomplete' | 'Quality'>(initialFilters.quarterQualityFilter)
  const [expandedQualityVehicleId, setExpandedQualityVehicleId] = useState<string | null>(null)
  const [correctionRequest, setCorrectionRequest] = useState<{ reportId: string; vehicleId: string; period: string; reason: string } | null>(null)
  const [focusTarget, setFocusTarget] = useState<string | null>(null)
  // Demo role switching changes the workspace presentation, never permissions.
  // Shared role and all actual action permissions are enforced by the server.
  const canSubmit = role === 'Driver' || (!sharedMode && role === 'Fleet Admin')
  const canReview = role === 'Supervisor' || role === 'Fleet Admin'
  const canManageFleet = role === 'Fleet Admin'
  const canManageService = role === 'Maintenance' || role === 'Fleet Admin'
  const canManageFollowUps = role === 'Supervisor' || role === 'Fleet Admin'
  const navItems = NAV.filter((item) => {
    if (role === 'Driver') return item.id === 'reports'
    if (item.id === 'exports') return canManageFleet
    if (item.id === 'reports') return canSubmit || canReview
    if (item.id === 'maintenance') return canManageService
    if (item.id === 'overview') return role === 'Fleet Admin' || role === 'Supervisor'
    return true
  })

  const toast = useCallback((message: string, kind: Toast['kind'] = 'success') => {
    const id = ++nextToastId.current
    setToasts((current) => [...current.slice(-2), { id, message, kind }])
    const timer = setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), 5500)
    toastTimers.current.push(timer)
  }, [])

  useEffect(() => () => toastTimers.current.forEach(clearTimeout), [])

  useEffect(() => {
    if (department !== 'All departments' && !fleet.vehicles.some((vehicle) => vehicle.department === department) && !DEPARTMENTS.includes(department)) {
      setDepartment('All departments')
    }
  }, [department, fleet.vehicles])

  useEffect(() => {
    const filters: SavedFilters = { period, department, vehicleSearch, auditSearch, exceptionFilter, ticketFilter, quarterScope, quarterQualityFilter, showClosedFollowUps }
    try {
      window.localStorage.setItem(UI_STORAGE_KEY, JSON.stringify(filters))
    } catch {
      // Filtering remains usable in private browsing even if preferences cannot persist.
    }
  }, [period, department, vehicleSearch, auditSearch, exceptionFilter, ticketFilter, quarterScope, quarterQualityFilter, showClosedFollowUps])

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

  useEffect(() => {
    if (!focusTarget) return
    const frame = window.requestAnimationFrame(() => {
      const element = document.getElementById(focusTarget)
      if (!element) return
      element.scrollIntoView({ behavior: 'smooth', block: 'center' })
      element.focus({ preventScroll: true })
      setFocusTarget(null)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [focusTarget, view, reportsTab, ticketFilter, department, period])

  const setCurrentFleet = (next: FleetState) => {
    fleetRef.current = next
    setFleet(next)
  }

  const applySharedState = (result: { revision: number; state: FleetState }, preserveDraft = false) => {
    if (!Number.isInteger(result.revision) || !result.state || !Array.isArray(result.state.vehicles)) {
      throw new SharedApiError('The shared server returned an invalid fleet snapshot.', 0)
    }
    sharedRevisionRef.current = result.revision
    if (preserveDraft) preserveDraftOnRefreshRef.current = true
    setCurrentFleet(result.state)
  }

  const activateSharedUser = async (user: SharedUser) => {
    const snapshot = await sharedClient.state()
    setSharedUser(user)
    setRole(user.role)
    setReviewer(user.displayName)
    setFollowUpActor(user.displayName)
    setTaskActor(user.displayName)
    setSharedError('')
    setSharedStatus('ready')
    setImportPreview(null)
    setImportConfirmed(false)
    applySharedState(snapshot)
    setDepartment(user.department && user.role !== 'Fleet Admin' ? user.department : 'All departments')
    const preferred = preferredReportVehicle(snapshot.state, period, user.department ?? 'All departments')
    setReportVehicleId(preferred?.id ?? '')
    setReportDraft({
      ...reportDraftFor(snapshot.state, preferred, period),
      ...(user.role === 'Driver' ? { operator: user.displayName } : {}),
    })
    setSelectedVehicleId(snapshot.state.vehicles[0]?.id ?? null)
    setTicketDraft(blankTicketDraft(snapshot.state.vehicles[0]?.id))
    setReportsTab(user.role === 'Supervisor' || user.role === 'Fleet Admin' ? 'review' : 'submit')
    setWorkAssignment('All')
    setWorkPriority('All')
    setWorkSearch('')
    setView(user.role === 'Driver' || user.role === 'Supervisor' ? 'reports' : user.role === 'Maintenance' ? 'maintenance' : 'overview')
    setMobileNavOpen(false)
  }

  const openSharedRecords = async () => {
    if (busyRef.current) return
    setMobileNavOpen(false)
    if (!sharedMode) {
      demoSnapshotRef.current = fleetRef.current
      demoRoleRef.current = role
    }
    setConnectionMode('shared')
    setSharedStatus('checking')
    setSharedError('')
    busyRef.current = true
    setSharedBusy(true)
    try {
      const health = await sharedClient.health()
      if (health.shared !== true) throw new SharedApiError('Shared records are not enabled on this server.', 0)
      const session = await sharedClient.session()
      if (session.user) await activateSharedUser(session.user)
      else {
        setSharedStatus('login')
        setSharedUser(null)
      }
    } catch (error) {
      setSharedStatus('error')
      setSharedError(error instanceof Error ? error.message : 'Shared records could not be opened.')
    } finally {
      busyRef.current = false
      setSharedBusy(false)
    }
  }

  const loginToShared = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busyRef.current) return
    busyRef.current = true
    setSharedBusy(true)
    setSharedError('')
    try {
      const session = await sharedClient.login(sharedUsername.trim(), sharedPassword)
      setSharedPassword('')
      await activateSharedUser(session.user)
    } catch (error) {
      setSharedPassword('')
      setSharedStatus('login')
      setSharedError(error instanceof Error ? error.message : 'Could not sign in.')
    } finally {
      busyRef.current = false
      setSharedBusy(false)
    }
  }

  const leaveSharedRecords = () => {
    if (busyRef.current) return
    setConnectionMode('demo')
    setSharedUser(null)
    sharedRevisionRef.current = null
    setSharedStatus('login')
    setSharedError('')
    setSharedPassword('')
    setImportPreview(null)
    setImportConfirmed(false)
    setImportPanelOpen(false)
    importCandidateRef.current = null
    setCurrentFleet(demoSnapshotRef.current)
    setRole(demoRoleRef.current)
    setReviewer('Demo Supervisor')
    setFollowUpActor('Demo Fleet Coordinator')
    setTaskActor('Demo Fleet Coordinator')
    setDepartment('All departments')
    const preferred = preferredReportVehicle(demoSnapshotRef.current, period)
    setReportVehicleId(preferred?.id ?? '')
    setReportDraft(reportDraftFor(demoSnapshotRef.current, preferred, period))
    setSelectedVehicleId(demoSnapshotRef.current.vehicles[0]?.id ?? null)
    setTicketDraft(blankTicketDraft(demoSnapshotRef.current.vehicles[0]?.id))
    setView('overview')
    setMobileNavOpen(false)
    toast('Browser Demo restored. Shared sign-in remains active until you choose Log out; no records were copied.', 'info')
  }

  const logoutFromShared = async () => {
    if (busyRef.current) return
    busyRef.current = true
    setSharedBusy(true)
    setSharedError('')
    try {
      await sharedClient.logout()
      setSharedUser(null)
      setSharedStatus('login')
      sharedRevisionRef.current = null
      setSharedPassword('')
      setImportPreview(null)
      setImportConfirmed(false)
      setImportPanelOpen(false)
      importCandidateRef.current = null
      toast('Signed out of shared records. Local Demo data is unchanged.', 'info')
    } catch (error) {
      setSharedError(error instanceof Error ? error.message : 'Could not log out. Please retry.')
    } finally {
      busyRef.current = false
      setSharedBusy(false)
    }
  }

  const refreshSharedRecords = async () => {
    if (busyRef.current || !sharedMode || sharedStatus !== 'ready') return
    busyRef.current = true
    setSharedBusy(true)
    setSharedError('')
    try {
      applySharedState(await sharedClient.state(), true)
      toast('Shared records refreshed. Unsaved form inputs were preserved where possible.', 'info')
    } catch (error) {
      if (error instanceof SharedApiError && error.status === 401) {
        setSharedUser(null)
        setSharedStatus('login')
        sharedRevisionRef.current = null
      }
      setSharedError(error instanceof Error ? error.message : 'Shared records could not be refreshed. You can return to Demo.')
    } finally {
      busyRef.current = false
      setSharedBusy(false)
    }
  }

  const previewDemoImport = async () => {
    if (busyRef.current || !sharedUser || sharedUser.role !== 'Fleet Admin') return
    busyRef.current = true
    setSharedBusy(true)
    setSharedError('')
    setImportPreview(null)
    setImportConfirmed(false)
    try {
      const candidate = demoSnapshotRef.current
      const result = await sharedClient.importPreview(candidate)
      importCandidateRef.current = candidate
      setImportPreview(result)
    } catch (error) {
      importCandidateRef.current = null
      setSharedError(error instanceof Error ? error.message : 'Cannot preview browser data import.')
    } finally {
      busyRef.current = false
      setSharedBusy(false)
    }
  }

  const importDemoData = async () => {
    if (busyRef.current || !sharedUser || sharedUser.role !== 'Fleet Admin' || !importPreview?.allowed ||
      !importPreview.fingerprint || !importConfirmed || !importCandidateRef.current || sharedRevisionRef.current === null) return
    busyRef.current = true
    setSharedBusy(true)
    setSharedError('')
    try {
      const result = await sharedClient.importState(sharedRevisionRef.current, importCandidateRef.current, importPreview.fingerprint)
      applySharedState(result)
      setImportPreview(null)
      importCandidateRef.current = null
      setImportConfirmed(false)
      setImportPanelOpen(false)
      toast('Browser demo records imported into the previously empty shared database. This does not submit anything to TxFS.')
    } catch (error) {
      if (error instanceof SharedApiError && error.status === 409) {
        try {
          applySharedState(await sharedClient.state(), true)
          toast('Shared records changed while importing. Refreshed; preview again before retrying.', 'error')
        } catch {
          toast('The shared import conflicted and the latest shared records could not be loaded.', 'error')
        }
      } else setSharedError(error instanceof Error ? error.message : 'Shared import failed.')
      setImportPreview(null)
      importCandidateRef.current = null
      setImportConfirmed(false)
    } finally {
      busyRef.current = false
      setSharedBusy(false)
    }
  }

  /** Demo applies a local domain transition; Shared sends only one server-authorized command. */
  const commit = async (
    change: (current: FleetState) => FleetState,
    message: string,
    command?: SharedCommand,
  ): Promise<boolean> => {
    if (busyRef.current) return false
    if (sharedMode) {
      if (sharedStatus !== 'ready' || !sharedUser || sharedRevisionRef.current === null || !command) {
        toast('Sign in to shared records before making a change.', 'error')
        return false
      }
      busyRef.current = true
      setSharedBusy(true)
      try {
        const result = await sharedClient.action(sharedRevisionRef.current, command)
        applySharedState(result)
        setSharedError('')
        toast(message.replace(/in (this |your )?local demo(?: fleet)?/ig, 'in shared records')
          .replace(/demo supervisor queue/ig, 'shared supervisor queue').replace(/saved locally/ig, 'saved to shared records'))
        return true
      } catch (error) {
        if (error instanceof SharedApiError && error.status === 409) {
          try {
            applySharedState(await sharedClient.state(), true)
            toast('Changes from another session; refreshed, retry. Your draft has been preserved where possible.', 'error')
          } catch (refreshError) {
            toast('Changes from another session. Refresh failed: ' + (refreshError instanceof Error ? refreshError.message : 'Server unavailable'), 'error')
          }
        } else {
          if (error instanceof SharedApiError && error.status === 401) {
            setSharedUser(null)
            setSharedStatus('login')
            sharedRevisionRef.current = null
          }
          if (error instanceof SharedApiError && error.status === 0) setSharedError(error.message)
          toast(error instanceof Error ? error.message : 'Could not save the shared change.', 'error')
        }
        return false
      } finally {
        busyRef.current = false
        setSharedBusy(false)
      }
    }
    try {
      const next = change(fleetRef.current)
      // Write before updating the view so a quota/private-mode failure cannot
      // make a user believe a record persisted when it did not.
      saveFleetState(next)
      demoSnapshotRef.current = next
      setCurrentFleet(next)
      toast(message)
      return true
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not save the change.', 'error')
      return false
    }
  }

  const departments = useMemo(
    () => sharedMode && sharedUser?.department && sharedUser.role !== 'Fleet Admin'
      ? [sharedUser.department]
      : Array.from(new Set([...DEPARTMENTS, ...fleet.vehicles.map((vehicle) => vehicle.department)])).sort(),
    [fleet.vehicles, sharedMode, sharedUser],
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
  const visibleMaintenanceTickets = useMemo(() => filteredTickets.filter((ticket) => {
    if (ticketFilter === 'Active' ? ticket.status === 'Resolved' : ticketFilter !== 'All' && ticket.status !== ticketFilter) return false
    if (workPriority !== 'All' && ticket.severity !== workPriority) return false
    if (workAssignment === 'Unassigned' && ticket.assignee) return false
    if (workAssignment === 'Mine') {
      const assignee = ticket.assignee?.trim().toLowerCase()
      if (!assignee || !sharedUser || (assignee !== sharedUser.displayName.toLowerCase() && assignee !== sharedUser.username.toLowerCase())) return false
    }
    const vehicle = fleet.vehicles.find((unit) => unit.id === ticket.vehicleId)
    const q = workSearch.trim().toLowerCase()
    return !q || [ticket.title, ticket.description, ticket.assignee, vehicle?.unit, vehicle?.department, ticket.status]
      .some((value) => value?.toLowerCase().includes(q))
  }), [filteredTickets, ticketFilter, workPriority, workAssignment, workSearch, sharedUser, fleet.vehicles])
  const overviewTickets = useMemo(() => {
    const severityRank: Record<Severity, number> = { High: 0, Medium: 1, Low: 2 }
    return filteredTickets
      .filter((ticket) => ticket.status !== 'Resolved')
      .sort((a, b) => severityRank[a.severity] - severityRank[b.severity] || a.createdAt.localeCompare(b.createdAt))
      .slice(0, 5)
  }, [filteredTickets])
  const metrics = useMemo(() => fleetMetrics(fleet, period, department), [fleet, period, department])
  const exceptions = useMemo(() => getExceptions(fleet, period, department), [fleet, period, department])
  const openFollowUpTasks = useMemo(() => getOpenFollowUps(fleet, undefined, department), [fleet, department])
  const closedFollowUpTasks = useMemo(() => fleet.followUps
    .filter((task) => task.status === 'Closed' && (department === 'All departments' || fleet.vehicles.some((vehicle) => vehicle.id === task.vehicleId && vehicle.department === department)))
    .sort((a, b) => (b.closedAt ?? b.at).localeCompare(a.closedAt ?? a.at)), [fleet, department])
  const visibleFollowUpTasks = showClosedFollowUps ? closedFollowUpTasks : openFollowUpTasks
  const overdueFollowUps = openFollowUpTasks.filter((task) => Boolean(task.dueOn && task.dueOn < localDateOffset(0))).length
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
    () => fleet.reports.filter((report) => {
      const vehicle = fleet.vehicles.find((item) => item.id === report.vehicleId)
      return report.period === period && report.status === 'Approved' &&
        (report.licensedAtSubmission ?? vehicle?.licensed) &&
        (department === 'All departments' || (report.departmentAtSubmission ?? vehicle?.department) === department)
    }),
    [fleet.reports, fleet.vehicles, period, department],
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
  const quarterRows = useMemo(() => quarterData.vehicles
    .filter((row) => quarterQualityFilter === 'All' || (quarterQualityFilter === 'Incomplete'
      ? row.approvedMonths < row.expectedMonths : row.qualityIssues.length > 0))
    .slice()
    .sort((a, b) => Number(a.ready) - Number(b.ready) || b.qualityIssues.length - a.qualityIssues.length || a.vehicle.unit.localeCompare(b.vehicle.unit)), [quarterData.vehicles, quarterQualityFilter])

  useEffect(() => {
    if (preserveDraftOnRefreshRef.current) {
      preserveDraftOnRefreshRef.current = false
      if (filteredVehicles.some((vehicle) => vehicle.id === reportVehicleId && requiresMonthlyReport(vehicle, period))) return
    }
    const vehicle = filteredVehicles.find((item) => item.id === reportVehicleId && requiresMonthlyReport(item, period)) ??
      filteredVehicles.find((item) => requiresMonthlyReport(item, period))
    setReportVehicleId(vehicle?.id ?? '')
    setReportDraft({
      ...reportDraftFor(fleet, vehicle, period),
      ...(sharedMode && sharedUser?.role === 'Driver' ? { operator: sharedUser.displayName } : {}),
    })
    // The form should refresh on filter/period changes, not on unrelated audit events.
  }, [department, period, reportVehicleId, fleet.vehicles, sharedMode, sharedUser])

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
    if (sharedMode) return
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
      setWorkAssignment('All')
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
    if (!canSubmit) {
      const existing = activeReportFor(fleetRef.current, vehicleId, targetPeriod)
      if (existing) openReportHistory(existing.id)
      else {
        openVehicle(vehicleId)
        toast('This record needs a Driver submission. Supervisors can create a follow-up task.', 'info')
      }
      return
    }
    if (department !== 'All departments' && department !== vehicle.department) setDepartment('All departments')
    if (targetPeriod !== period) setPeriod(targetPeriod)
    setReportVehicleId(vehicleId)
    setReportDraft({
      ...reportDraftFor(fleetRef.current, vehicle, targetPeriod),
      ...(sharedMode && sharedUser?.role === 'Driver' ? { operator: sharedUser.displayName } : {}),
    })
    setReportsTab('submit')
    changePage('reports')
    setFocusTarget('fleet-report-form')
  }

  const openReview = (reportId: string, targetPeriod = period) => {
    if (!canReview) {
      openReportHistory(reportId)
      return
    }
    const report = fleetRef.current.reports.find((item) => item.id === reportId)
    const vehicle = report && fleetRef.current.vehicles.find((item) => item.id === report.vehicleId)
    if (vehicle && department !== 'All departments' && department !== vehicle.department) setDepartment('All departments')
    if (targetPeriod !== period) setPeriod(targetPeriod)
    setSelectedReviewId(reportId)
    setReportsTab('review')
    changePage('reports')
    setFocusTarget('fleet-review-item-' + reportId)
  }

  const openTicket = (ticketId?: string, vehicleId?: string) => {
    if (ticketId) {
      setSelectedTicketId(ticketId)
      setExpandedTicketHistoryId(ticketId)
      setTicketFilter('All')
      setTicketFormOpen(false)
      const ticket = fleetRef.current.tickets.find((candidate) => candidate.id === ticketId)
      if (ticket) {
        if (canManageService) {
          setServiceEditId(ticket.id)
          setServiceEdit(serviceEditFor(ticket))
        } else setServiceEditId(null)
        const vehicle = fleetRef.current.vehicles.find((candidate) => candidate.id === ticket.vehicleId)
        if (vehicle && department !== 'All departments' && department !== vehicle.department) setDepartment(vehicle.department)
      }
      setFocusTarget('fleet-ticket-' + ticketId)
    } else if (vehicleId && canManageService) {
      setTicketDraft(blankTicketDraft(vehicleId))
      setTicketFormOpen(true)
      setSelectedTicketId(null)
      setExpandedTicketHistoryId(null)
      setFocusTarget('fleet-new-ticket-form')
    }
    changePage('maintenance')
  }

  const openVehicle = (vehicleId: string) => {
    const vehicle = fleetRef.current.vehicles.find((item) => item.id === vehicleId)
    if (!vehicle) return
    if (department !== 'All departments' && department !== vehicle.department) setDepartment(vehicle.department)
    setSelectedVehicleId(vehicleId)
    changePage('vehicles')
    setFocusTarget('fleet-vehicle-detail')
  }

  const openReportHistory = (reportId: string) => {
    const report = fleetRef.current.reports.find((item) => item.id === reportId)
    if (!report) return
    const vehicle = fleetRef.current.vehicles.find((item) => item.id === report.vehicleId)
    if (vehicle && department !== 'All departments' && department !== vehicle.department) setDepartment(vehicle.department)
    setPeriod(report.period)
    setExpandedReportId(reportId)
    setReportsTab('history')
    changePage('reports')
    setFocusTarget('fleet-history-report-' + reportId)
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
      openVehicle(item.vehicleId)
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

  const handleDepartmentSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!editingDepartment) return
    if (await commit(
      (current) => updateDepartmentProfile(current, editingDepartment, departmentDraft, 'Demo Fleet Admin'),
      editingDepartment + ' accountability settings saved.',
      { type: 'update-department', payload: { name: editingDepartment, input: departmentDraft } },
    )) setEditingDepartment(null)
  }

  const beginFollowUp = (item: FleetException) => {
    setFollowUpFor(item.id)
    setFollowUpNote('')
    setFollowUpOwner(item.owner ?? 'Demo Fleet Coordinator')
    setFollowUpDueOn(localDateOffset(3))
  }

  const handleFollowUp = async (event: FormEvent<HTMLFormElement>, item: FleetException) => {
    event.preventDefault()
    if (await commit(
      (current) => recordReportFollowUp(current, item.vehicleId, period, followUpActor, followUpNote, followUpDueOn, followUpOwner),
      'Internal follow-up task created. No reminder or message was sent.',
      { type: 'create-follow-up', payload: { vehicleId: item.vehicleId, period, note: followUpNote, dueOn: followUpDueOn, owner: followUpOwner } },
    )) {
      setFollowUpFor(null)
      setFollowUpNote('')
      setShowClosedFollowUps(false)
      const newest = fleetRef.current.followUps.find((task) => task.vehicleId === item.vehicleId && task.period === period && task.status !== 'Closed')
      if (newest) setFocusTarget('fleet-follow-up-task-' + newest.id)
    }
  }

  const beginTaskEdit = (task: FollowUp) => {
    setShowClosedFollowUps(false)
    setEditingFollowUpId(task.id)
    setTaskActor(task.actor || 'Demo Fleet Coordinator')
    setTaskOwner(task.owner || task.actor)
    setTaskDueOn(task.dueOn || localDateOffset(3))
    setTaskOutcome('')
    setFocusTarget('fleet-follow-up-task-' + task.id)
  }

  const saveTask = async (task: FollowUp, close = false) => {
    if (close && taskOutcome.trim().length < 5) {
      toast('Describe the outcome before closing the follow-up task.', 'error')
      return
    }
    const options = { owner: taskOwner, dueOn: taskDueOn, ...(close ? { outcome: taskOutcome } : {}) }
    if (await commit(
      (current) => updateReportFollowUp(current, task.id, close ? 'Closed' : 'Open', taskActor, options),
      close ? 'Internal follow-up closed with outcome. Nothing was sent.' : 'Internal follow-up owner and due date updated.',
      { type: 'update-follow-up', payload: { id: task.id, status: close ? 'Closed' : 'Open', options } },
    )) {
      setEditingFollowUpId(null)
      setTaskOutcome('')
      setShowClosedFollowUps(close)
      setFocusTarget('fleet-follow-up-task-' + task.id)
    }
  }

  const beginVehicleEdit = (vehicle: Vehicle) => {
    setVehicleEditId(vehicle.id)
    setVehicleEditDraft(vehicleEditFor(vehicle))
    setVehicleStatusDraft(vehicle.status)
    setVehicleStatusNote('')
  }

  const handleVehicleEdit = async (event: FormEvent<HTMLFormElement>) => {
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
    if (await commit(
      (current) => updateVehicleRecord(current, vehicleEditId, patch, 'Demo Fleet Admin'),
      'Vehicle record updated.',
      { type: 'update-vehicle', payload: { vehicleId: vehicleEditId, changes: patch } },
    )) {
      setVehicleEditId(null)
      if (department !== 'All departments' && department !== patch.department) setDepartment('All departments')
    }
  }

  const handleVehicleStatus = async (vehicle: Vehicle) => {
    if (vehicleStatusDraft === vehicle.status) return
    if (vehicleStatusDraft === 'Retired' && !window.confirm('Retire ' + vehicle.unit + '? This action affects ' + (sharedMode ? 'shared records' : 'the browser demo') + ' and stops future required reports.')) return
    if (vehicle.status === 'In maintenance' && vehicleStatusDraft === 'Active' && !window.confirm('Mark ' + vehicle.unit + ' active? Confirm the required real-world inspection or release is handled separately.')) return
    if (await commit(
      (current) => setVehicleStatus(current, vehicle.id, vehicleStatusDraft, 'Demo Fleet Admin', vehicleStatusNote),
      vehicle.unit + ' status updated to ' + vehicleStatusDraft.toLowerCase() + '.',
      { type: 'vehicle-status', payload: { vehicleId: vehicle.id, status: vehicleStatusDraft, note: vehicleStatusNote } },
    )) setVehicleStatusNote('')
  }

  const beginServiceEdit = (ticket: MaintenanceTicket) => {
    setServiceEditId(ticket.id)
    setSelectedTicketId(ticket.id)
    setServiceEdit(serviceEditFor(ticket))
  }

  const handleServiceUpdate = async (event: FormEvent<HTMLFormElement>, ticket: MaintenanceTicket) => {
    event.preventDefault()
    if (serviceEdit.status === 'Resolved' && !serviceEdit.resolutionNote.trim() && !ticket.resolutionNote) {
      toast('Add a resolution note before resolving the issue.', 'error')
      return
    }
    if (serviceEdit.status !== 'Open' && !serviceEdit.assignee.trim()) {
      toast('Assign a technician or responsible team before scheduling or resolving work.', 'error')
      return
    }
    if (serviceEdit.status === 'Scheduled' && !serviceEdit.scheduledFor) {
      toast('Set a scheduled service date.', 'error')
      return
    }
    if (ticket.status === 'Resolved' && serviceEdit.status !== 'Resolved' && serviceEdit.reopenReason.trim().length < 5) {
      toast('Explain why the resolved work order is being reopened.', 'error')
      return
    }
    const details = {
      assignee: serviceEdit.assignee,
      scheduledFor: serviceEdit.scheduledFor,
      resolutionNote: serviceEdit.resolutionNote,
      actualCost: serviceEdit.actualCost.trim() ? Number(serviceEdit.actualCost) : undefined,
      reopenReason: serviceEdit.reopenReason,
    }
    if (await commit(
      (current) => updateMaintenanceTicket(current, ticket.id, serviceEdit.status, 'Demo ' + role, details),
      ticket.title + ' updated with service follow-through.',
      { type: 'update-ticket', payload: { ticketId: ticket.id, status: serviceEdit.status, details } },
    )) {
      setServiceEditId(null)
      setTicketFilter('All')
      setExpandedTicketHistoryId(ticket.id)
      setSelectedTicketId(ticket.id)
      setFocusTarget('fleet-ticket-' + ticket.id)
    }
  }

  const handleReportSubmit = async (event: FormEvent<HTMLFormElement>) => {
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
    if (await commit(
      (current) => submitMonthlyReport(current, input),
      sharedMode ? 'Monthly report submitted for supervisor review.' : 'Monthly report sent to the demo supervisor queue.',
      { type: 'submit-report', payload: input },
    )) {
      setReportsTab('history')
    }
  }

  const handleReview = async (reportId: string, decision: 'Approved' | 'Returned') => {
    const note = reviewNotes[reportId] ?? ''
    if (await commit(
      (current) => reviewMonthlyReport(current, reportId, decision, reviewer, note),
      decision === 'Approved' ? 'Report approved.' : 'Report returned for correction.',
      { type: 'review-report', payload: { reportId, decision, note } },
    )) {
      setSelectedReviewId(null)
      setReviewNotes((previous) => ({ ...previous, [reportId]: '' }))
    }
  }

  const handleAddVehicle = async (event: FormEvent<HTMLFormElement>) => {
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
      notes: vehicleDraft.notes,
    }
    if (await commit(
      (current) => addVehicle(current, input, 'Demo Fleet Admin'),
      'Vehicle added.',
      { type: 'add-vehicle', payload: { input } },
    )) {
      const added = fleetRef.current.vehicles.find((vehicle) => vehicle.unit === vehicleDraft.unit.trim())
      if (added) setSelectedVehicleId(added.id)
      if (department !== 'All departments' && department !== vehicleDraft.department) setDepartment(vehicleDraft.department)
      setVehicleFormOpen(false)
      setVehicleDraft(blankVehicleDraft())
    }
  }

  const handleAddTicket = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const input: TicketInput = {
      vehicleId: ticketDraft.vehicleId,
      title: ticketDraft.title,
      description: ticketDraft.description,
      severity: ticketDraft.severity,
      assignee: ticketDraft.assignee,
    }
    if (await commit(
      (current) => addMaintenanceTicket(current, input, 'Demo ' + role),
      'Maintenance issue added to the queue.',
      { type: 'add-ticket', payload: { input } },
    )) {
      setTicketDraft(blankTicketDraft(ticketDraft.vehicleId))
      setTicketFormOpen(false)
      setTicketFilter('Active')
    }
  }

  const downloadStagingCsv = async (csv: string, count: number, filename: string, scope: 'Monthly' | 'Quarterly', label: string) => {
    if (!count) return toast('No vehicles or reports match the selected review scope.', 'error')
    if (!await commit(
      (current) => recordExportPreparation(current, scope, label, count, 'Demo Fleet Admin'),
      scope + ' review-only CSV prepared and logged. No TxFS submission occurred.',
      { type: 'record-export', payload: { scope, label, recordCount: count } },
    )) return
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

  const openQuarterQualityIssue = (vehicle: Vehicle, issue: string) => {
    const month = issue.match(/^(\d{4}-(?:0[1-9]|1[0-2])):/)?.[1]
    const report = month ? activeReportFor(fleetRef.current, vehicle.id, month) : undefined
    if (report) openReportHistory(report.id)
    else openVehicle(vehicle.id)
  }

  const beginApprovedCorrection = (vehicle: Vehicle, issue: string) => {
    const month = issue.match(/^(\d{4}-(?:0[1-9]|1[0-2])):/)?.[1]
    const report = month ? activeReportFor(fleetRef.current, vehicle.id, month) : undefined
    if (!report || report.status !== 'Approved') {
      toast('An approved source report could not be found for this quality finding.', 'error')
      return
    }
    setCorrectionRequest({ reportId: report.id, vehicleId: vehicle.id, period: report.period, reason: '' })
  }

  const submitApprovedCorrection = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!correctionRequest) return
    if (correctionRequest.reason.trim().length < 5) {
      toast('Record why the approved report needs a correction.', 'error')
      return
    }
    if (await commit(
      (current) => reopenApprovedReportForCorrection(current, correctionRequest.reportId, 'Demo ' + role, correctionRequest.reason),
      'Approved snapshot retained. Report reopened for correction.',
      { type: 'reopen-report', payload: { reportId: correctionRequest.reportId, reason: correctionRequest.reason } },
    )) {
      const { vehicleId, period: targetPeriod } = correctionRequest
      setCorrectionRequest(null)
      openReport(vehicleId, targetPeriod)
    }
  }
  const resetDemo = async () => {
    if (sharedMode) return
    if (!window.confirm('Reset FleetSync to fictional sample records? Your changes saved in this browser will be replaced.')) return
    const next = createDemoFleet(currentPeriod())
    if (!await commit(() => next, 'Fictional demo records restored.')) return
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
    setEditingFollowUpId(null)
    setShowClosedFollowUps(false)
    setVehicleEditId(null)
    setServiceEditId(null)
    setQuarterScope(fiscalQuarterForPeriod(currentPeriod()))
    setQuarterQualityFilter('All')
    setExpandedQualityVehicleId(null)
    setCorrectionRequest(null)
    setExpandedReportId(null)
    setTicketFilter('Active')
    setWorkSearch('')
    setWorkPriority('All')
    setWorkAssignment('All')
    setVehicleSearch('')
    setAuditSearch('')
    setShowAllExceptions(false)
    setSelectedVehicleId(next.vehicles[0]?.id ?? null)
    setSelectedTicketId(null)
    setExpandedTicketHistoryId(null)
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

  if (sharedMode && sharedStatus !== 'ready') {
    return (
      <div className="fleet-app fleet-app--auth" data-mode="shared" data-role={role}>
        <main className="fleet-auth-layout" id="fleet-main">
          <div className="fleet-auth-panel">
            <div className="fleet-auth-heading"><span className="fleet-brand-mark"><Truck size={22} /></span><span><strong>FleetSync Operations</strong><small>SHARED RECORDS · LOCAL SERVER</small></span></div>
            <h1>{sharedStatus === 'checking' ? 'Connecting to shared records' : sharedStatus === 'error' ? 'Shared records unavailable' : 'Sign in to shared records'}</h1>
            <p className="fleet-text-muted">Shared records use a separate local server with authenticated users, department scope, and server-checked permissions. Browser-local Demo data is not imported automatically.</p>
            {sharedError && <div className="fleet-banner fleet-banner--warning" role="alert"><AlertTriangle size={18} /><span>{sharedError}</span></div>}
            {sharedStatus === 'checking' && <p className="fleet-auth-loading" role="status"><Clock3 size={18} /> Checking local server and session…</p>}
            {sharedStatus === 'login' && (
              <form className="fleet-form fleet-auth-form" onSubmit={loginToShared} aria-label="Shared records login">
                <Field htmlFor="fleet-shared-username" label="Username">
                  <input id="fleet-shared-username" className="fleet-input" autoComplete="username" value={sharedUsername} onChange={(event) => setSharedUsername(event.target.value)} required maxLength={100} disabled={sharedBusy} />
                </Field>
                <Field htmlFor="fleet-shared-password" label="Password">
                  <input id="fleet-shared-password" className="fleet-input" type="password" autoComplete="current-password" value={sharedPassword} onChange={(event) => setSharedPassword(event.target.value)} required disabled={sharedBusy} />
                </Field>
                <button type="submit" className="fleet-button fleet-button--primary" disabled={sharedBusy || !sharedUsername.trim() || !sharedPassword}>{sharedBusy ? 'Signing in…' : 'Sign in'} <ArrowRight size={16} /></button>
                <p className="fleet-text-muted">Accounts are administered locally. These are not UT Dallas credentials.</p>
              </form>
            )}
            <div className="fleet-auth-actions">
              {sharedStatus === 'error' && <button className="fleet-button fleet-button--primary" type="button" disabled={sharedBusy} onClick={openSharedRecords}>Retry shared connection</button>}
              <button className="fleet-button fleet-button--quiet" type="button" disabled={sharedBusy} onClick={leaveSharedRecords}><ArrowLeft size={16} /> Back to browser Demo</button>
            </div>
          </div>
          <p className="fleet-auth-footnote">The shared server is loopback-only. Neither workspace connects to university vehicle systems or submits TxFS reports.</p>
        </main>
      </div>
    )
  }

  return (
    <div className="fleet-app" data-mode={connectionMode} data-role={role} data-pending={sharedBusy ? 'true' : 'false'}>
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
            {navItems.map((item) => {
              const Icon = item.icon
              return (
                <button
                  type="button"
                  disabled={sharedBusy}
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
          <div className="fleet-sidebar__demo"><strong>{sharedMode ? 'Shared records' : 'Browser Demo'}</strong></div>
          <p>{sharedMode ? 'Authenticated local-server records. Changes are shared between signed-in sessions.' : 'Fictional records stay in this browser unless you explicitly import them.'}</p>
          {sharedMode ? (
            <div className="fleet-sidebar__session-actions">
              <small>{sharedUser?.displayName} · {sharedUser?.role}</small>
              <button type="button" className="fleet-sidebar__reset" disabled={sharedBusy} onClick={logoutFromShared}>Log out</button>
              <button type="button" className="fleet-sidebar__reset" disabled={sharedBusy} onClick={leaveSharedRecords}>Back to Demo</button>
            </div>
          ) : (
            <>
              <button type="button" className="fleet-sidebar__reset" onClick={openSharedRecords}><UserRound size={15} /> Open Shared records</button>
              <button type="button" className="fleet-sidebar__reset" onClick={resetDemo}><RotateCcw size={15} /> Reset demo data</button>
            </>
          )}
          <span className="fleet-sidebar__version">No UT Dallas / TxFS integration</span>
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
            {sharedMode ? (
              <div className="fleet-shared-identity" title={sharedUser?.department ?? 'All departments'}>
                <span className="fleet-workspace-badge">Shared records</span>
                <UserRound size={16} />
                <span className="fleet-shared-identity__text"><strong>{sharedUser?.displayName}</strong><small>{sharedUser?.role}{sharedUser?.department ? ' · ' + sharedUser.department : ''}</small></span>
                <button className="fleet-button fleet-button--small fleet-button--quiet" type="button" disabled={sharedBusy} onClick={refreshSharedRecords}><RotateCcw size={14} /> Refresh</button>
                <button className="fleet-button fleet-button--small fleet-button--quiet" type="button" disabled={sharedBusy} onClick={logoutFromShared}>Log out</button>
                <button className="fleet-button fleet-button--small fleet-button--quiet" type="button" disabled={sharedBusy} onClick={leaveSharedRecords}>Demo</button>
              </div>
            ) : (
            <>
            <button className="fleet-button fleet-button--small fleet-button--quiet fleet-shared-open" type="button" onClick={openSharedRecords}><UserRound size={15} /> Shared records</button>
            <div className="fleet-role-switch">
              <UserRound size={17} />
              <label className="fleet-sr-only" htmlFor="fleet-role">Switch demo role</label>
              <select id="fleet-role" value={role} onChange={(event) => changeRole(event.target.value as Role)}>
                {ROLES.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
              <ChevronDown size={14} aria-hidden="true" />
            </div>
            </>
            )}
          </div>
        </header>

        <main id="fleet-main" className="fleet-main" tabIndex={-1} aria-busy={sharedBusy}>
          <div className="fleet-demo-notice" role="note">
            <Info size={16} />
            {sharedMode
              ? <span><strong>Shared records · authenticated local server.</strong> Signed in as {sharedUser?.displayName} ({sharedUser?.role}). The server enforces permissions and records changes. This is not UT Dallas or TxFS integration.</span>
              : <span><strong>Browser-local Demo · roles are not access control.</strong> Sample records and workflows are fictional. This prototype does not connect to UT Dallas systems or TxFS.</span>}
          </div>
          {sharedMode && sharedError && <div className="fleet-banner fleet-banner--warning fleet-shared-error" role="alert"><AlertTriangle size={18} /><span>{sharedError}</span><button type="button" className="fleet-button fleet-button--small fleet-button--quiet" onClick={leaveSharedRecords}>Back to Demo</button><button type="button" className="fleet-button fleet-button--small fleet-button--quiet" onClick={() => setSharedError('')}>Dismiss</button></div>}

          <div className="fleet-page" data-workspace={role === 'Driver' ? 'driver' : role === 'Supervisor' ? 'supervisor' : role === 'Maintenance' ? 'maintenance' : 'admin'} inert={sharedMode && sharedBusy}>
            {sharedMode && canManageFleet && (
              <section className="fleet-shared-import" aria-label="Import browser Demo records">
                <div className="fleet-shared-import__header">
                  <div><strong>Shared database</strong><span> {fleet.vehicles.length} vehicles · {fleet.reports.length} reports · {fleet.tickets.length} work orders</span></div>
                  <button type="button" className="fleet-button fleet-button--small fleet-button--quiet" aria-expanded={importPanelOpen} onClick={() => {
                    setImportPanelOpen((open) => !open)
                    setImportPreview(null)
                    setImportConfirmed(false)
                  }}>{importPanelOpen ? 'Close import' : 'Import browser Demo data'}</button>
                </div>
                {importPanelOpen && (
                  <div className="fleet-shared-import__body">
                    <h2>Optional one-time import to an empty shared database</h2>
                    <p>Copy a snapshot of this browser's separate Demo records into shared storage. Nothing is copied automatically. Import never merges or overwrites an existing shared fleet, and it does not submit data to TxFS.</p>
                    <p className="fleet-text-muted">Available Demo snapshot: {demoSnapshotRef.current.vehicles.length} vehicles · {demoSnapshotRef.current.reports.length} reports · {demoSnapshotRef.current.tickets.length} work orders.</p>
                    {!importPreview && <button type="button" className="fleet-button fleet-button--quiet" disabled={sharedBusy} onClick={previewDemoImport}>Preview import with server <ArrowRight size={16} /></button>}
                    {importPreview && (
                      <div className="fleet-shared-import__preview">
                        <strong>{importPreview.allowed ? 'Server preview: eligible for one-time import' : 'Server preview: import blocked'}</strong>
                        <p>{importPreview.reason}</p>
                        <div className="fleet-shared-import__counts">
                          <span>{importPreview.counts.vehicles} vehicles</span><span>{importPreview.counts.reports} reports</span><span>{importPreview.counts.tickets} work orders</span><span>{importPreview.counts.followUps} follow-ups</span>
                        </div>
                        {importPreview.allowed && (
                          <>
                            <label className="fleet-checkbox-field fleet-shared-import__confirm"><input type="checkbox" checked={importConfirmed} onChange={(event) => setImportConfirmed(event.target.checked)} /> I understand this copies my browser Demo snapshot into the empty shared database and makes it visible to signed-in users.</label>
                            <button className="fleet-button fleet-button--primary" type="button" disabled={!importConfirmed || sharedBusy} onClick={importDemoData}>Confirm import to shared records</button>
                          </>
                        )}
                        <button className="fleet-button fleet-button--quiet" type="button" disabled={sharedBusy} onClick={() => { setImportPreview(null); setImportConfirmed(false) }}>Preview again</button>
                      </div>
                    )}
                  </div>
                )}
              </section>
            )}
            <div className="fleet-page-heading fleet-header">
              <div className="fleet-page-heading__copy">
                <span className="fleet-eyebrow">{sharedMode ? (sharedUser?.role + (sharedUser?.department ? ' · ' + sharedUser.department : ' · Cross-department')) : 'DEMO ROLE · ' + role}{' · '}{displayPeriod(period)}</span>
                <h1>
                  {view === 'reports' && role === 'Driver' ? 'My monthly report'
                    : view === 'reports' && role === 'Supervisor' ? 'Department review queue'
                      : view === 'maintenance' && role === 'Maintenance' ? 'Technician work orders'
                        : view === 'overview' ? (sharedMode ? 'Fleet exceptions and assignments' : 'Exceptions and reporting') : navCurrent.label}
                </h1>
                <p>
                  {view === 'overview' && 'Resolve reporting, department accountability, follow-ups, and service exceptions.'}
                {view === 'reports' && role === 'Driver' && 'Record your department vehicle mileage and condition, then track approval or corrections.'}
                  {view === 'reports' && role === 'Supervisor' && 'Review department submissions, return corrections, and track missing reports.'}
                  {view === 'reports' && role !== 'Driver' && role !== 'Supervisor' && 'Review submitted reports, corrections and approval history.'}
                  {view === 'vehicles' && 'Vehicle details, assigned departments, custodians, and service status.'}
                  {view === 'maintenance' && 'Assign work, schedule service, and record resolution with a retained audit history.'}
                  {view === 'exports' && 'Reconcile three monthly periods and prepare review-only CSV worksheets.'}
                </p>
              </div>
              <div className="fleet-page-heading__actions">
                {view === 'overview' && canSubmit && <button className="fleet-button fleet-button--primary" type="button" onClick={() => {
                  const vehicle = preferredReportVehicle(fleetRef.current, period, department)
                  setReportVehicleId(vehicle?.id ?? '')
                  setReportDraft(reportDraftFor(fleetRef.current, vehicle, period))
                  setReportsTab('submit')
                  changePage('reports')
                }}><Plus size={17} /> New report</button>}
                {view === 'vehicles' && canManageFleet && <button className="fleet-button fleet-button--primary" type="button" onClick={() => setVehicleFormOpen(true)}><Plus size={17} /> Add vehicle</button>}
                {view === 'maintenance' && canManageService && <button className="fleet-button fleet-button--primary" type="button" onClick={() => { setTicketDraft(blankTicketDraft(filteredVehicles[0]?.id)); setTicketFormOpen(true) }}><Plus size={17} /> {sharedMode ? 'New work order' : 'New issue'}</button>}
                {view === 'exports' && canManageFleet && <button className="fleet-button fleet-button--primary" type="button" disabled={!exportData.count || sharedBusy} onClick={downloadCsv}><Download size={17} /> Download monthly CSV</button>}
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
                <select id="fleet-department" className="fleet-select" value={department} disabled={sharedMode && sharedUser?.role !== 'Fleet Admin' && sharedUser?.role !== 'Maintenance'} onChange={(event) => setDepartment(event.target.value)}>
                  {(!sharedMode || sharedUser?.role === 'Fleet Admin' || sharedUser?.role === 'Maintenance') && <option>All departments</option>}
                  {departments.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </div>
              <span className="fleet-filter__scope"><Filter size={15} /> {filteredVehicles.length} directory units ({filteredVehicles.filter((vehicle) => vehicle.status !== 'Retired').length} expected to report)</span>
            </div>

            {view === 'overview' && (
              <>
              <div className="fleet-ops-summary" data-testid={role === 'Fleet Admin' ? 'admin-workspace' : undefined} aria-label="Current fleet status">
                  {[
                    { label: 'Units expected to report', value: metrics.vehicles, detail: metrics.licensed + ' licensed' },
                    { label: 'Reporting coverage', value: completion + '%', detail: metrics.reported + ' submitted' },
                    { label: 'Overdue reporting', value: metrics.overdue, detail: metrics.missing + ' missing' },
                    { label: 'Supervisor queue', value: metrics.pending, detail: metrics.returned + ' returned' },
                    { label: 'Open work orders', value: metrics.tickets, detail: metrics.serviceHolds + ' service holds' },
                    { label: 'Follow-up tasks', value: openFollowUpTasks.length, detail: overdueFollowUps + ' overdue' },
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
                            const activeTask = openFollowUpTasks.find((task) => task.vehicleId === item.vehicleId && task.period === period)
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
                                    {isReporting && canManageFollowUps && (activeTask
                                      ? <button className="fleet-button fleet-button--small fleet-button--quiet" type="button" onClick={() => beginTaskEdit(activeTask)}>Manage task</button>
                                      : <button className="fleet-button fleet-button--small fleet-button--quiet" type="button" aria-expanded={followUpFor === item.id} onClick={() => followUpFor === item.id ? setFollowUpFor(null) : beginFollowUp(item)}>Create follow-up</button>)}
                                  </div></td>
                                </tr>
                                {followUpFor === item.id && (
                                  <tr className="fleet-exception-follow-up-row"><td colSpan={6}>
                                    <form className="fleet-form fleet-follow-up-form" onSubmit={(event) => handleFollowUp(event, item)}>
                                      <div className="fleet-profile-form__heading"><h3>Record internal follow-up · {item.label}</h3><button type="button" className="fleet-icon-button" aria-label="Close follow-up form" onClick={() => setFollowUpFor(null)}><X size={17} /></button></div>
                                      <div className="fleet-form-grid">
                                        <Field htmlFor={'follow-actor-' + item.id} label="Recorded by"><input id={'follow-actor-' + item.id} className="fleet-input" value={followUpActor} maxLength={80} minLength={2} required readOnly={sharedMode} onChange={(event) => setFollowUpActor(event.target.value)} /></Field>
                                        <Field htmlFor={'follow-owner-' + item.id} label="Responsible owner"><input id={'follow-owner-' + item.id} className="fleet-input" value={followUpOwner} minLength={2} maxLength={80} required onChange={(event) => setFollowUpOwner(event.target.value)} /></Field>
                                        <Field htmlFor={'follow-due-' + item.id} label="Next check-in date"><input id={'follow-due-' + item.id} className="fleet-input" type="date" min={localDateOffset(0)} value={followUpDueOn} required onChange={(event) => setFollowUpDueOn(event.target.value)} /></Field>
                                        <Field htmlFor={'follow-note-' + item.id} label="Internal task note" hint="This schedules a local task, not an email, SMS, or external reminder." className="fleet-field--full"><textarea id={'follow-note-' + item.id} className="fleet-textarea" value={followUpNote} rows={2} minLength={5} maxLength={400} required placeholder="Record planned action and follow-up target" onChange={(event) => setFollowUpNote(event.target.value)} /></Field>
                                      </div>
                                      <div className="fleet-form-actions"><button className="fleet-button fleet-button--primary fleet-button--small" type="submit"><Check size={15} /> Create internal task</button><button className="fleet-button fleet-button--quiet fleet-button--small" type="button" onClick={() => setFollowUpFor(null)}>Cancel</button></div>
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

                <FleetCard className="fleet-follow-up-queue" >
                  <SectionTitle
                    title="Internal follow-up tasks"
                    description="Locally tracked actions with named owners, due dates, and recorded outcomes. Creating or closing a task does not send a reminder."
                    action={<Tone tone={overdueFollowUps ? 'high' : 'muted'}>{openFollowUpTasks.length} open · {overdueFollowUps} overdue</Tone>}
                  />
                  <div className="fleet-exception-toolbar" role="group" aria-label="Follow-up task status">
                    <button className={'fleet-button fleet-button--small ' + (!showClosedFollowUps ? 'fleet-button--primary' : 'fleet-button--quiet')} type="button" aria-pressed={!showClosedFollowUps} onClick={() => setShowClosedFollowUps(false)}>Open ({openFollowUpTasks.length})</button>
                    <button className={'fleet-button fleet-button--small ' + (showClosedFollowUps ? 'fleet-button--primary' : 'fleet-button--quiet')} type="button" aria-pressed={showClosedFollowUps} onClick={() => setShowClosedFollowUps(true)}>Closed ({closedFollowUpTasks.length})</button>
                  </div>
                  {visibleFollowUpTasks.length ? (
                    <div className="fleet-table-wrap">
                      <table className="fleet-table fleet-follow-up-table">
                        <thead><tr><th scope="col">Unit / month</th><th scope="col">Owner</th><th scope="col">Due / completed</th><th scope="col">Task / outcome</th><th scope="col">Status</th><th scope="col">Actions</th></tr></thead>
                        <tbody>
                          {visibleFollowUpTasks.map((task) => {
                            const vehicle = fleet.vehicles.find((item) => item.id === task.vehicleId)
                            const closed = task.status === 'Closed'
                            const overdue = !closed && Boolean(task.dueOn && task.dueOn < localDateOffset(0))
                            return (
                              <Fragment key={task.id}>
                                <tr id={'fleet-follow-up-task-' + task.id} tabIndex={-1} className={'fleet-follow-up-row fleet-record-anchor ' + (overdue ? 'is-overdue' : '')}>
                                  <td><strong>{vehicle?.unit ?? task.vehicleId}</strong><small className="fleet-table__meta">{displayPeriod(task.period)} · {vehicle?.department}</small></td>
                                  <td>{task.owner || task.actor}</td>
                                  <td>{closed ? dateLabel(task.closedAt ?? task.at) : task.dueOn ? dateLabel(task.dueOn) : 'Unscheduled'}{overdue && <small className="fleet-table__meta fleet-urgency">Overdue</small>}</td>
                                  <td><strong>{task.note}</strong>{task.outcome && <small className="fleet-table__meta">Outcome: {task.outcome}</small>}{closed && task.closedBy && <small className="fleet-table__meta">Closed by {task.closedBy}</small>}</td>
                                  <td><Tone tone={closed ? 'approved' : overdue ? 'high' : 'pending'}>{closed ? 'Closed' : 'Open'}</Tone></td>
                                  <td><div className="fleet-exception__actions">
                                    {!closed && canManageFollowUps && <button className="fleet-button fleet-button--small fleet-button--quiet" type="button" onClick={() => beginTaskEdit(task)} aria-expanded={editingFollowUpId === task.id}>Update task</button>}
                                    <button className="fleet-button fleet-button--small fleet-button--quiet" type="button" onClick={() => {
                                      const report = activeReportFor(fleet, task.vehicleId, task.period)
                                      if (report?.status === 'Pending') openReview(report.id, task.period)
                                      else if (report?.status === 'Approved') openReportHistory(report.id)
                                      else openReport(task.vehicleId, task.period)
                                    }}>Report <ArrowRight size={14} /></button>
                                  </div></td>
                                </tr>
                                {editingFollowUpId === task.id && !closed && (
                                  <tr className="fleet-follow-up-detail"><td colSpan={6}>
                                    <form className="fleet-form fleet-follow-up-form" onSubmit={(event) => { event.preventDefault(); saveTask(task) }}>
                                      <div className="fleet-profile-form__heading"><h3>Update follow-up · {vehicle?.unit ?? task.vehicleId}</h3><button className="fleet-icon-button" type="button" aria-label="Close task editor" onClick={() => setEditingFollowUpId(null)}><X size={18} /></button></div>
                                      <div className="fleet-form-grid fleet-form-grid--wide">
                                        <Field htmlFor={'task-editor-' + task.id} label="Updated by"><input id={'task-editor-' + task.id} className="fleet-input" minLength={2} maxLength={80} required readOnly={sharedMode} value={taskActor} onChange={(event) => setTaskActor(event.target.value)} /></Field>
                                        <Field htmlFor={'task-owner-' + task.id} label="Responsible owner"><input id={'task-owner-' + task.id} className="fleet-input" minLength={2} maxLength={80} required value={taskOwner} onChange={(event) => setTaskOwner(event.target.value)} /></Field>
                                        <Field htmlFor={'task-due-' + task.id} label="Next check-in date"><input id={'task-due-' + task.id} className="fleet-input" type="date" value={taskDueOn} required onChange={(event) => setTaskDueOn(event.target.value)} /></Field>
                                        <Field htmlFor={'task-outcome-' + task.id} label="Outcome or contact result (required to close)" className="fleet-field--full"><textarea id={'task-outcome-' + task.id} className="fleet-textarea" rows={2} minLength={5} maxLength={400} value={taskOutcome} onChange={(event) => setTaskOutcome(event.target.value)} placeholder="Record the actual response, completed action, or reason no action was taken" /></Field>
                                      </div>
                                      <p className="fleet-text-muted">This task has no scheduling service. No email, text, push notification, or external reminder will be sent.</p>
                                      <div className="fleet-form-actions">
                                        <button className="fleet-button fleet-button--quiet" type="submit">Save owner / due date</button>
                                        <button className="fleet-button fleet-button--primary" type="button" disabled={taskOutcome.trim().length < 5 || taskActor.trim().length < 2} onClick={() => saveTask(task, true)}><Check size={16} /> Close with outcome</button>
                                        <button className="fleet-button fleet-button--quiet" type="button" onClick={() => setEditingFollowUpId(null)}>Cancel</button>
                                      </div>
                                    </form>
                                  </td></tr>
                                )}
                              </Fragment>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : <Empty icon={ClipboardCheck} title={showClosedFollowUps ? 'No closed follow-ups in this scope' : 'No open follow-up tasks'} description={showClosedFollowUps ? 'Resolved task outcomes will appear here.' : 'Create a task from a missing, overdue, or returned report exception. No automated messages are sent.'} />}
                </FleetCard>

                <FleetCard className="fleet-department-scorecard">
                  <SectionTitle title="Reporting by department" description="Assigned coordinator, due day, approval progress and overdue items. Due dates are local policy settings, not verified university deadlines." action={<Tone tone="muted">{scorecardVisible.length} departments</Tone>} />
                  <div className="fleet-table-wrap">
                    <table className="fleet-table fleet-scorecard-table">
                      <thead><tr><th scope="col">Department / coordinator</th><th scope="col">Due</th><th scope="col">Reports</th><th scope="col">Exceptions</th><th scope="col">Actions</th></tr></thead>
                      <tbody>{scorecardVisible.map((row) => (
                        <tr key={row.name}>
                          <td><strong>{row.name}</strong><small className="fleet-table__meta">{row.profile?.coordinator || 'Coordinator to be assigned'}</small>{row.profile?.contact && <small className="fleet-table__meta">{row.profile.contact}</small>}</td>
                          <td>{dateLabel(row.dueDate)}<small className="fleet-table__meta">Day {row.profile?.monthlyDueDay ?? 5}</small></td>
                          <td><div className="fleet-scorecard-metrics"><strong>{row.approved}/{row.vehicles} approved</strong><span>{row.completion}%</span></div><div className="fleet-progress fleet-progress--compact"><span style={{ width: Math.min(100, row.completion) + '%' }} /></div><small className="fleet-table__meta">{row.submitted} submitted · {row.pending} pending</small></td>
                          <td>{row.overdue > 0 ? <Tone tone="high">{row.overdue} overdue</Tone> : row.missing > 0 || row.returned > 0 ? <Tone tone="pending">{row.missing} missing · {row.returned} returned</Tone> : <Tone tone="approved">On track</Tone>}</td>
                          <td><div className="fleet-scorecard-row__actions">{canManageFleet && <button className="fleet-button fleet-button--small fleet-button--quiet" type="button" onClick={() => beginDepartmentEdit(row.name)}><Settings2 size={15} /> Edit</button>}<button className="fleet-button fleet-button--small fleet-button--quiet" type="button" onClick={() => { setDepartment(row.name); setExceptionFilter('All') }}>Focus <ArrowRight size={14} /></button></div></td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                {editingDepartment && canManageFleet && (
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
                    <SectionTitle title="Recent audit activity" description={sharedMode ? 'Activity recorded on the authenticated local server. Not a certified immutable audit log.' : 'Actions recorded in this browser Demo.'} action={canManageFleet ? <button type="button" className="fleet-button fleet-button--quiet fleet-button--small" onClick={() => changePage('exports')}>View audit log <ArrowRight size={15} /></button> : undefined} />
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
                {role === 'Driver' && (
                  <section className="fleet-role-summary fleet-role-summary--driver" data-testid="driver-workspace" aria-label="Driver monthly report status">
                    <div className="fleet-role-summary__body">
                      <span className="fleet-eyebrow">MY REPORT · {displayPeriod(period)}</span>
                      <strong>{reportVehicle ? reportVehicle.unit + ' · ' + reportVehicle.year + ' ' + reportVehicle.make + ' ' + reportVehicle.model : 'No assigned vehicle in this month'}</strong>
                      <span>{reportExisting?.status === 'Returned' ? 'Returned for correction. Review the supervisor note and resubmit.' :
                        reportExisting?.status === 'Pending' ? 'Submitted and awaiting supervisor review.' :
                          reportExisting?.status === 'Approved' ? 'Approved. No further action for this month.' :
                            'Not yet submitted. Enter the actual odometer readings and usage.'}</span>
                      {reportExisting?.reviewNote && <small><strong>Supervisor note: </strong>{reportExisting.reviewNote}</small>}
                    </div>
                    <div className="fleet-role-summary__actions">
                      <Tone tone={reportExisting?.status.toLowerCase() ?? 'pending'}>{reportExisting?.status ?? 'Missing'}</Tone>
                      <button type="button" className="fleet-button fleet-button--small fleet-button--primary" onClick={() => { setReportsTab('submit'); setFocusTarget('fleet-report-form') }}>Open monthly form <ArrowRight size={15} /></button>
                    </div>
                  </section>
                )}
                {role === 'Supervisor' && (
                  <section className="fleet-role-summary fleet-role-summary--supervisor" data-testid="supervisor-workspace" aria-label="Supervisor department review status">
                    <div className="fleet-role-summary__body"><span className="fleet-eyebrow">DEPARTMENT APPROVALS · {displayPeriod(period)}</span><strong>{department === 'All departments' ? 'Reporting responsibility' : department + ' submissions'}</strong><span>Approve complete reports, return corrections with a reason, and follow up on missing records.</span></div>
                    <div className="fleet-role-summary__counts">
                      <span><strong>{pendingReports.length}</strong> awaiting review</span>
                      <span><strong>{metrics.missing}</strong> missing</span>
                      <span><strong>{metrics.returned}</strong> returned</span>
                      <span><strong>{openFollowUpTasks.length}</strong> open follow-ups</span>
                    </div>
                    <div className="fleet-role-summary__actions">
                      {pendingReports[0] && <button type="button" className="fleet-button fleet-button--primary fleet-button--small" onClick={() => openReview(pendingReports[0].id)}>Review next report <ArrowRight size={15} /></button>}
                      <button type="button" className="fleet-button fleet-button--quiet fleet-button--small" onClick={() => changePage('overview')}>Reporting exceptions</button>
                    </div>
                  </section>
                )}
                <div className="fleet-tabs" role="tablist" aria-label="Monthly report workflows">
                  {canSubmit && <button id="fleet-report-submit-tab" role="tab" type="button" className={'fleet-tab ' + (reportsTab === 'submit' ? 'is-active' : '')} aria-selected={reportsTab === 'submit'} onClick={() => setReportsTab('submit')}><Send size={17} /> {role === 'Driver' ? 'My monthly form' : 'Submit report'}</button>}
                  {canReview && <button id="fleet-report-review-tab" role="tab" type="button" className={'fleet-tab ' + (reportsTab === 'review' ? 'is-active' : '')} aria-selected={reportsTab === 'review'} onClick={() => setReportsTab('review')}><ClipboardCheck size={17} /> {role === 'Supervisor' ? 'Department review' : 'Supervisor review'} <span className="fleet-tab__count">{pendingReports.length}</span></button>}
                  <button id="fleet-report-history-tab" role="tab" type="button" className={'fleet-tab ' + (reportsTab === 'history' ? 'is-active' : '')} aria-selected={reportsTab === 'history'} onClick={() => setReportsTab('history')}><History size={17} /> {role === 'Driver' ? 'Department report history' : 'All reports'}</button>
                </div>
                {reportsTab === 'submit' && canSubmit && (
                  <div role="tabpanel" aria-labelledby="fleet-report-submit-tab" className="fleet-grid fleet-reports-layout">
                    <FleetCard>
                      <SectionTitle eyebrow="DRIVER ENTRY" title="Monthly vehicle use report" description={role === 'Driver' ? undefined : 'Record vehicle activity for ' + displayPeriod(period) + '. A supervisor can approve or return the submission.'} />
                      {role !== 'Driver' && <div className="fleet-banner fleet-banner--info"><Info size={18} /><span>Enter the information for one vehicle. Returned reports can be corrected and resubmitted under the same record.</span></div>}
                      <form id="fleet-report-form" tabIndex={-1} className="fleet-form fleet-record-anchor" onSubmit={handleReportSubmit}>
                        <div className="fleet-form-grid">
                          <Field label="Vehicle / unit" htmlFor="fleet-report-vehicle" className="fleet-field--full">
                            <select className="fleet-select" id="fleet-report-vehicle" value={reportVehicleId} required onChange={(event) => {
                              const id = event.target.value
                              const vehicle = fleet.vehicles.find((item) => item.id === id)
                              setReportVehicleId(id)
                              setReportDraft({
                                ...reportDraftFor(fleet, vehicle, period),
                                ...(sharedMode && sharedUser?.role === 'Driver' ? { operator: sharedUser.displayName } : {}),
                              })
                            }}>
                              {filteredVehicles.filter((vehicle) => requiresMonthlyReport(vehicle, period)).map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.unit} · {vehicle.year} {vehicle.make} {vehicle.model}</option>)}
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
                            <input className="fleet-input" id="fleet-report-operator" value={reportDraft.operator} onChange={(event) => setReportDraft((draft) => ({ ...draft, operator: event.target.value }))} placeholder="e.g. Demo Operator" maxLength={80} required readOnly={sharedMode} disabled={Boolean(reportExisting && reportExisting.status !== 'Returned')} />
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
                            {reportDraft.condition !== 'Good' && <div className={'fleet-odometer-alert fleet-odometer-alert--' + (reportDraft.condition === 'Unsafe' ? 'error' : 'warning')}><ShieldAlert size={17} /><span>{reportDraft.condition === 'Unsafe' ? 'An unsafe condition will create or escalate a high-priority maintenance issue and place the vehicle on a service hold. Releasing it requires a separate authorized review.' : 'A condition needing attention will generate a maintenance issue for follow-through.'}</span></div>}
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
                            {reportExisting && <MetaLine label="Recorded revision" value={'v' + reportExisting.revision + ' · ' + getReportHistory(fleet, reportExisting.id).length + ' history events'} />}
                            {reportExisting && <button type="button" className="fleet-button fleet-button--quiet fleet-button--small" onClick={() => openReportHistory(reportExisting.id)}><History size={15} /> View revision history <ArrowRight size={14} /></button>}
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
                {reportsTab === 'review' && canReview && (
                  <FleetCard role="tabpanel" className="fleet-review-card">
                    <SectionTitle eyebrow="SUPERVISOR WORKFLOW" title="Pending approval" description={'Review submissions for ' + displayPeriod(period) + '. Approvals update the vehicle odometer and audit trail.'} action={<Tone tone="pending">{pendingReports.length} awaiting review</Tone>} />
                    <div className="fleet-reviewer-row">
                      <Field htmlFor="fleet-reviewer" label="Reviewer name">
                        <input id="fleet-reviewer" className="fleet-input" value={reviewer} onChange={(event) => setReviewer(event.target.value)} maxLength={80} readOnly={sharedMode} placeholder="Demo Supervisor" />
                      </Field>
                    </div>
                    {pendingReports.length ? (
                      <div className="fleet-review-list">
                        {pendingReports.map((report) => {
                          const vehicle = fleet.vehicles.find((candidate) => candidate.id === report.vehicleId)
                          return (
                            <article id={'fleet-review-item-' + report.id} tabIndex={-1} className={'fleet-review-item fleet-record-anchor ' + (selectedReviewId === report.id ? 'is-highlighted' : '')} key={report.id}>
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
                                <button type="button" className="fleet-button fleet-button--quiet" onClick={() => openReportHistory(report.id)}><History size={16} /> Revision history</button>
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
                        <thead><tr><th scope="col">Vehicle</th><th scope="col">Operator</th><th scope="col">Distance</th><th scope="col">Condition</th><th scope="col">Status</th><th scope="col">Revision</th><th scope="col">Actions</th></tr></thead>
                        <tbody>
                          {filteredReports.map((report) => {
                            const vehicle = fleet.vehicles.find((item) => item.id === report.vehicleId)
                            const qualityIssues = getReportQualityIssues(fleet, report.id)
                            return (
                              <Fragment key={report.id}>
                                <tr id={'fleet-history-report-' + report.id} tabIndex={-1} className={'fleet-record-anchor ' + (expandedReportId === report.id ? 'is-highlighted' : '')}>
                                  <td><VehicleName vehicle={vehicle} /></td>
                                  <td>{report.operator}<small className="fleet-table__meta">{timestamp(report.submittedAt)}</small></td>
                                  <td>{whole(report.endOdometer - report.startOdometer)} mi</td>
                                  <td><Tone tone={report.condition === 'Good' ? 'approved' : report.condition === 'Unsafe' ? 'high' : 'medium'}>{report.condition}</Tone></td>
                                  <td><Tone tone={report.status.toLowerCase()}>{report.status}</Tone>{qualityIssues.length > 0 && <small className="fleet-table__meta fleet-urgency">{qualityIssues.length} data checks</small>}</td>
                                  <td><strong>v{report.revision}</strong><small className="fleet-table__meta">{getReportHistory(fleet, report.id).length} events</small></td>
                                  <td><div className="fleet-form-actions">
                                  {report.status === 'Returned' && canSubmit && <button className="fleet-button fleet-button--small fleet-button--quiet" type="button" onClick={() => openReport(report.vehicleId)}>Correct <ArrowRight size={15} /></button>}
                                  {report.status === 'Pending' && canReview && <button className="fleet-button fleet-button--small fleet-button--quiet" type="button" onClick={() => openReview(report.id)}>Review <ArrowRight size={15} /></button>}
                                    <button className="fleet-button fleet-button--small fleet-button--quiet" type="button" aria-expanded={expandedReportId === report.id} onClick={() => setExpandedReportId((current) => current === report.id ? null : report.id)}>
                                      <History size={15} /> {expandedReportId === report.id ? 'Hide history' : 'History'}
                                    </button>
                                  </div></td>
                                </tr>
                                {expandedReportId === report.id && <tr className="fleet-history-expanded"><td colSpan={7}>
                                  {qualityIssues.length > 0 && <section className="fleet-quality-issues" aria-label="Report data-quality findings">
                                    <h4>Data-quality checks</h4>
                                    <ul>{qualityIssues.map((issue, i) => <li key={i}>{issue}</li>)}</ul>
                                    <p className="fleet-text-muted">Approved records are not edited silently. Reopening a record for correction retains the prior approved snapshot.</p>
                                    {canReview && report.status === 'Approved' && <button type="button" className="fleet-button fleet-button--quiet fleet-button--small" onClick={() => setCorrectionRequest({ reportId: report.id, vehicleId: report.vehicleId, period: report.period, reason: '' })}>Request correction <ArrowRight size={14} /></button>}
                                    {canManageFleet && <button type="button" className="fleet-button fleet-button--quiet fleet-button--small" onClick={() => {
                                      setQuarterScope(fiscalQuarterForPeriod(report.period))
                                      setQuarterQualityFilter('Quality')
                                      setExpandedQualityVehicleId(report.vehicleId)
                                      changePage('exports')
                                      setFocusTarget('fleet-quarter-quality-' + report.vehicleId)
                                    }}>Quarterly quality matrix <ArrowRight size={14} /></button>}
                                    {correctionRequest?.reportId === report.id && canReview && <form className="fleet-form fleet-quarterly-correction-form" onSubmit={submitApprovedCorrection}>
                                      <Field htmlFor={'fleet-history-correction-' + report.id} label="Reason to reopen this approved report">
                                        <textarea id={'fleet-history-correction-' + report.id} className="fleet-textarea" minLength={5} maxLength={400} required rows={3} value={correctionRequest.reason} onChange={(event) => setCorrectionRequest((current) => current ? { ...current, reason: event.target.value } : current)} placeholder="Explain which source evidence needs correction" />
                                      </Field>
                                      <div className="fleet-form-actions"><button type="submit" className="fleet-button fleet-button--primary" disabled={correctionRequest.reason.trim().length < 5}>Reopen for correction</button><button type="button" className="fleet-button fleet-button--quiet" onClick={() => setCorrectionRequest(null)}>Cancel</button></div>
                                    </form>}
                                  </section>}
                                  <ReportHistoryLedger entries={getReportHistory(fleet, report.id)} />
                                </td></tr>}
                              </Fragment>
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
                    <SectionTitle eyebrow="DIRECTORY MANAGEMENT" title="Add a vehicle or campus asset" description={sharedMode ? 'Adds a server-stored vehicle record. No official campus asset register is connected.' : "Adds a fictional record to this browser's Demo fleet."} action={<button type="button" className="fleet-icon-button" aria-label="Close new vehicle form" onClick={() => setVehicleFormOpen(false)}><X size={19} /></button>} />
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
                  <FleetCard id="fleet-vehicle-detail" className="fleet-vehicle-detail">
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
                        <div className="fleet-vehicle-detail__actions">{canSubmit && <button type="button" className="fleet-button fleet-button--primary" onClick={() => openReport(selectedVehicle.id)}><FileText size={16} /> Monthly report</button>}{canManageService && <button type="button" className="fleet-button fleet-button--quiet" onClick={() => openTicket(undefined, selectedVehicle.id)}><Wrench size={16} /> Raise issue</button>}{canManageFleet && <button type="button" className="fleet-button fleet-button--quiet" onClick={() => vehicleEditId === selectedVehicle.id ? setVehicleEditId(null) : beginVehicleEdit(selectedVehicle)} aria-expanded={vehicleEditId === selectedVehicle.id}><Pencil size={16} /> Edit vehicle</button>}</div>
                        <section className="fleet-vehicle-report-history" aria-label={'Monthly report versions for ' + selectedVehicle.unit}>
                          <div className="fleet-profile-form__heading"><h3>Monthly report versions</h3><span className="fleet-text-muted">Latest six months</span></div>
                          {fleet.reports.some((report) => report.vehicleId === selectedVehicle.id) ? (
                            <div className="fleet-table-wrap">
                              <table className="fleet-table">
                                <thead><tr><th scope="col">Month</th><th scope="col">Status</th><th scope="col">Revision</th><th scope="col">Action</th></tr></thead>
                                <tbody>{fleet.reports.filter((report) => report.vehicleId === selectedVehicle.id).sort((a, b) => b.period.localeCompare(a.period)).slice(0, 6).map((report) => (
                                  <tr key={report.id}>
                                    <td>{displayPeriod(report.period)}</td>
                                    <td><Tone tone={report.status.toLowerCase()}>{report.status}</Tone></td>
                                    <td>v{report.revision}<small className="fleet-table__meta">{getReportHistory(fleet, report.id).length} events</small></td>
                                    <td><button type="button" className="fleet-button fleet-button--quiet fleet-button--small" onClick={() => openReportHistory(report.id)}><History size={14} /> Open ledger</button></td>
                                  </tr>
                                ))}</tbody>
                              </table>
                            </div>
                          ) : <p className="fleet-text-muted">No monthly reports have been recorded for this vehicle.</p>}
                        </section>
                        {vehicleEditId === selectedVehicle.id && canManageFleet && (
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
                        {canManageFleet && <section className="fleet-vehicle-status-actions" aria-label="Vehicle service status">
                          <h3>Availability & service hold</h3>
                          <p className="fleet-text-muted">Status changes are logged in the local audit. Releasing a vehicle is a manual administrative action, separate from resolving repair tickets.</p>
                          {selectedVehicle.status === 'In maintenance' && <div className="fleet-banner fleet-banner--warning"><ShieldAlert size={18} /><span>This unit is held out of service. Resolve high-priority issues before marking it active. Complete real-world safety release procedures outside FleetSync.</span></div>}
                          <Field htmlFor="fleet-vehicle-status" label="New status"><select id="fleet-vehicle-status" className="fleet-select" value={vehicleStatusDraft} onChange={(event) => setVehicleStatusDraft(event.target.value as VehicleStatus)}>{(['Active', 'In maintenance', 'Retired'] as VehicleStatus[]).map((status) => <option key={status}>{status}</option>)}</select></Field>
                          {vehicleStatusDraft !== selectedVehicle.status && (
                            <>
                              <Field htmlFor="fleet-vehicle-status-note" label="Reason for status change (required)"><textarea id="fleet-vehicle-status-note" className="fleet-textarea" minLength={5} maxLength={400} required rows={2} value={vehicleStatusNote} placeholder="Record the hold, release review, or retirement reason" onChange={(event) => setVehicleStatusNote(event.target.value)} /></Field>
                              <button type="button" className="fleet-button fleet-button--primary" disabled={vehicleStatusNote.trim().length < 5} onClick={() => handleVehicleStatus(selectedVehicle)}><Check size={16} /> Save vehicle status</button>
                            </>
                          )}
                        </section>}
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
                    <SectionTitle eyebrow={role === 'Maintenance' ? 'TECHNICIAN WORKSPACE' : 'SERVICE WORKFLOW'} title={role === 'Maintenance' ? 'Assigned and open work orders' : 'Maintenance queue'} description="Filter by status, priority, assigned technician, or unit. Work orders retain their activity history." action={<Tone tone="medium">{filteredTickets.filter((ticket) => ticket.status !== 'Resolved').length} active</Tone>} />
                    {role === 'Maintenance' && (
                      <div className="fleet-role-summary fleet-role-summary--maintenance" data-testid="maintenance-workspace" aria-label="Technician work order status">
                        <div className="fleet-role-summary__body"><span className="fleet-eyebrow">SHOP WORK QUEUE</span><strong>{filteredTickets.filter((ticket) => ticket.status === 'Open').length} open · {filteredTickets.filter((ticket) => ticket.status === 'Scheduled').length} scheduled</strong><span>Choose a work order to assign a technician, schedule service, or record a repair outcome. Service holds are released separately.</span></div>
                        {canManageService && <button type="button" className="fleet-button fleet-button--primary fleet-button--small" onClick={() => {
                          const first = visibleMaintenanceTickets.find((ticket) => ticket.status !== 'Resolved')
                          if (first) openTicket(first.id)
                          else setTicketFormOpen(true)
                        }}>Open next work order <ArrowRight size={15} /></button>}
                      </div>
                    )}
                    <div className="fleet-tabs fleet-tabs--compact" role="group" aria-label="Filter maintenance status">
                      {(['Active', 'All', ...TICKET_STATUSES] as TicketFilter[]).map((status) => <button type="button" key={status} className={'fleet-tab ' + (ticketFilter === status ? 'is-active' : '')} aria-pressed={ticketFilter === status} onClick={() => setTicketFilter(status)}>{status}</button>)}
                    </div>
                    <div className="fleet-work-filters" aria-label="Search and filter work orders">
                      <Field htmlFor="fleet-work-search" label="Find work order">
                        <input id="fleet-work-search" className="fleet-input" type="search" maxLength={120} value={workSearch} onChange={(event) => setWorkSearch(event.target.value)} placeholder="Search unit, issue, department or technician" />
                      </Field>
                      <Field htmlFor="fleet-work-priority" label="Priority">
                        <select id="fleet-work-priority" className="fleet-select" value={workPriority} onChange={(event) => setWorkPriority(event.target.value as 'All' | Severity)}>
                          <option value="All">All priorities</option>{SEVERITIES.map((value) => <option key={value}>{value}</option>)}
                        </select>
                      </Field>
                      <Field htmlFor="fleet-work-assignment" label="Assigned">
                        <select id="fleet-work-assignment" className="fleet-select" value={workAssignment} onChange={(event) => setWorkAssignment(event.target.value as 'All' | 'Mine' | 'Unassigned')}>
                          <option value="All">All technicians</option>
                          {sharedMode && <option value="Mine">Assigned to me</option>}
                          <option value="Unassigned">Unassigned</option>
                        </select>
                      </Field>
                      <span className="fleet-work-filters__count">{visibleMaintenanceTickets.length} matching work orders</span>
                    </div>
                    <div className="fleet-ticket-list">
                      {visibleMaintenanceTickets.map((ticket) => {
                        const vehicle = fleet.vehicles.find((item) => item.id === ticket.vehicleId)
                        const daysOpen = elapsedDays(ticket.createdAt)
                        const serviceOverdue = ticket.status === 'Scheduled' && ticket.scheduledFor && ticket.scheduledFor < new Date().toISOString().slice(0, 10)
                        return (
                          <article id={'fleet-ticket-' + ticket.id} tabIndex={-1} className={'fleet-ticket fleet-record-anchor ' + (selectedTicketId === ticket.id ? 'is-highlighted' : '') + (serviceOverdue ? ' is-overdue' : '')} key={ticket.id}>
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
                              {canManageService && <button type="button" className="fleet-button fleet-button--small fleet-button--quiet" onClick={() => serviceEditId === ticket.id ? setServiceEditId(null) : beginServiceEdit(ticket)} aria-expanded={serviceEditId === ticket.id}><Settings2 size={16} /> {serviceEditId === ticket.id ? 'Close editor' : 'Update work'} <ChevronDown size={15} /></button>}
                              <button type="button" className="fleet-button fleet-button--small fleet-button--quiet" aria-expanded={expandedTicketHistoryId === ticket.id} onClick={() => setExpandedTicketHistoryId((id) => id === ticket.id ? null : ticket.id)}><History size={15} /> {expandedTicketHistoryId === ticket.id ? 'Hide activity' : 'Activity (' + getTicketHistory(fleet, ticket.id).length + ')'}</button>
                              {ticket.sourceReportId && (canReview || canSubmit) && <button type="button" className="fleet-button fleet-button--small fleet-button--quiet" onClick={() => openReportHistory(ticket.sourceReportId!)}>Source report <ArrowRight size={14} /></button>}
                            </div>
                            {serviceEditId === ticket.id && canManageService && (
                              <form className="fleet-form fleet-maintenance-editor" onSubmit={(event) => handleServiceUpdate(event, ticket)}>
                                <div className="fleet-maintenance-editor__heading"><h4>Service follow-through</h4><p>Changes are recorded in the local audit. A resolved ticket still requires an explicit administrative release from any vehicle service hold.</p></div>
                                <div className="fleet-form-grid">
                                  <Field label="Work status" htmlFor={'fleet-service-status-' + ticket.id}><select id={'fleet-service-status-' + ticket.id} className="fleet-select" value={serviceEdit.status} onChange={(event) => setServiceEdit((draft) => ({ ...draft, status: event.target.value as TicketStatus }))}>{TICKET_STATUSES.map((status) => <option key={status}>{status}</option>)}</select></Field>
                                  <Field label="Assigned technician / team" htmlFor={'fleet-service-assignee-' + ticket.id}><input id={'fleet-service-assignee-' + ticket.id} className="fleet-input" maxLength={80} required={serviceEdit.status !== 'Open'} value={serviceEdit.assignee} placeholder="Garage team" onChange={(event) => setServiceEdit((draft) => ({ ...draft, assignee: event.target.value }))} /></Field>
                                  <Field label="Scheduled service date" htmlFor={'fleet-service-date-' + ticket.id}><input id={'fleet-service-date-' + ticket.id} className="fleet-input" type="date" value={serviceEdit.scheduledFor} required={serviceEdit.status === 'Scheduled'} onChange={(event) => setServiceEdit((draft) => ({ ...draft, scheduledFor: event.target.value }))} /></Field>
                                  <Field label="Actual service cost (USD)" htmlFor={'fleet-service-cost-' + ticket.id}><input id={'fleet-service-cost-' + ticket.id} className="fleet-input" type="number" min={0} step="0.01" value={serviceEdit.actualCost} placeholder="Optional" onChange={(event) => setServiceEdit((draft) => ({ ...draft, actualCost: event.target.value }))} /></Field>
                                  <Field label="Repair outcome / resolution note" htmlFor={'fleet-service-resolution-' + ticket.id} hint="Required when marking resolved. Record the action performed and any follow-up." className="fleet-field--full"><textarea id={'fleet-service-resolution-' + ticket.id} className="fleet-textarea" maxLength={1000} rows={3} required={serviceEdit.status === 'Resolved'} value={serviceEdit.resolutionNote} placeholder="Explain service performed, parts, testing, or next steps" onChange={(event) => setServiceEdit((draft) => ({ ...draft, resolutionNote: event.target.value }))} /></Field>
                                  {ticket.status === 'Resolved' && serviceEdit.status !== 'Resolved' && <Field label="Reason for reopening (required)" htmlFor={'fleet-service-reopen-' + ticket.id} className="fleet-field--full"><textarea id={'fleet-service-reopen-' + ticket.id} className="fleet-textarea" rows={2} minLength={5} maxLength={400} required value={serviceEdit.reopenReason} placeholder="Describe what additional work or symptoms require reopening" onChange={(event) => setServiceEdit((draft) => ({ ...draft, reopenReason: event.target.value }))} /></Field>}
                                </div>
                                <div className="fleet-form-actions"><button className="fleet-button fleet-button--primary" type="submit"><Check size={16} /> Save service update</button><button type="button" className="fleet-button fleet-button--quiet" onClick={() => setServiceEditId(null)}>Cancel</button></div>
                              </form>
                            )}
                            {expandedTicketHistoryId === ticket.id && <TicketHistoryLedger entries={getTicketHistory(fleet, ticket.id)} />}
                          </article>
                        )
                      })}
                      {!visibleMaintenanceTickets.length && <Empty icon={CheckCircle2} title="No work orders match these filters" description={workAssignment === 'Mine' ? 'No work orders are assigned to your account by display name. Select All technicians to see the full permitted queue.' : 'Try another status, priority, assignee or search term.'} action={<button type="button" className="fleet-button fleet-button--quiet fleet-button--small" onClick={() => { setWorkAssignment('All'); setWorkSearch(''); setWorkPriority('All'); setTicketFilter('Active') }}>Clear work filters</button>} />}
                    </div>
                  </FleetCard>
                  <div className="fleet-stack">
                    {ticketFormOpen && canManageService && (
                      <FleetCard className="fleet-create-card">
                        <SectionTitle eyebrow="NEW SERVICE ISSUE" title="Create a maintenance ticket" action={<button type="button" className="fleet-icon-button" aria-label="Close maintenance issue form" onClick={() => setTicketFormOpen(false)}><X size={19} /></button>} />
                        <form id="fleet-new-ticket-form" tabIndex={-1} className="fleet-form fleet-record-anchor" onSubmit={handleAddTicket}>
                          <Field label="Vehicle" htmlFor="fleet-new-ticket-vehicle"><select className="fleet-select" id="fleet-new-ticket-vehicle" value={ticketDraft.vehicleId} required onChange={(event) => setTicketDraft((draft) => ({ ...draft, vehicleId: event.target.value }))}>{filteredVehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.unit} · {vehicle.make} {vehicle.model}</option>)}</select></Field>
                          <Field label="Issue title" htmlFor="fleet-new-ticket-title"><input className="fleet-input" id="fleet-new-ticket-title" maxLength={100} required value={ticketDraft.title} placeholder="e.g. Brake system inspection" onChange={(event) => setTicketDraft((draft) => ({ ...draft, title: event.target.value }))} /></Field>
                          <Field label="Severity" htmlFor="fleet-new-ticket-severity"><select className="fleet-select" id="fleet-new-ticket-severity" value={ticketDraft.severity} onChange={(event) => setTicketDraft((draft) => ({ ...draft, severity: event.target.value as Severity }))}>{SEVERITIES.map((severity) => <option key={severity}>{severity}</option>)}</select></Field>
                          <Field label="Assigned to (optional)" htmlFor="fleet-new-ticket-assignee"><input className="fleet-input" id="fleet-new-ticket-assignee" maxLength={80} value={ticketDraft.assignee} placeholder="Garage team or technician" onChange={(event) => setTicketDraft((draft) => ({ ...draft, assignee: event.target.value }))} /></Field>
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
                      {!ticketFormOpen && canManageService && <button type="button" className="fleet-button fleet-button--quiet fleet-button--block" onClick={() => { setTicketDraft(blankTicketDraft(filteredVehicles[0]?.id)); setTicketFormOpen(true) }}><Plus size={16} /> Log a service issue</button>}
                    </FleetCard>
                    <FleetCard className="fleet-warning-card">
                      <h3>Service holds and safety reports</h3><p>Unsafe driver reports generate a high-priority work order and place a service hold. Resolving the work order does not automatically release the vehicle. Real safety decisions require separate institutional procedures.</p>
                    </FleetCard>
                  </div>
                </div>
              </>
            )}

            {view === 'exports' && canManageFleet && (
              <>
                <div className="fleet-banner fleet-banner--warning fleet-export-disclaimer"><AlertTriangle size={21} /><div><strong>Internal review staging only. No state submission.</strong><p>Monthly and fiscal quarterly CSV worksheets are administrative reconciliation aids. They are not validated TxFS batch layouts, have not been certified by Texas OVFM, and are never transmitted to state systems.</p></div></div>
                <FleetCard className="fleet-quarterly-panel">
                  <SectionTitle
                    eyebrow="FISCAL QUARTER RECONCILIATION"
                    title="Three-month readiness"
                    description="Texas-style fiscal quarters run September–November, December–February, March–May, and June–August. Only licensed vehicles are counted in this staging review."
                    action={<Tone tone={quarterData.completion === 100 ? 'approved' : 'pending'}>{fiscalQuarterLabel(quarterScope.fiscalYear, quarterScope.quarter)}</Tone>}
                  />
                  <p className="fleet-text-muted fleet-quarterly-current-note">In-progress quarters may show missing months that are not yet overdue. Department monthly due dates are configurable local settings and separate from the state's quarterly submission window.</p>
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
                    <div><strong>{quarterData.expected ? quarterData.completion + '%' : 'N/A'}</strong><span>Month records approved</span></div>
                    <div><strong>{quarterData.approved}/{quarterData.expected}</strong><span>Approved / expected</span></div>
                    <div><strong>{quarterData.readyVehicles}/{quarterData.vehicles.length}</strong><span>Units reconciled for required months</span></div>
                    <div><strong>{quarterData.missing + quarterData.returned + quarterData.pending}</strong><span>Gaps to reconcile</span></div>
                    <div className="fleet-quarterly-quality"><strong>{quarterData.dataQualityIssues}</strong><span>Data quality findings ({quarterData.vehiclesWithQualityIssues} units)</span></div>
                  </div>
                  <div className="fleet-progress" role="progressbar" aria-label="Quarterly monthly record approval completeness" aria-valuenow={quarterData.expected ? quarterData.completion : 0} aria-valuemin={0} aria-valuemax={100}><span style={{ width: (quarterData.expected ? quarterData.completion : 0) + '%' }} /></div>
                  <div className="fleet-quarterly-months">
                    {quarterMonths.map((month) => {
                      const approved = quarterData.vehicles.filter((item) => item.monthlyStatus[month] === 'Approved').length
                      const pending = quarterData.vehicles.filter((item) => item.monthlyStatus[month] === 'Pending').length
                      const returned = quarterData.vehicles.filter((item) => item.monthlyStatus[month] === 'Returned').length
                      const missing = quarterData.vehicles.filter((item) => item.monthlyStatus[month] === 'Missing').length
                      const notRequired = quarterData.vehicles.filter((item) => item.monthlyStatus[month] === 'Not required').length
                      const required = quarterData.vehicles.length - notRequired
                      return (
                        <div className={'fleet-quarterly-month ' + (month > currentPeriod() ? 'is-upcoming' : '')} key={month}>
                          <h3>{displayPeriod(month)}</h3>
                          {month > currentPeriod() && <span className="fleet-eyebrow">UPCOMING MONTH</span>}
                          <div className="fleet-quarterly-month__counts"><strong>{approved}/{required}</strong><span>Approved / required</span></div>
                          <div className="fleet-quarterly-month__detail">{pending > 0 && <Tone tone="pending">{pending} pending</Tone>}{returned > 0 && <Tone tone="returned">{returned} returned</Tone>}{missing > 0 && <Tone tone="muted">{missing} missing</Tone>}{notRequired > 0 && <Tone tone="muted">{notRequired} not required</Tone>}{required > 0 && approved === required && <Tone tone="approved">Approved</Tone>}{required === 0 && <Tone tone="muted">No reports required</Tone>}</div>
                        </div>
                      )
                    })}
                  </div>
                  <div className="fleet-quarterly-grid">
                    <SectionTitle eyebrow="RECONCILIATION MATRIX" title="Vehicle-by-month status" description="Open missing, returned or pending records directly. Data-quality findings are separate from approval status and require source-record inspection." action={<button type="button" className="fleet-button fleet-button--primary" disabled={!quarterExport.count} onClick={downloadQuarterCsv}><Download size={16} /> Download quarter review ({quarterExport.count})</button>} />
                    <div className="fleet-tabs fleet-tabs--compact" role="group" aria-label="Quarterly reconciliation filter">
                      <button type="button" className={'fleet-tab ' + (quarterQualityFilter === 'All' ? 'is-active' : '')} aria-pressed={quarterQualityFilter === 'All'} onClick={() => setQuarterQualityFilter('All')}>All units ({quarterData.vehicles.length})</button>
                      <button type="button" className={'fleet-tab ' + (quarterQualityFilter === 'Incomplete' ? 'is-active' : '')} aria-pressed={quarterQualityFilter === 'Incomplete'} onClick={() => setQuarterQualityFilter('Incomplete')}>Unapproved months ({quarterData.vehicles.filter((row) => row.approvedMonths < row.expectedMonths).length})</button>
                      <button type="button" className={'fleet-tab ' + (quarterQualityFilter === 'Quality' ? 'is-active' : '')} aria-pressed={quarterQualityFilter === 'Quality'} onClick={() => setQuarterQualityFilter('Quality')}>Data checks ({quarterData.vehiclesWithQualityIssues})</button>
                    </div>
                    <div className="fleet-table-wrap">
                      <table className="fleet-table fleet-quarterly-reconcile">
                        <thead><tr><th scope="col">Licensed vehicle</th>{quarterMonths.map((month) => <th scope="col" key={month}>{displayPeriod(month)}</th>)}<th scope="col">Quarter total</th><th scope="col">Reconciliation</th></tr></thead>
                        <tbody>{quarterRows.map((row) => (
                          <Fragment key={row.vehicle.id}>
                          <tr className={row.ready ? 'is-ready' : 'has-gaps'}>
                            <td><VehicleName vehicle={row.vehicle} /><small className="fleet-table__meta">{row.vehicle.department}</small></td>
                            {quarterMonths.map((month) => {
                              const status = row.monthlyStatus[month]
                              return (
                                <td key={month}>
                                  {status === 'Approved'
                                    ? <Tone tone="approved"><Check size={12} /> Approved</Tone>
                                    : status === 'Not required' ? <Tone tone="muted">Not required</Tone>
                                    : <button type="button" className="fleet-quarterly-gap" aria-label={status + ' for ' + row.vehicle.unit + ' in ' + displayPeriod(month) + '. Open workflow'} onClick={() => openQuarterGap(row.vehicle, month)} disabled={month > currentPeriod()}>
                                      <Tone tone={status === 'Missing' ? 'muted' : status.toLowerCase()}>{status}</Tone><ArrowRight size={14} />
                                    </button>}
                                </td>
                              )
                            })}
                            <td><strong>{whole(row.miles)} mi</strong><small className="fleet-table__meta">{currency(row.fuelCost)}</small></td>
                            <td>
                              <Tone tone={row.ready ? 'approved' : 'returned'}>{row.expectedMonths === 0 ? 'Not required' : row.ready ? 'Reconciled' : row.approvedMonths + ' of ' + row.expectedMonths + ' approved'}</Tone>
                              {row.qualityIssues.length > 0 && <button type="button" className="fleet-button fleet-button--small fleet-button--quiet fleet-quarterly-gap" aria-expanded={expandedQualityVehicleId === row.vehicle.id} onClick={() => setExpandedQualityVehicleId((id) => id === row.vehicle.id ? null : row.vehicle.id)}>
                                <AlertCircle size={14} /> {row.qualityIssues.length} data {row.qualityIssues.length === 1 ? 'issue' : 'issues'} <ChevronDown size={14} />
                              </button>}
                            </td>
                          </tr>
                          {expandedQualityVehicleId === row.vehicle.id && row.qualityIssues.length > 0 && (
                            <tr id={'fleet-quarter-quality-' + row.vehicle.id} tabIndex={-1} className="fleet-quality-row fleet-record-anchor"><td colSpan={6}>
                              <section className="fleet-quality-issues" aria-label={'Data quality findings for ' + row.vehicle.unit}>
                                <h4>{row.vehicle.unit} · Record-level data checks</h4>
                                <p className="fleet-text-muted">Inspect the source history before requesting correction. Reopening an approved report changes it to Returned and retains the prior approved snapshot.</p>
                                <ol>{row.qualityIssues.map((issue, index) => <li key={index}>
                                  <span>{issue}</span>
                                  <button type="button" className="fleet-button fleet-button--quiet fleet-button--small" onClick={() => openQuarterQualityIssue(row.vehicle, issue)}>Inspect record <ArrowRight size={14} /></button>
                                  <button type="button" className="fleet-button fleet-button--quiet fleet-button--small" onClick={() => beginApprovedCorrection(row.vehicle, issue)}><Pencil size={14} /> Request correction</button>
                                </li>)}</ol>
                                {correctionRequest?.vehicleId === row.vehicle.id && (
                                  <form className="fleet-form fleet-quarterly-correction-form" onSubmit={submitApprovedCorrection}>
                                    <Field htmlFor={'fleet-quarter-correction-' + row.vehicle.id} label="Reason for reopening approved record (required)" hint={'This changes ' + displayPeriod(correctionRequest.period) + ' to Returned and keeps the approved version in the history ledger.'}>
                                      <textarea id={'fleet-quarter-correction-' + row.vehicle.id} className="fleet-textarea" rows={3} minLength={5} maxLength={400} required value={correctionRequest.reason} onChange={(event) => setCorrectionRequest((current) => current ? { ...current, reason: event.target.value } : current)} placeholder="Describe the missing evidence, incorrect source attribution, or other data issue" />
                                    </Field>
                                    <div className="fleet-form-actions">
                                      <button type="submit" className="fleet-button fleet-button--primary" disabled={correctionRequest.reason.trim().length < 5}><Check size={15} /> Reopen report for correction</button>
                                      <button type="button" className="fleet-button fleet-button--quiet" onClick={() => setCorrectionRequest(null)}>Cancel</button>
                                    </div>
                                  </form>
                                )}
                                <button type="button" className="fleet-button fleet-button--quiet fleet-button--small" onClick={() => openVehicle(row.vehicle.id)}>Vehicle directory <ArrowRight size={14} /></button>
                              </section>
                            </td></tr>
                          )}
                          </Fragment>
                        ))}</tbody>
                      </table>
                    </div>
                    {!quarterData.vehicles.length && <Empty icon={Truck} title="No licensed vehicles in this scope" description="Choose another department or add a licensed vehicle to include it in the quarter reconciliation." />}
                    {quarterData.vehicles.length > 0 && !quarterRows.length && <Empty icon={CheckCircle2} title={quarterQualityFilter === 'Quality' ? 'No data-quality findings' : 'No unapproved months'} description="The current quarter and department have no records matching this filter." />}
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
                        const recordedUnit = report.unitAtSubmission ?? vehicle?.unit
                        const recordedDepartment = report.departmentAtSubmission ?? vehicle?.department
                        return <tr key={report.id}>
                          <td><strong>{recordedUnit ?? '—'}</strong>{vehicle && recordedUnit !== vehicle.unit && <small className="fleet-table__meta">Current: {vehicle.unit}</small>}{report.attributionSource === 'Legacy inferred' && <small className="fleet-table__meta">Legacy attribution inferred</small>}</td>
                          <td>{recordedDepartment ?? '—'}{vehicle && recordedDepartment !== vehicle.department && <small className="fleet-table__meta">Current: {vehicle.department}</small>}</td>
                          <td>{displayPeriod(report.period)}</td><td>{whole(report.endOdometer - report.startOdometer)} mi</td><td>{currency(report.fuelCost)}</td><td>{report.reviewedBy ?? '—'}</td>
                        </tr>
                      })}</tbody>
                    </table>
                  </div>
                  {!exportRecords.length && <Empty icon={FileSpreadsheet} title="No export-ready records" description="Only approved monthly reports for licensed vehicles will appear here." action={<button type="button" className="fleet-button fleet-button--quiet" onClick={() => { setReportsTab('review'); changePage('reports') }}>Review reports <ArrowRight size={16} /></button>} />}
                </FleetCard>
                <FleetCard className="fleet-audit-card">
                  <SectionTitle eyebrow="TRACEABILITY" title="Activity & audit log" description={sharedMode ? 'Authenticated local server activity history. This is not a tamper-proof or certified institutional audit system.' : 'Browser-local demo activity. This log is illustrative and has no tamper protection or server validation.'} action={<Tone tone="muted">{auditEntries.length} entries</Tone>} />
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
