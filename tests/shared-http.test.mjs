import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFleetServer } from '../server/app.mjs'
import { createDemoFleet, currentPeriod, fiscalQuarterForPeriod, quarterReadiness } from '../src/fleet/domain.ts'

const TEST_PASSWORD = 'OnlyForIsolatedFleetTests-2026!'

/** A separate ephemeral SQLite workspace for each test. Never touch the
 * operator's server/database, real user accounts, or browser profile. */
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'fleetsync-http-test-'))
  const dbPath = join(directory, 'fleet.sqlite')
  let app = createFleetServer({ dbPath, host: '127.0.0.1', port: 0 })
  let { origin } = await app.listen()
  const users = {
    driver: { username: 'test-driver', password: TEST_PASSWORD, displayName: 'Taylor Driver', role: 'Driver', department: 'Facilities' },
    supervisor: { username: 'test-supervisor', password: TEST_PASSWORD, displayName: 'Alex Supervisor', role: 'Supervisor', department: 'Facilities' },
    otherSupervisor: { username: 'test-housing', password: TEST_PASSWORD, displayName: 'Housing Supervisor', role: 'Supervisor', department: 'Housing' },
    maintenance: { username: 'test-maintenance', password: TEST_PASSWORD, displayName: 'Morgan Technician', role: 'Maintenance', department: null },
    admin: { username: 'test-admin', password: TEST_PASSWORD, displayName: 'Fleet Administrator', role: 'Fleet Admin', department: null },
  }
  for (const user of Object.values(users)) app.provisionUser(user)
  t.after(async () => {
    await app.close()
    await rm(directory, { recursive: true, force: true })
  })

  async function request(path, { method = 'GET', body, cookie, originHeader = origin, requestMarker = true } = {}) {
    const headers = { Accept: 'application/json' }
    if (cookie) headers.Cookie = cookie
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (method !== 'GET') {
      if (requestMarker) headers['X-FleetSync-Request'] = '1'
      if (originHeader !== null) headers.Origin = originHeader
    }
    const response = await fetch(origin + path, {
      method,
      headers,
      redirect: 'manual',
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const contentType = response.headers.get('content-type') ?? ''
    assert.match(contentType, /application\/json/i, path + ' returned non-JSON status ' + response.status)
    return {
      status: response.status,
      body: await response.json(),
      setCookie: response.headers.get('set-cookie') ?? '',
      headers: response.headers,
    }
  }

  async function login(who) {
    const user = users[who]
    assert.ok(user, 'Unknown test identity: ' + who)
    const response = await request('/api/login', {
      method: 'POST', body: { username: user.username, password: user.password },
    })
    assert.equal(response.status, 200, who + ' failed login: ' + JSON.stringify(response.body))
    assert.equal(response.body.user.role, user.role)
    assert.ok(response.setCookie.includes('HttpOnly'), 'Session cookie must not be script-readable')
    assert.match(response.setCookie, /SameSite=Strict/i, 'Shared session cookie should be same-site strict')
    const cookie = response.setCookie.split(';')[0]
    assert.ok(cookie.includes('='), 'Login omitted session cookie')
    return cookie
  }

  async function restart() {
    await app.close()
    app = createFleetServer({ dbPath, host: '127.0.0.1', port: 0 })
    ;({ origin } = await app.listen())
  }

  async function importSeed(cookie) {
    const state = createDemoFleet(currentPeriod())
    const preview = await request('/api/import/preview', {
      method: 'POST', cookie, body: { state },
    })
    assert.equal(preview.status, 200, 'Administrator import preview failed: ' + JSON.stringify(preview.body))
    assert.equal(preview.body.allowed, true, 'Fresh workspace must allow explicit sample import')
    assert.ok(preview.body.fingerprint, 'Preview did not include import fingerprint')
    const result = await request('/api/import', {
      method: 'POST', cookie,
      body: { revision: 0, state, fingerprint: preview.body.fingerprint },
    })
    assert.equal(result.status, 200, 'Explicit seeded import failed: ' + JSON.stringify(result.body))
    return result
  }

  return {
    directory, dbPath, users, request, login, restart, importSeed,
    provisionUser: details => app.provisionUser(details),
    get origin() { return origin },
  }
}

async function currentState(api, cookie) {
  const response = await api.request('/api/state', { cookie })
  assert.equal(response.status, 200, 'Authenticated state read failed: ' + JSON.stringify(response.body))
  assert.ok(Number.isSafeInteger(response.body.revision), 'Missing server revision')
  assert.ok(response.body.state && Array.isArray(response.body.state.vehicles), 'Missing server state')
  return response.body
}

async function command(api, cookie, revision, type, payload) {
  return api.request('/api/actions', {
    method: 'POST', cookie, body: { revision, type, payload },
  })
}

test('shared server requires real sessions, restricts Origin, and invalidates logout', async t => {
  const api = await fixture(t)
  const health = await api.request('/api/health')
  assert.equal(health.status, 200)
  assert.equal(health.body.shared, true)
  assert.equal(health.body.localOnly, true)
  const anonymous = await api.request('/api/session')
  assert.equal(anonymous.status, 200)
  assert.equal(anonymous.body.user, null)
  assert.equal((await api.request('/api/state')).status, 401, 'Anonymous state access was permitted')
  assert.equal((await api.request('/api/actions', {
    method: 'POST', body: { revision: 0, type: 'record-export', payload: { scope: 'Monthly', label: 'Unauthorized test', recordCount: 0 } },
  })).status, 401, 'Anonymous mutation was permitted')
  assert.equal((await api.request('/api/login', { method: 'POST', body: {
    username: api.users.driver.username, password: 'invalid password',
  } })).status, 401, 'Invalid password authenticated')

  const driver = await api.login('driver')
  const session = await api.request('/api/session', { cookie: driver })
  assert.equal(session.status, 200)
  assert.equal(session.body.user.username, api.users.driver.username)
  assert.ok(!('password' in session.body.user) && !('passwordHash' in session.body.user), 'Session exposed credential material')

  const crossOrigin = await api.request('/api/logout', {
    method: 'POST', cookie: driver, originHeader: 'https://attacker.example',
  })
  assert.equal(crossOrigin.status, 403, 'Cross-site logout/mutation was not rejected')
  assert.equal((await api.request('/api/logout', {
    method: 'POST', cookie: driver, requestMarker: false,
  })).status, 403, 'Shared mutation did not require its CSRF request marker')
  assert.ok((await api.request('/api/session', { cookie: driver })).body.user, 'Blocked cross-origin action should not end the session')
  const logout = await api.request('/api/logout', { method: 'POST', cookie: driver })
  assert.equal(logout.status, 200)
  assert.equal((await api.request('/api/session', { cookie: driver })).body.user, null, 'Logout left server session valid')
})

test('only an explicit administrator can import into an empty durable workspace', async t => {
  const api = await fixture(t)
  const driver = await api.login('driver')
  const admin = await api.login('admin')
  const source = createDemoFleet()
  assert.equal((await api.request('/api/import/preview', {
    method: 'POST', cookie: driver, body: { state: source },
  })).status, 403, 'Driver can preview administrative imports')
  assert.equal((await api.request('/api/import', {
    method: 'POST', cookie: driver, body: { revision: 0, state: source, fingerprint: 'unsafe' },
  })).status, 403, 'Driver can import workspace data')
  assert.equal((await currentState(api, admin)).state.vehicles.length, 0, 'New workspace was silently populated without authorization')

  const imported = await api.importSeed(admin)
  assert.ok(imported.body.revision > 0)
  const snapshot = await currentState(api, admin)
  assert.ok(snapshot.state.vehicles.length >= 12, 'Admin import did not persist sample vehicles')
  const populatedPreview = await api.request('/api/import/preview', {
    method: 'POST', cookie: admin, body: { state: source },
  })
  assert.equal(populatedPreview.status, 200)
  assert.equal(populatedPreview.body.allowed, false, 'Preview incorrectly offered to overwrite a populated workspace')
  assert.equal((await api.request('/api/import', {
    method: 'POST', cookie: admin, body: {
      revision: snapshot.revision, state: source, fingerprint: populatedPreview.body.fingerprint,
    },
  })).status, 409, 'A populated workspace accepted a replacement demo import')
  await api.restart()
  const newAdminSession = await api.login('admin')
  const restored = await currentState(api, newAdminSession)
  assert.equal(restored.revision, snapshot.revision, 'SQLite revision was lost after server restart')
  assert.deepEqual(restored.state.vehicles.map(vehicle => vehicle.id).sort(), snapshot.state.vehicles.map(vehicle => vehicle.id).sort(), 'SQLite vehicle records changed after restart')
  assert.ok(restored.state.audit.some(entry => /import/i.test(entry.action)), 'Import audit record was lost after restart')
})

test('department roles, stale optimistic writes, and safety holds are enforced by HTTP', async t => {
  const api = await fixture(t)
  const admin = await api.login('admin')
  const driver = await api.login('driver')
  const supervisor = await api.login('supervisor')
  const otherSupervisor = await api.login('otherSupervisor')
  const maintenance = await api.login('maintenance')
  await api.importSeed(admin)

  const period = currentPeriod()
  const driverBefore = await currentState(api, driver)
  assert.ok(driverBefore.state.vehicles.every(vehicle => vehicle.department === 'Facilities'), 'Driver read scope included another department')
  assert.ok(driverBefore.state.reports.every(report => report.departmentAtSubmission === 'Facilities'), 'Driver read scope included private reports from another department')
  const input = {
    vehicleId: 'v006', period, startOdometer: 111900, endOdometer: 111916,
    fuelGallons: 4, fuelCost: 15.50, condition: 'Unsafe',
    notes: 'Brake warning lamp; keep the vehicle out of service pending mechanical inspection.',
    operator: 'Forged Fleet Administrator',
  }
  const otherDepartment = await command(api, driver, driverBefore.revision, 'submit-report', { ...input, vehicleId: 'v004' })
  assert.equal(otherDepartment.status, 403, 'Facilities driver submitted a Housing vehicle report')
  const submitted = await command(api, driver, driverBefore.revision, 'submit-report', input)
  assert.equal(submitted.status, 200, 'Authorized driver report failed: ' + JSON.stringify(submitted.body))
  const report = submitted.body.state.reports.find(item => item.vehicleId === 'v006' && item.period === period)
  assert.equal(report?.status, 'Pending', 'Driver report did not enter review')
  assert.equal(report?.operator, 'Taylor Driver', 'Client-submitted operator name bypassed authenticated user identity')
  const held = await currentState(api, admin)
  assert.equal(held.state.vehicles.find(vehicle => vehicle.id === 'v006')?.status, 'In maintenance', 'Unsafe condition did not apply the server-side service hold')

  const stale = await command(api, driver, driverBefore.revision, 'submit-report', input)
  assert.equal(stale.status, 409, 'Old version was allowed to overwrite a committed report')
  assert.equal(stale.body.code, 'VERSION_CONFLICT')
  assert.ok(stale.body.revision >= submitted.body.revision)
  const unauthorizedReview = await command(api, driver, submitted.body.revision, 'review-report', {
    reportId: report.id, decision: 'Approved', note: 'Unsafe self-approval',
  })
  assert.equal(unauthorizedReview.status, 403, 'Driver could approve their own submitted report')
  const outsiderReview = await command(api, otherSupervisor, submitted.body.revision, 'review-report', {
    reportId: report.id, decision: 'Approved', note: 'Unauthorized cross-department approval',
  })
  assert.equal(outsiderReview.status, 403, 'Housing supervisor approved Facilities driver report')

  const supervisorBefore = await currentState(api, supervisor)
  const approved = await command(api, supervisor, supervisorBefore.revision, 'review-report', {
    reportId: report.id, decision: 'Approved', note: 'Acknowledged; maintenance hold remains pending service.',
  })
  assert.equal(approved.status, 200, 'Facilities supervisor could not review own department: ' + JSON.stringify(approved.body))
  assert.equal((await currentState(api, admin)).state.vehicles.find(vehicle => vehicle.id === 'v006')?.status, 'In maintenance', 'Report approval silently released safety hold')
  const unsafeTicket = (await currentState(api, admin)).state.tickets.find(ticket => ticket.sourceReportId === report.id)
  assert.equal(unsafeTicket?.severity, 'High')

  const prematureReleaseVersion = (await currentState(api, admin)).revision
  const prematureRelease = await command(api, admin, prematureReleaseVersion, 'vehicle-status', {
    vehicleId: 'v006', status: 'Active', note: 'Trying to release before completing safety-critical work.',
  })
  assert.ok(prematureRelease.status >= 400, 'Server released a held vehicle before high-priority repair closure')

  const technicianView = await currentState(api, maintenance)
  const scheduled = await command(api, maintenance, technicianView.revision, 'update-ticket', {
    ticketId: unsafeTicket.id, status: 'Scheduled',
    details: { assignee: 'Morgan Technician', scheduledFor: futureDate(7) },
  })
  assert.equal(scheduled.status, 200, 'Maintenance scheduler failed: ' + JSON.stringify(scheduled.body))
  assert.equal((await currentState(api, admin)).state.vehicles.find(vehicle => vehicle.id === 'v006').status, 'In maintenance', 'Scheduling released a held unit')
  const repair = await command(api, maintenance, (await currentState(api, maintenance)).revision, 'update-ticket', {
    ticketId: unsafeTicket.id, status: 'Resolved',
    details: { assignee: 'Morgan Technician', resolutionNote: 'Repaired brake circuit, road-tested and confirmed normal operation.', actualCost: 68.25 },
  })
  assert.equal(repair.status, 200, 'Maintenance closure failed: ' + JSON.stringify(repair.body))
  const afterRepair = await currentState(api, admin)
  assert.equal(afterRepair.state.vehicles.find(vehicle => vehicle.id === 'v006').status, 'In maintenance', 'Closing high-priority work silently released vehicle hold')
  assert.ok(afterRepair.state.ticketHistory.some(entry => entry.ticketId === unsafeTicket.id && entry.snapshot.status === 'Resolved'), 'Durable service closure history missing')
  const release = await command(api, admin, afterRepair.revision, 'vehicle-status', {
    vehicleId: 'v006', status: 'Active', note: 'Garage completion verified. Administrative release recorded after safety review.',
  })
  assert.equal(release.status, 200, 'Administrator could not explicitly release repaired unit: ' + JSON.stringify(release.body))

  const latest = await currentState(api, admin)
  const quarter = quarterReadiness(latest.state, ...Object.values(fiscalQuarterForPeriod(period)))
  assert.ok(quarter.vehicles.some(row => row.vehicle.id === 'v006'), 'Quarter review omitted licensed report unit')
  assert.ok(latest.state.reportHistory.some(entry => entry.reportId === report.id && entry.snapshot.status === 'Approved'), 'Approved report history was not committed')
})

test('legacy report cannot be approved by an account matching its original operator', async t => {
  const api = await fixture(t)
  const admin = await api.login('admin')
  await api.importSeed(admin)
  const original = await currentState(api, admin)
  const pendingLegacy = original.state.reports.find(report => report.status === 'Pending' && !report.submittedByUserId)
  assert.ok(pendingLegacy, 'Sample data lacks a pending legacy report')
  const vehicle = original.state.vehicles.find(item => item.id === pendingLegacy.vehicleId)
  assert.ok(vehicle, 'Legacy report has no vehicle')
  const identity = {
    username: 'matching-operator', password: TEST_PASSWORD,
    displayName: pendingLegacy.operator, role: 'Supervisor', department: vehicle.department,
  }
  api.users.matchingOperator = identity
  api.provisionUser(identity)
  const matchingOperator = await api.login('matchingOperator')
  const refused = await command(api, matchingOperator, original.revision, 'review-report', {
    reportId: pendingLegacy.id, decision: 'Approved', note: 'An apparent self-approval of an imported report.',
  })
  assert.equal(refused.status, 403, 'Matching legacy author approved their own report')
  const after = await currentState(api, admin)
  assert.equal(after.state.reports.find(report => report.id === pendingLegacy.id)?.status, 'Pending', 'Denied self-approval modified report')
  assert.equal(after.revision, original.revision, 'Denied action changed workspace revision')
})

test('follow-up completion never fabricates a report or substitutes for signoff', async t => {
  const api = await fixture(t)
  const admin = await api.login('admin')
  await api.importSeed(admin)
  const period = twoMonthsAgo()
  const baseline = await currentState(api, admin)
  assert.ok(!baseline.state.reports.some(report => report.vehicleId === 'v006' && report.period === period), 'Test needs an actual missing month')
  const created = await command(api, admin, baseline.revision, 'create-follow-up', {
    vehicleId: 'v006', period, owner: 'Facilities Coordinator', dueOn: futureDate(3),
    note: 'Call unit custodian and ask for the missing mileage form.',
  })
  assert.equal(created.status, 200, 'Local follow-up creation failed: ' + JSON.stringify(created.body))
  const task = created.body.state.followUps.find(item => item.vehicleId === 'v006' && item.period === period && item.status === 'Open')
  assert.ok(task, 'Created follow-up not stored as open task')
  assert.equal(created.body.state.reports.some(report => report.vehicleId === 'v006' && report.period === period), false, 'Creating task falsely recorded a monthly submission')
  const closed = await command(api, admin, created.body.revision, 'update-follow-up', {
    id: task.id, status: 'Closed',
    options: { outcome: 'Reached assigned custodian; monthly use report is still outstanding.' },
  })
  assert.equal(closed.status, 200, 'Local follow-up task closure failed: ' + JSON.stringify(closed.body))
  assert.equal(closed.body.state.followUps.find(item => item.id === task.id)?.status, 'Closed')
  assert.ok(closed.body.state.followUps.find(item => item.id === task.id)?.closedAt, 'Missing task closure evidence')
  assert.equal(closed.body.state.reports.some(report => report.vehicleId === 'v006' && report.period === period), false, 'Closed task was mistaken for submitted report')
  const durable = await currentState(api, admin)
  assert.ok(durable.state.audit.some(entry => /Follow-up task closed/i.test(entry.action)), 'No audited follow-up outcome')
  assert.equal(durable.state.reports.some(report => report.vehicleId === 'v006' && report.period === period), false)
})

function futureDate(days) {
  const result = new Date()
  result.setDate(result.getDate() + days)
  return [result.getFullYear(), String(result.getMonth() + 1).padStart(2, '0'), String(result.getDate()).padStart(2, '0')].join('-')
}

function twoMonthsAgo() {
  const today = new Date()
  const before = new Date(today.getFullYear(), today.getMonth() - 2, 1)
  return [before.getFullYear(), String(before.getMonth() + 1).padStart(2, '0')].join('-')
}
