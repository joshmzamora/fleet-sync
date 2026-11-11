import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import {
  AlertCircle,
  AlertTriangle,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
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
  Plus,
  RotateCcw,
  Search,
  Send,
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
  buildReviewCsv,
  CONDITIONS,
  createDemoFleet,
  currentPeriod,
  DEPARTMENTS,
  displayPeriod,
  fleetMetrics,
  getExceptions,
  loadFleetState,
  reviewMonthlyReport,
  ROLES,
  saveFleetState,
  SEVERITIES,
  shiftPeriod,
  submitMonthlyReport,
  TICKET_STATUSES,
  updateMaintenanceTicket,
  VEHICLE_KINDS,
} from './domain'
import type {
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
}

type TicketDraft = {
  vehicleId: string
  title: string
  description: string
  severity: Severity
  assignee: string
}

type Toast = { id: number; kind: 'success' | 'error' | 'info'; message: string }

const NAV: { id: View; label: string; icon: LucideIcon; description: string }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard, description: 'Fleet health and action queue' },
  { id: 'reports', label: 'Monthly reports', icon: ClipboardList, description: 'Use logs and supervisor approvals' },
  { id: 'vehicles', label: 'Vehicles', icon: Truck, description: 'Vehicle directory and custodians' },
  { id: 'maintenance', label: 'Maintenance', icon: Wrench, description: 'Service issues and triage' },
  { id: 'exports', label: 'Exports & audit', icon: FileSpreadsheet, description: 'Review-only records and history' },
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
  }
}

function blankTicketDraft(vehicleId = ''): TicketDraft {
  return { vehicleId, title: '', description: '', severity: 'Medium', assignee: '' }
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
    return blankReportDraft(vehicle, vehicle ? activeReportFor(fleet, vehicle.id, currentPeriod()) : undefined)
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
  const metrics = useMemo(() => fleetMetrics(fleet, period, department), [fleet, period, department])
  const exceptions = useMemo(() => getExceptions(fleet, period, department), [fleet, period, department])
  const pendingReports = useMemo(() => filteredReports.filter((report) => report.status === 'Pending'), [filteredReports])
  const selectedVehicle = fleet.vehicles.find((vehicle) => vehicle.id === selectedVehicleId)
  const reportVehicle = fleet.vehicles.find((vehicle) => vehicle.id === reportVehicleId)
  const reportExisting = reportVehicle ? activeReportFor(fleet, reportVehicle.id, period) : undefined
  const exportData = useMemo(() => buildReviewCsv(fleet, period, department), [fleet, period, department])
  const exportRecords = useMemo(
    () => filteredReports.filter((report) => report.status === 'Approved' && fleet.vehicles.some((vehicle) => vehicle.id === report.vehicleId && vehicle.licensed)),
    [filteredReports, fleet.vehicles],
  )

  useEffect(() => {
    const vehicle = filteredVehicles.find((item) => item.id === reportVehicleId && item.status !== 'Retired') ??
      filteredVehicles.find((item) => item.status !== 'Retired')
    setReportVehicleId(vehicle?.id ?? '')
    setReportDraft(blankReportDraft(vehicle, vehicle ? activeReportFor(fleet, vehicle.id, period) : undefined))
    // The form should refresh on filter/period changes, not on unrelated audit events.
  }, [department, period, reportVehicleId, fleet.vehicles])

  useEffect(() => {
    if (selectedVehicleId && filteredIds.has(selectedVehicleId)) return
    setSelectedVehicleId(filteredVehicles[0]?.id ?? null)
  }, [filteredIds, selectedVehicleId, filteredVehicles])

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
      setReportDraft(blankReportDraft(vehicle, vehicle ? activeReportFor(fleetRef.current, vehicle.id, period) : undefined))
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
    if (/^\d{4}-(0[1-9]|1[0-2])$/.test(next) && next <= currentPeriod()) setPeriod(next)
  }

  const openReport = (vehicleId: string) => {
    const vehicle = fleetRef.current.vehicles.find((candidate) => candidate.id === vehicleId)
    if (!vehicle) return
    if (department !== 'All departments' && department !== vehicle.department) setDepartment('All departments')
    setReportVehicleId(vehicleId)
    setReportDraft(blankReportDraft(vehicle, activeReportFor(fleetRef.current, vehicleId, period)))
    setReportsTab('submit')
    changePage('reports')
  }

  const openReview = (reportId: string) => {
    setSelectedReviewId(reportId)
    setReportsTab('review')
    changePage('reports')
  }

  const openTicket = (ticketId?: string, vehicleId?: string) => {
    if (ticketId) {
      setSelectedTicketId(ticketId)
      setTicketFilter('All')
      setTicketFormOpen(false)
    } else if (vehicleId) {
      setTicketDraft(blankTicketDraft(vehicleId))
      setTicketFormOpen(true)
      setSelectedTicketId(null)
    }
    changePage('maintenance')
  }

  const exceptionAction = (item: FleetException) => {
    if (item.type === 'Missing report' || item.type === 'Returned report') openReport(item.vehicleId)
    else if (item.type === 'Awaiting approval' && item.reportId) openReview(item.reportId)
    else if (item.type === 'Open maintenance') openTicket(item.ticketId)
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

  const handleReportSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!reportVehicleId) return toast('Choose a vehicle to report.', 'error')
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

  const handleTicketStatus = (ticket: MaintenanceTicket, next: TicketStatus) => {
    commit((current) => updateMaintenanceTicket(current, ticket.id, next, 'Demo ' + role), 'Maintenance issue marked ' + next.toLowerCase() + '.')
  }

  const downloadCsv = () => {
    if (!exportData.count) return toast('No approved licensed-vehicle reports match the selected filters.', 'error')
    try {
      const file = new Blob(['\uFEFF', exportData.csv], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(file)
      const a = document.createElement('a')
      a.href = url
      a.download = 'fleetsync-review-only-' + period + (department !== 'All departments' ? '-' + department.toLowerCase().replace(/[^a-z0-9]+/g, '-') : '') + '.csv'
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 5000)
      toast('Review-only CSV downloaded. This is not a TxFS certified submission file.')
    } catch (error) {
      toast(error instanceof Error ? error.message : 'CSV download failed.', 'error')
    }
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
    setReportDraft(blankReportDraft(firstReportable))
    setVehicleFormOpen(false)
    setTicketFormOpen(false)
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
    <div className="fleet-app">
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
          <span className="fleet-brand-copy fleet-brand__copy"><strong>FleetSync<span className="fleet-brand__dot">.</span></strong><small>UNIVERSITY OPERATIONS</small></span>
          {mobileNavOpen && <button type="button" className="fleet-icon-button fleet-sidebar__close" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)}><X size={20} /></button>}
        </div>
        <div className="fleet-sidebar__body">
          <div className="fleet-nav-label fleet-nav__eyebrow">WORKSPACE</div>
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
                  {item.id === 'maintenance' && metrics.tickets > 0 && <span className="fleet-nav__count">{metrics.tickets}</span>}
                </button>
              )
            })}
          </nav>
          <div className="fleet-nav-label fleet-nav__eyebrow fleet-nav__eyebrow--secondary">CAMPUS TOOLS</div>
          <a className="fleet-nav__item fleet-nav__external" href="/campus-map">
            <MapPinned size={19} strokeWidth={1.85} /><span>Campus map</span><ExternalLink size={15} />
          </a>
        </div>
        <div className="fleet-sidebar__footer">
          <div className="fleet-sidebar__demo"><span className="fleet-sidebar__demo-dot" /> <strong>Local demo workspace</strong></div>
          <p>Fictional sample vehicle records. Changes stay in this browser.</p>
          <button type="button" className="fleet-sidebar__reset" onClick={resetDemo}><RotateCcw size={15} /> Reset demo data</button>
          <span className="fleet-sidebar__version">FleetSync · MVP 0.1</span>
        </div>
      </aside>

      <div className="fleet-workspace">
        <header className="fleet-topbar">
          <div className="fleet-topbar-left fleet-topbar__left">
            <button type="button" className="fleet-mobile-menu fleet-menu-button" aria-label="Open navigation" aria-expanded={mobileNavOpen} onClick={() => setMobileNavOpen(true)}><Menu size={22} /></button>
            <span className="fleet-breadcrumbs fleet-topbar__breadcrumb"><span>Workspace</span><ChevronRight size={15} /><strong>{navCurrent.label}</strong></span>
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
                <span className="fleet-eyebrow">{view === 'overview' ? 'CAMPUS FLEET OPERATIONS' : navCurrent.description.toUpperCase()}</span>
                <h1>{view === 'overview' ? 'Fleet overview' : navCurrent.label}</h1>
                <p>
                  {view === 'overview' && 'Your campus fleet at a glance. Prioritize missing records, approvals, and service needs.'}
                  {view === 'reports' && 'Capture monthly usage, return corrections, and review department submissions.'}
                  {view === 'vehicles' && 'A single directory of vehicles, custodians, and monthly reporting status.'}
                  {view === 'maintenance' && 'Triage service needs and track work from open to resolved.'}
                  {view === 'exports' && 'Review approved usage records and download a staging CSV for administrative review.'}
                </p>
              </div>
              <div className="fleet-page-heading__actions">
                {view === 'overview' && <button className="fleet-button fleet-button--primary" type="button" onClick={() => {
                  const vehicle = preferredReportVehicle(fleetRef.current, period, department)
                  setReportVehicleId(vehicle?.id ?? '')
                  setReportDraft(blankReportDraft(vehicle, vehicle ? activeReportFor(fleetRef.current, vehicle.id, period) : undefined))
                  setReportsTab('submit')
                  changePage('reports')
                }}><Plus size={17} /> New report</button>}
                {view === 'vehicles' && <button className="fleet-button fleet-button--primary" type="button" onClick={() => setVehicleFormOpen(true)}><Plus size={17} /> Add vehicle</button>}
                {view === 'maintenance' && <button className="fleet-button fleet-button--primary" type="button" onClick={() => { setTicketDraft(blankTicketDraft(filteredVehicles[0]?.id)); setTicketFormOpen(true) }}><Plus size={17} /> New issue</button>}
                {view === 'exports' && <button className="fleet-button fleet-button--primary" type="button" disabled={!exportData.count} onClick={downloadCsv}><Download size={17} /> Download review CSV</button>}
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
              <span className="fleet-filter__scope"><Filter size={15} /> {filteredVehicles.length} vehicles in scope</span>
            </div>

            {view === 'overview' && (
              <>
                <div className="fleet-kpi-grid">
                  {[
                    { label: 'Active vehicles', value: whole(metrics.vehicles), detail: metrics.licensed + ' licensed · ' + (metrics.vehicles - metrics.licensed) + ' other assets', icon: Truck, kind: 'green' },
                    { label: 'Monthly reporting', value: metrics.completion + '%', detail: metrics.reported + ' of ' + metrics.vehicles + ' submitted', icon: ClipboardCheck, kind: 'orange' },
                    { label: 'Needs approval', value: String(metrics.pending), detail: metrics.approved + ' approved · ' + metrics.returned + ' returned', icon: Clock3, kind: 'blue' },
                    { label: 'Open service issues', value: String(metrics.tickets), detail: exceptions.filter((item) => item.priority === 'High').length + ' high-priority exceptions', icon: Wrench, kind: 'red' },
                  ].map((item) => {
                    const Icon = item.icon
                    return (
                    <div className={'fleet-kpi-card fleet-kpi-card--' + item.kind} key={item.label}>
                        <div className="fleet-kpi-top fleet-kpi-card__top"><span className="fleet-kpi-label">{item.label}</span><span className="fleet-kpi-icon fleet-kpi-card__icon"><Icon size={21} /></span></div>
                        <strong className="fleet-kpi-value fleet-kpi-card__value">{item.value}</strong>
                        <small className="fleet-kpi-bottom">{item.detail}</small>
                      </div>
                    )
                  })}
                </div>

                <div className="fleet-grid fleet-overview-grid">
                  <FleetCard className="fleet-overview-card">
                    <SectionTitle
                      eyebrow="REPORTING HEALTH"
                      title={displayPeriod(period) + ' readiness'}
                      description="Monthly use reports submitted across the current scope."
                      action={<Tone tone={completion === 100 ? 'approved' : 'pending'}>{completion}% complete</Tone>}
                    />
                    <div className="fleet-progress" role="progressbar" aria-label="Monthly report submission completion" aria-valuemin={0} aria-valuemax={100} aria-valuenow={completion}>
                      <span style={{ width: completion + '%' }} />
                    </div>
                    <div className="fleet-readiness-numbers">
                      <div><strong>{metrics.approved}</strong><span>Approved</span></div>
                      <div><strong>{metrics.pending}</strong><span>Pending</span></div>
                      <div><strong>{metrics.returned}</strong><span>Returned</span></div>
                      <div><strong>{metrics.missing}</strong><span>Missing</span></div>
                    </div>
                    <div className="fleet-quick-stats">
                      <div><Gauge size={20} /><span><strong>{whole(metrics.miles)} mi</strong><small>Approved reported use</small></span></div>
                      <div><Fuel size={20} /><span><strong>{currency(metrics.fuelCost)}</strong><small>Approved reported fuel cost</small></span></div>
                    </div>
                  </FleetCard>

                  <FleetCard className="fleet-actions-card">
                    <SectionTitle eyebrow="WORK QUEUE" title="Needs your attention" action={<Tone tone={exceptions.length ? 'pending' : 'approved'}>{exceptions.length} exceptions</Tone>} />
                    <p className="fleet-text-muted">Resolve incomplete records before preparing the month for review.</p>
                    <div className="fleet-exception-list">
                      {exceptions.length ? (showAllExceptions ? exceptions : exceptions.slice(0, 6)).map((item) => {
                        const vehicle = fleet.vehicles.find((candidate) => candidate.id === item.vehicleId)
                        return (
                          <div className="fleet-exception" key={item.id}>
                            <span className={'fleet-exception__priority fleet-exception__priority--' + item.priority.toLowerCase()}>
                              {item.priority === 'High' ? <AlertTriangle size={17} /> : <AlertCircle size={17} />}
                            </span>
                            <div className="fleet-exception__body">
                              <div className="fleet-exception__heading"><strong>{item.label}</strong><Tone tone={item.priority.toLowerCase()}>{item.priority}</Tone></div>
                              <span className="fleet-exception__type">{item.type}{vehicle ? ' · ' + vehicle.department : ''}</span>
                              <p>{item.detail}</p>
                            </div>
                            <div className="fleet-exception__actions">
                              <button className="fleet-button fleet-button--small fleet-button--quiet" type="button" onClick={() => exceptionAction(item)} aria-label={'Open ' + item.type + ' for ' + item.label}>
                                {item.type === 'Missing report' || item.type === 'Returned report' ? 'Report' : item.type === 'Awaiting approval' ? 'Review' : 'Triage'} <ArrowRight size={15} />
                              </button>
                            </div>
                          </div>
                        )
                      }) : <Empty icon={CheckCheck} title="You're all caught up" description="No exceptions for this month and department." />}
                    </div>
                    {exceptions.length > 6 && <button className="fleet-button fleet-button--quiet fleet-button--block" type="button" onClick={() => setShowAllExceptions((value) => !value)}>{showAllExceptions ? 'Show fewer exceptions' : 'Show all ' + exceptions.length + ' exceptions'} <ChevronDown size={16} /></button>}
                  </FleetCard>
                </div>

                <FleetCard>
                  <SectionTitle eyebrow="AT A GLANCE" title="Recent fleet activity" description="Recorded actions in your local demo workspace." action={<button type="button" className="fleet-button fleet-button--quiet fleet-button--small" onClick={() => changePage('exports')}>Full audit log <ArrowRight size={15} /></button>} />
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
                              setReportDraft(blankReportDraft(vehicle, activeReportFor(fleet, id, period)))
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
                        <div className="fleet-form-actions fleet-form__actions">
                          <button className="fleet-button fleet-button--primary" type="submit" disabled={!reportVehicleId || Boolean(reportExisting && reportExisting.status !== 'Returned')}>
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
                            <MetaLine label="Reporting month" value={displayPeriod(period)} />
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
                          <button type="button" key={vehicle.id} className={'fleet-vehicle-row ' + (selectedVehicleId === vehicle.id ? 'is-active' : '')} onClick={() => setSelectedVehicleId(vehicle.id)} aria-pressed={selectedVehicleId === vehicle.id}>
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
                          <MetaLine label={displayPeriod(period) + ' report'} value={activeReportFor(fleet, selectedVehicle.id, period) ? <Tone tone={activeReportFor(fleet, selectedVehicle.id, period)!.status.toLowerCase()}>{activeReportFor(fleet, selectedVehicle.id, period)!.status}</Tone> : <Tone tone="muted">Missing</Tone>} />
                          <MetaLine label="Service issues" value={fleet.tickets.filter((ticket) => ticket.vehicleId === selectedVehicle.id && ticket.status !== 'Resolved').length + ' open'} />
                        </div>
                        <div className="fleet-vehicle-detail__actions"><button type="button" className="fleet-button fleet-button--primary" onClick={() => openReport(selectedVehicle.id)}><FileText size={16} /> Monthly report</button><button type="button" className="fleet-button fleet-button--quiet" onClick={() => openTicket(undefined, selectedVehicle.id)}><Wrench size={16} /> Raise issue</button></div>
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
                        return (
                          <article className={'fleet-ticket ' + (selectedTicketId === ticket.id ? 'is-highlighted' : '')} key={ticket.id}>
                            <div className="fleet-ticket__top"><div><span className="fleet-ticket__unit">{vehicle?.unit ?? ticket.vehicleId} · {vehicle?.department}</span><h3>{ticket.title}</h3></div><Tone tone={ticket.severity.toLowerCase()}>{ticket.severity} priority</Tone></div>
                            <p>{ticket.description}</p>
                            <div className="fleet-ticket__meta"><span><Clock3 size={15} /> {timestamp(ticket.createdAt)}</span>{ticket.assignee && <span><UserRound size={15} /> {ticket.assignee}</span>}{ticket.sourceReportId && <span><FileText size={14} /> From monthly report</span>}</div>
                            <div className="fleet-ticket__bottom">
                              <Tone tone={ticket.status.toLowerCase()}>{ticket.status}</Tone>
                              <div className="fleet-ticket__status">
                                <label htmlFor={'fleet-ticket-status-' + ticket.id}>Status</label>
                                <select id={'fleet-ticket-status-' + ticket.id} className="fleet-select" value={ticket.status} onChange={(event) => handleTicketStatus(ticket, event.target.value as TicketStatus)}>
                                  {TICKET_STATUSES.map((status) => <option key={status}>{status}</option>)}
                                </select>
                              </div>
                            </div>
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
                      <span className="fleet-warning-card__icon"><AlertTriangle size={22} /></span><h3>Safety observation?</h3><p>Mark it High priority for prompt review. Operational safety decisions and taking vehicles out of service still require your real institutional workflow.</p>
                    </FleetCard>
                  </div>
                </div>
              </>
            )}

            {view === 'exports' && (
              <>
                <div className="fleet-banner fleet-banner--warning fleet-export-disclaimer"><AlertTriangle size={21} /><div><strong>Review-only preparation, not a certified TxFS batch file</strong><p>This CSV is a staging worksheet of approved, licensed-vehicle reports. It does not match or certify an official Texas Fleet System import format and is never transmitted to a state service.</p></div></div>
                <div className="fleet-kpi-grid fleet-kpi-grid--three">
                  {[
                    { label: 'Approved reports', value: String(metrics.approved), icon: FileCheck2 },
                    { label: 'Export-ready records', value: String(exportData.count), icon: FileSpreadsheet },
                    { label: 'Excluded / unresolved', value: String(Math.max(0, metrics.vehicles - exportData.count)), icon: AlertCircle },
                  ].map((item) => { const Icon = item.icon; return <div className="fleet-kpi-card" key={item.label}><div className="fleet-kpi-top fleet-kpi-card__top"><span className="fleet-kpi-label">{item.label}</span><span className="fleet-kpi-icon"><Icon size={22} /></span></div><strong className="fleet-kpi-value fleet-kpi-card__value">{item.value}</strong><small className="fleet-kpi-bottom">{displayPeriod(period)}</small></div> })}
                </div>
                <FleetCard className="fleet-export-card">
                  <SectionTitle eyebrow="TXFS PREPARATION / ADMINISTRATIVE REVIEW" title="Approved vehicle usage preview" description="Only approved records for licensed vehicles are included. Use the downloaded file for internal review." action={<button type="button" className="fleet-button fleet-button--primary" disabled={!exportData.count} onClick={downloadCsv}><ArrowDownToLine size={17} /> Download CSV ({exportData.count})</button>} />
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
