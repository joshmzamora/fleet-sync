import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { randomUUID, randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import {
  createDemoFleet, migrateFleetState,
} from '../src/fleet/domain.ts'

const SCHEMA = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8')

export class FleetConflictError extends Error {
  constructor(revision) {
    super('The shared fleet changed in another session. Refresh the records and retry your action.')
    this.code = 'VERSION_CONFLICT'
    this.revision = revision
    this.status = 409
  }
}

function json(row) { return JSON.parse(row.data) }
function emptyFleet() {
  const example = createDemoFleet()
  return {
    schemaVersion: 1, vehicles: [], reports: [], tickets: [], audit: [],
    departmentProfiles: example.departmentProfiles, followUps: [],
    reportHistory: [], ticketHistory: [],
  }
}

/** Real SQLite tables, foreign keys and WAL. All commands commit as one transaction. */
export class FleetStore {
  constructor(dbPath = resolve('.local-data/fleetsync.sqlite')) {
    this.dbPath = resolve(dbPath)
    mkdirSync(dirname(this.dbPath), { recursive: true })
    this.db = new DatabaseSync(this.dbPath)
    this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec('PRAGMA foreign_keys = ON')
    this.db.exec('PRAGMA busy_timeout = 5000')
    const version = Number(this.db.prepare('PRAGMA user_version').get().user_version)
    if (version > 1) throw new Error('Database created by a newer FleetSync server. No migration was attempted.')
    if (version === 0) {
      this.db.exec('BEGIN IMMEDIATE')
      try {
        this.db.exec(SCHEMA)
        this.db.exec('PRAGMA user_version = 1')
        this.db.exec('COMMIT')
      } catch (error) {
        this.db.exec('ROLLBACK')
        throw error
      }
    }
  }

  close() { this.db.close() }
  revision() { return Number(this.db.prepare('SELECT revision FROM workspace WHERE id = 1').get().revision) }
  fleetCount() { return Number(this.db.prepare('SELECT COUNT(*) AS n FROM vehicles').get().n) }
  read() {
    const table = (name) => this.db.prepare('SELECT data FROM ' + name + ' ORDER BY rowid').all().map(json)
    const state = emptyFleet()
    state.vehicles = table('vehicles')
    state.reports = table('reports')
    state.tickets = table('tickets')
    state.departmentProfiles = table('department_profiles')
    state.followUps = table('follow_ups')
    state.reportHistory = table('report_history')
    state.ticketHistory = table('ticket_history')
    state.audit = table('audit_events')
    return { revision: this.revision(), state }
  }

  /** Save whole small workspace inside a transaction; normalized foreign-key columns
   * let SQLite reject dangling relationships and duplicate vehicle/month records. */
  writeState(state) {
    const db = this.db
    for (const table of ['report_history', 'ticket_history', 'follow_ups', 'audit_events', 'tickets', 'reports', 'department_profiles', 'vehicles']) {
      db.exec('DELETE FROM ' + table)
    }
    const insert = (sql, rows, map) => {
      const statement = db.prepare(sql)
      for (const row of rows) statement.run(...map(row), JSON.stringify(row))
    }
    insert('INSERT INTO vehicles (id, department, data) VALUES (?, ?, ?)', state.vehicles, v => [v.id, v.department])
    insert('INSERT INTO department_profiles (name, data) VALUES (?, ?)', state.departmentProfiles, d => [d.name])
    insert('INSERT INTO reports (id, vehicle_id, period, data) VALUES (?, ?, ?, ?)', state.reports, r => [r.id, r.vehicleId, r.period])
    insert('INSERT INTO tickets (id, vehicle_id, data) VALUES (?, ?, ?)', state.tickets, t => [t.id, t.vehicleId])
    insert('INSERT INTO follow_ups (id, vehicle_id, period, data) VALUES (?, ?, ?, ?)', state.followUps, f => [f.id, f.vehicleId, f.period])
    insert('INSERT INTO report_history (id, report_id, data) VALUES (?, ?, ?)', state.reportHistory, h => [h.id, h.reportId])
    insert('INSERT INTO ticket_history (id, ticket_id, data) VALUES (?, ?, ?)', state.ticketHistory, h => [h.id, h.ticketId])
    insert('INSERT INTO audit_events (id, data) VALUES (?, ?)', state.audit, a => [a.id])
  }

  mutate(expectedRevision, change) {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      const error = new Error('A valid shared workspace revision is required.')
      error.status = 400
      throw error
    }
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const { state, revision } = this.read()
      if (revision !== expectedRevision) throw new FleetConflictError(revision)
      const next = change(state)
      if (!next || !Array.isArray(next.vehicles) || !Array.isArray(next.audit)) throw new Error('Invalid domain transition.')
      this.writeState(next)
      this.db.prepare('UPDATE workspace SET revision = ? WHERE id = 1').run(revision + 1)
      this.db.exec('COMMIT')
      return { state: next, revision: revision + 1 }
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  importFleet(expectedRevision, imported, by) {
    validateImportedFleet(imported)
    return this.mutate(expectedRevision, old => {
      if (old.vehicles.length || old.reports.length || old.tickets.length || old.followUps.length) {
        const error = new Error('Shared workspace already contains fleet records. Import is only permitted into an empty workspace.')
        error.status = 409
        throw error
      }
      const data = migrateFleetState(imported)
      return {
        ...data,
        audit: [
          { id: 'evt-import-' + randomUUID(), actor: by, at: new Date().toISOString(),
            action: 'Browser demo imported into shared workspace',
            detail: 'Explicit administrator import of fictional sample records. Historical role actors are not verified accounts.' },
          ...data.audit,
        ],
      }
    })
  }

  provisionUser({ username, password, displayName, role, department = null }) {
    const allowed = ['Driver', 'Supervisor', 'Maintenance', 'Fleet Admin']
    if (!allowed.includes(role)) throw new Error('Invalid account role')
    if ((role === 'Driver' || role === 'Supervisor') && !department) throw new Error('Department required for driver and supervisor accounts')
    if (!/^[a-z0-9._-]{3,40}$/i.test(username)) throw new Error('Username must contain 3–40 letters, numbers, dots, hyphens or underscores.')
    if (typeof password !== 'string' || password.length < 12) throw new Error('Password must be at least 12 characters.')
    if (typeof displayName !== 'string' || displayName.trim().length < 2 || displayName.length > 100) throw new Error('Invalid display name.')
    const salt = randomBytes(16).toString('hex')
    const hash = scryptSync(password, salt, 64).toString('hex')
    const id = randomUUID()
    this.db.prepare('INSERT INTO users (id, username, display_name, role, department, password_hash) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, username.toLowerCase(), displayName.trim(), role, department, salt + ':' + hash)
    return { id, username: username.toLowerCase(), displayName: displayName.trim(), role, department }
  }

  login(username, password) {
    const row = this.db.prepare('SELECT * FROM users WHERE username = ?').get(String(username || '').toLowerCase())
    // Always run a real scrypt operation so unknown usernames are not a cheap timing oracle.
    const [salt, expected] = row?.password_hash?.split(':') ?? ['00000000000000000000000000000000', '0'.repeat(128)]
    const actual = scryptSync(String(password ?? ''), salt, 64)
    if (!row || !timingSafeEqual(actual, Buffer.from(expected, 'hex'))) return null
    const token = randomBytes(32).toString('base64url')
    const tokenHash = createHash('sha256').update(token).digest('hex')
    const expires = Date.now() + 8 * 60 * 60 * 1000
    this.db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(tokenHash, row.id, expires)
    return { token, expires, user: publicUser(row) }
  }

  session(token) {
    if (!token) return null
    const hash = createHash('sha256').update(token).digest('hex')
    const row = this.db.prepare('SELECT users.* FROM sessions INNER JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ? AND sessions.expires_at > ?').get(hash, Date.now())
    return row ? publicUser(row) : null
  }

  logout(token) {
    if (token) this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(createHash('sha256').update(token).digest('hex'))
  }
}

function publicUser(row) {
  return { id: row.id, username: row.username, displayName: row.display_name, role: row.role, department: row.department }
}

/** Defensive checks for explicit browser-data imports. Normal mutations never accept client state. */
export function validateImportedFleet(raw) {
  if (!raw || typeof raw !== 'object' || raw.schemaVersion !== 1) throw new Error('Import must contain FleetSync schema version 1.')
  for (const [name, limit] of [['vehicles', 5000], ['reports', 150000], ['tickets', 150000], ['audit', 300000], ['followUps', 150000]]) {
    if (!Array.isArray(raw[name]) || raw[name].length > limit) throw new Error('Invalid import collection: ' + name)
  }
  const unique = (records, label, selector) => {
    const seen = new Set()
    for (const record of records) {
      if (!record || typeof record !== 'object') throw new Error('Invalid ' + label + ' record.')
      const key = selector(record)
      if (typeof key !== 'string' || key.length < 1 || seen.has(key)) throw new Error('Missing or duplicate ' + label + ' identifier: ' + key)
      seen.add(key)
    }
  }
  unique(raw.vehicles, 'vehicle', x => x.id)
  unique(raw.reports, 'report', x => x.id)
  unique(raw.tickets, 'ticket', x => x.id)
  unique(raw.audit, 'audit', x => x.id)
  unique(raw.followUps, 'follow-up', x => x.id)
  if (raw.reportHistory && (!Array.isArray(raw.reportHistory) || raw.reportHistory.length > 500000)) throw new Error('Invalid report history.')
  if (raw.ticketHistory && (!Array.isArray(raw.ticketHistory) || raw.ticketHistory.length > 500000)) throw new Error('Invalid ticket history.')
  if (raw.departmentProfiles && (!Array.isArray(raw.departmentProfiles) || raw.departmentProfiles.length > 5000)) throw new Error('Invalid department directory.')
  const vehicles = new Set(raw.vehicles.map(v => v.id))
  const reports = new Set(raw.reports.map(r => r.id))
  const tickets = new Set(raw.tickets.map(t => t.id))
  const str = (value, max = 600) => typeof value === 'string' && value.trim().length > 0 && value.length <= max
  const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0
  for (const v of raw.vehicles) {
    if (!str(v.unit, 40) || !str(v.department, 80) || !str(v.make, 80) || !str(v.model, 80) ||
        !str(v.plate, 30) || !str(v.custodian, 80) || !Number.isInteger(v.year) ||
        v.year < 1990 || v.year > 2200 || !Number.isInteger(v.odometer) || v.odometer < 0 ||
        typeof v.licensed !== 'boolean' ||
        !['Sedan', 'SUV', 'Pickup', 'Van', 'Box truck', 'Utility cart'].includes(v.kind) ||
        !['Active', 'In maintenance', 'Retired'].includes(v.status)) {
      throw new Error('Invalid vehicle data in import: ' + v.id)
    }
  }
  if (new Set(raw.vehicles.map(v => v.unit.toLowerCase())).size !== raw.vehicles.length ||
      new Set(raw.vehicles.map(v => v.plate.toLowerCase())).size !== raw.vehicles.length) {
    throw new Error('Duplicate vehicle unit or asset tag in import.')
  }
  for (const r of raw.reports) {
    if (!Number.isInteger(r.startOdometer) || !Number.isInteger(r.endOdometer) ||
        r.startOdometer < 0 || r.endOdometer < r.startOdometer ||
        !number(r.fuelGallons) || !number(r.fuelCost) || !str(r.operator, 80) ||
        !str(r.submittedAt, 80) || !Number.isInteger(r.revision) || r.revision < 1 ||
        !['Pending', 'Approved', 'Returned'].includes(r.status) ||
        !['Good', 'Needs attention', 'Unsafe'].includes(r.condition)) {
      throw new Error('Invalid monthly report data in import: ' + r.id)
    }
  }
  for (const ticket of raw.tickets) {
    if (!str(ticket.title, 100) || !str(ticket.description, 1200) ||
        !['Low', 'Medium', 'High'].includes(ticket.severity) ||
        !['Open', 'Scheduled', 'Resolved'].includes(ticket.status) ||
        !str(ticket.createdAt, 80) || !str(ticket.updatedAt, 80) ||
        (ticket.sourceReportId && !reports.has(ticket.sourceReportId))) {
      throw new Error('Invalid work-order data in import: ' + ticket.id)
    }
  }
  for (const followUp of raw.followUps) {
    if (!str(followUp.actor, 80) || !str(followUp.note, 400) ||
        !str(followUp.at, 80) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(followUp.period) ||
        (followUp.status && !['Open', 'Closed'].includes(followUp.status))) {
      throw new Error('Invalid follow-up data in import: ' + followUp.id)
    }
  }
  for (const event of raw.audit) {
    if (!str(event.actor, 100) || !str(event.action, 200) || !str(event.detail, 1800) || !str(event.at, 80)) {
      throw new Error('Invalid audit record in import: ' + event.id)
    }
  }
  if (raw.reportHistory) {
    unique(raw.reportHistory, 'report history', h => h.id)
    for (const history of raw.reportHistory) {
      if (!reports.has(history.reportId) || history.snapshot?.id !== history.reportId ||
          !str(history.action, 100) || !str(history.actor, 100)) throw new Error('Invalid report history link in import.')
    }
  }
  if (raw.ticketHistory) {
    unique(raw.ticketHistory, 'ticket history', h => h.id)
    for (const history of raw.ticketHistory) {
      if (!tickets.has(history.ticketId) || history.snapshot?.id !== history.ticketId ||
          !str(history.action, 100) || !str(history.actor, 100)) throw new Error('Invalid maintenance history link in import.')
    }
  }
  if (raw.departmentProfiles) {
    unique(raw.departmentProfiles, 'department', item => item.name)
    for (const profile of raw.departmentProfiles) {
      if (!str(profile.coordinator, 80) || !Number.isInteger(profile.monthlyDueDay) ||
          profile.monthlyDueDay < 1 || profile.monthlyDueDay > 28) throw new Error('Invalid department reporting policy in import.')
    }
  }
  if (raw.reports.some(r => !vehicles.has(r.vehicleId) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(r.period))) throw new Error('Report references an invalid vehicle or period.')
  if (raw.tickets.some(t => !vehicles.has(t.vehicleId)) || raw.followUps.some(f => !vehicles.has(f.vehicleId))) throw new Error('Work item references an unknown vehicle.')
  const pairs = raw.reports.map(r => r.vehicleId + ':' + r.period)
  if (new Set(pairs).size !== pairs.length) throw new Error('Duplicate report for the same vehicle/month.')
  return true
}
