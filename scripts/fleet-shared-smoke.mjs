import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { chromium } from 'playwright'
import { preview } from 'vite'
import { createFleetServer } from '../server/app.mjs'
import { createDemoFleet, currentPeriod } from '../src/fleet/domain.ts'

// Run after npm run build with Node 22.23+ and --experimental-strip-types.
// Each run owns a disposable SQLite database, an ephemeral loopback API, one
// production-preview server, and independent headless browser contexts.
const temporary = await mkdtemp(join(tmpdir(), 'fleetsync-browser-shared-'))
const password = 'IsolatedBrowserTestOnly-2026!'
const testUsers = {
  admin: { username: 'browser-admin', password, displayName: 'Demo Admin', role: 'Fleet Admin' },
  driver: { username: 'browser-driver', password, displayName: 'Demo Facilities Driver', role: 'Driver', department: 'Facilities' },
  supervisor: { username: 'browser-supervisor', password, displayName: 'Demo Facilities Supervisor', role: 'Supervisor', department: 'Facilities' },
  housing: { username: 'browser-housing', password, displayName: 'Demo Housing Supervisor', role: 'Supervisor', department: 'Housing' },
  maintenance: { username: 'browser-maintenance', password, displayName: 'Demo Repair Technician', role: 'Maintenance' },
}
let backend
let frontend
let browser
let origin
let apiOrigin

async function api(path, { cookie, body, method = 'GET' } = {}) {
  const headers = { Accept: 'application/json' }
  if (cookie) headers.Cookie = cookie
  if (method !== 'GET') {
    headers['X-FleetSync-Request'] = '1'
    headers['Content-Type'] = 'application/json'
    headers.Origin = apiOrigin
  }
  const result = await fetch(apiOrigin + path, {
    method, headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const payload = await result.json()
  return { status: result.status, body: payload, cookie: result.headers.get('set-cookie')?.split(';')[0] }
}

async function seedBrowserWorkspace() {
  const user = testUsers.admin
  const login = await api('/api/login', {
    method: 'POST', body: { username: user.username, password: user.password },
  })
  assert.equal(login.status, 200, 'Browser setup admin login failed')
  const initial = createDemoFleet(currentPeriod())
  const previewImport = await api('/api/import/preview', {
    method: 'POST', cookie: login.cookie, body: { state: initial },
  })
  assert.equal(previewImport.status, 200, 'Browser setup admin import preview failed')
  assert.equal(previewImport.body.allowed, true, 'Fresh temporary fleet was unexpectedly populated')
  const imported = await api('/api/import', {
    method: 'POST', cookie: login.cookie,
    body: { revision: 0, state: initial, fingerprint: previewImport.body.fingerprint },
  })
  assert.equal(imported.status, 200, 'Browser setup import failed: ' + JSON.stringify(imported.body))
}

async function newActor(name, viewport = { width: 1440, height: 900 }) {
  const context = await browser.newContext({
    viewport, acceptDownloads: true,
    ...(viewport.width <= 390 ? { isMobile: true, hasTouch: true } : {}),
  })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(origin + '/', { waitUntil: 'domcontentloaded' })
  await page.locator('.fleet-app[data-mode="demo"]').waitFor()
  return { context, page, errors, name }
}

async function enterShared(actor, account = actor.account) {
  const { page } = actor
  const mobile = (await page.evaluate(() => window.innerWidth)) <= 900
  if (mobile) {
    await page.getByRole('button', { name: 'Open navigation' }).click()
    await page.locator('.fleet-sidebar.is-open').getByRole('button', { name: /Open Shared records/i }).click()
  } else {
    await page.locator('.fleet-shared-open').click()
  }
  const login = page.locator('.fleet-auth-form')
  const authenticated = page.locator('.fleet-shared-identity')
  await Promise.race([
    login.waitFor({ state: 'visible' }),
    authenticated.waitFor({ state: 'visible' }),
  ])
  if (await login.isVisible()) {
    assert.ok(account, 'Missing test account for ' + actor.name)
    await page.locator('#fleet-shared-username').fill(account.username)
    await page.locator('#fleet-shared-password').fill(account.password)
    await login.getByRole('button', { name: /^Sign in$/i }).click()
    await authenticated.waitFor({ state: 'visible' })
  }
  assert.equal(await page.locator('.fleet-app').getAttribute('data-mode'), 'shared', 'Actor switched back into browser Demo')
  assert.equal(await page.locator('#fleet-role').count(), 0, 'Shared role can be spoofed using the Demo role selector')
  assert.ok(await authenticated.getByText(actor.name, { exact: false }).count() > 0, 'Signed-in account identity not shown')
  if (await page.locator('.fleet-sidebar.is-open').count()) {
    // Temporary exploration until UI closes the mobile drawer on sign-in.
    // A final regression assertion replaces this before completion.
    console.warn('Shared login left navigation drawer open for ' + actor.name)
    await page.locator('.fleet-sidebar.is-open .fleet-sidebar__close').click()
  }
}

async function reenterShared(actor) {
  await actor.page.reload({ waitUntil: 'domcontentloaded' })
  await actor.page.locator('.fleet-app[data-mode="demo"]').waitFor()
  await enterShared(actor)
}

async function navigate(actor, name) {
  const { page } = actor
  const mobile = (await page.evaluate(() => window.innerWidth)) <= 900
  const label = new RegExp('^' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:\\b|$)', 'i')
  if (mobile) {
    await page.getByRole('button', { name: 'Open navigation' }).click()
    await page.locator('.fleet-sidebar.is-open').getByRole('button', { name: label }).click()
  } else {
    await page.locator('.fleet-sidebar').getByRole('button', { name: label }).click()
  }
}

async function assertWorkspace(actor, roleName, heading) {
  const workspace = roleName.toLowerCase().replace('fleet admin', 'admin').replace('housing supervisor', 'supervisor')
  assert.equal(await actor.page.locator('.fleet-page').getAttribute('data-workspace'), workspace, actor.name + ' landed in the wrong workspace')
  await actor.page.getByRole('heading', { name: heading, exact: true }).waitFor()
  await viewportFits(actor.page, actor.name + ' landing')
}

async function waitForState(predicate, description) {
  for (let i = 0; i < 30; i++) {
    const state = backend.store.read()
    if (predicate(state.state)) return state
    await new Promise(resolve => setTimeout(resolve, 60))
  }
  assert.fail('Shared server did not persist ' + description)
}

function futureDate(days = 7) {
  const today = new Date()
  const future = new Date(today.getFullYear(), today.getMonth(), today.getDate() + days)
  return [future.getFullYear(), String(future.getMonth() + 1).padStart(2, '0'), String(future.getDate()).padStart(2, '0')].join('-')
}

async function viewportFits(page, label) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
  assert.ok(overflow <= 2, label + ' introduced ' + overflow + 'px of page horizontal overflow')
}

async function sharedState(session) {
  const response = await session.page.evaluate(async () => {
    const result = await fetch('/api/state', { credentials: 'same-origin' })
    return { status: result.status, body: await result.json() }
  })
  assert.equal(response.status, 200, session.name + ' state request failed: ' + JSON.stringify(response.body))
  return response.body
}

function twoMonthsAgo() {
  const today = new Date()
  const first = new Date(today.getFullYear(), today.getMonth() - 2, 1)
  return [first.getFullYear(), String(first.getMonth() + 1).padStart(2, '0')].join('-')
}

try {
  backend = createFleetServer({ dbPath: join(temporary, 'shared-browser.sqlite'), host: '127.0.0.1', port: 0 })
  ;({ origin: apiOrigin } = await backend.listen())
  for (const user of Object.values(testUsers)) backend.provisionUser(user)
  await seedBrowserWorkspace()

  // The preview proxy targets this isolated API, never the user's normal
  // shared server port or persistent workspace.
  frontend = await preview({
    preview: {
      host: '127.0.0.1', port: 4339, strictPort: false,
      proxy: { '/api': { target: apiOrigin, changeOrigin: true } },
    },
  })
  const address = frontend.httpServer.address()
  assert.ok(address && typeof address === 'object')
  origin = 'http://127.0.0.1:' + address.port
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true })

  const admin = await newActor('Fleet Admin')
  const driver = await newActor('Driver', { width: 390, height: 844 })
  const supervisor = await newActor('Supervisor')
  const housing = await newActor('Housing Supervisor')
  const maintenance = await newActor('Maintenance')

  const health = await admin.page.request.get(origin + '/api/health')
  assert.equal(health.status(), 200, 'Production preview is not proxying the temporary local shared API')
  assert.equal((await health.json()).shared, true)

  for (const [actor, user] of [
    [admin, testUsers.admin], [driver, testUsers.driver],
    [supervisor, testUsers.supervisor], [housing, testUsers.housing],
    [maintenance, testUsers.maintenance],
  ]) {
    actor.account = user
    await enterShared(actor)
  }

  // Every person has a separate cookie jar, server identity and landing page.
  await assertWorkspace(admin, 'Fleet Admin', 'Fleet exceptions and assignments')
  await assertWorkspace(driver, 'Driver', 'My monthly report')
  await assertWorkspace(supervisor, 'Supervisor', 'Department review queue')
  await assertWorkspace(housing, 'Housing Supervisor', 'Department review queue')
  await assertWorkspace(maintenance, 'Maintenance', 'Technician work orders')
  assert.ok(await driver.page.getByTestId('driver-workspace').isVisible(), 'Driver entry summary is missing')
  assert.ok(await supervisor.page.getByTestId('supervisor-workspace').isVisible(), 'Supervisor review summary is missing')
  assert.equal(await driver.page.locator('.fleet-sidebar').getByRole('button', { name: 'Quarterly review', exact: true }).count(), 0, 'Driver exposed administrator quarter review navigation')
  assert.equal(await driver.page.locator('.fleet-sidebar').getByRole('button', { name: 'Work orders', exact: true }).count(), 0, 'Driver exposed technician work orders navigation')
  assert.equal(await supervisor.page.getByRole('tab', { name: /Submit report|My monthly form/i }).count(), 0, 'Supervisor may enter records as Driver')
  assert.equal(await maintenance.page.locator('#fleet-report-vehicle').count(), 0, 'Technician screen contains Driver reporting form')
  assert.equal(await maintenance.page.locator('.fleet-sidebar').getByRole('button', { name: 'Quarterly review', exact: true }).count(), 0, 'Technician exposed administrator reconciliation navigation')
  const housingState = await sharedState(housing)
  assert.ok(housingState.state.vehicles.every(vehicle => vehicle.department === 'Housing'), 'Housing browser session received cross-department vehicle data')
  assert.ok(!housingState.state.reports.some(report => report.vehicleId === 'v006'), 'Housing browser session can read Facilities report')
  assert.equal(await housing.page.locator('#fleet-report-vehicle').count(), 0, 'Housing supervisor has driver submission access')

  // Driver enters a real shared record on a narrow phone. A safety report
  // creates an issue and hold visible to the other authenticated sessions.
  await driver.page.locator('#fleet-report-vehicle').selectOption('v006')
  await driver.page.locator('#fleet-report-start').fill('111900')
  await driver.page.locator('#fleet-report-end').fill('111914')
  await driver.page.locator('#fleet-report-fuel').fill('4')
  await driver.page.locator('#fleet-report-cost').fill('15.50')
  await driver.page.locator('#fleet-report-condition').selectOption('Unsafe')
  assert.ok(await driver.page.locator('#fleet-report-operator').evaluate(element => element.readOnly), 'Shared driver operator could be edited to impersonate another user')
  await driver.page.locator('#fleet-report-notes').fill('Brake warning illuminated in service; remove vehicle until mechanic inspection.')
  await driver.page.locator('#fleet-report-form button[type=submit]').click()
  const submitted = await waitForState(state => state.reports.some(report => report.vehicleId === 'v006' && report.period === currentPeriod() && report.status === 'Pending'), 'driver submission')
  const report = submitted.state.reports.find(item => item.vehicleId === 'v006' && item.period === currentPeriod())
  assert.equal(report.operator, testUsers.driver.displayName, 'Shared driver actor was not taken from server identity')
  assert.ok(report.submittedByUserId, 'Shared report did not record authenticated submitter ID')
  assert.equal(submitted.state.vehicles.find(item => item.id === 'v006').status, 'In maintenance', 'Driver unsafe report did not hold vehicle')
  const ticket = submitted.state.tickets.find(item => item.sourceReportId === report.id)
  assert.equal(ticket?.severity, 'High', 'Unsafe report did not generate high-priority work')
  await viewportFits(driver.page, '390px shared Driver form')

  // The supervisor started with an older snapshot. Reenter the signed-in
  // session to load the new driver report without changing identities.
  await reenterShared(supervisor)
  const pending = supervisor.page.locator('.fleet-review-item').filter({ hasText: 'UTD-0220' })
  await pending.waitFor()
  await pending.locator('textarea').fill('Confirm the brake warning and the corrected ending reading.')
  await pending.getByRole('button', { name: /Return for correction/i }).click()
  await waitForState(state => state.reports.find(item => item.id === report.id)?.status === 'Returned', 'department supervisor return')

  await reenterShared(driver)
  await driver.page.locator('#fleet-report-vehicle').selectOption('v006')
  assert.ok(await driver.page.getByText(/Returned for correction/i).first().isVisible(), 'Driver cannot see supervisor correction request')
  await driver.page.locator('#fleet-report-end').fill('111916')
  await driver.page.locator('#fleet-report-notes').fill('Brake warning confirmed. Odometer corrected and vehicle awaiting shop review.')
  await driver.page.locator('#fleet-report-form button[type=submit]').click()
  await waitForState(state => state.reports.find(item => item.id === report.id)?.revision === 2 &&
    state.reports.find(item => item.id === report.id)?.status === 'Pending', 'driver correction/revision')

  await reenterShared(supervisor)
  const corrected = supervisor.page.locator('.fleet-review-item').filter({ hasText: 'UTD-0220' })
  await corrected.waitFor()
  await corrected.getByRole('button', { name: /Approve report/i }).click()
  const approved = await waitForState(state => state.reports.find(item => item.id === report.id)?.status === 'Approved', 'supervisor approval')
  assert.ok(approved.state.reportHistory.some(entry => entry.reportId === report.id && entry.action === 'Returned'), 'Supervisor return missing from shared history')
  assert.ok(approved.state.reportHistory.some(entry => entry.reportId === report.id && entry.action === 'Resubmitted'), 'Driver correction missing from shared history')
  assert.equal(approved.state.vehicles.find(item => item.id === 'v006').status, 'In maintenance', 'Approval incorrectly released safety hold')

  await reenterShared(maintenance)
  const workOrder = maintenance.page.locator('.fleet-ticket').filter({ hasText: 'Safety-critical condition reported' }).filter({ hasText: 'UTD-0220' })
  await workOrder.waitFor()
  await workOrder.getByRole('button', { name: /Update work/i }).click()
  await workOrder.locator('select[id^="fleet-service-status-"]').selectOption('Scheduled')
  await workOrder.locator('input[id^="fleet-service-assignee-"]').fill('Demo Repair Technician')
  await workOrder.locator('input[id^="fleet-service-date-"]').fill(futureDate())
  await workOrder.getByRole('button', { name: /Save service update/i }).click()
  await waitForState(state => state.tickets.find(item => item.id === ticket.id)?.status === 'Scheduled', 'technician scheduling')
  if (!(await workOrder.locator('.fleet-maintenance-editor').count())) {
    await workOrder.getByRole('button', { name: /Update work/i }).click()
  }
  await workOrder.locator('select[id^="fleet-service-status-"]').selectOption('Resolved')
  await workOrder.locator('textarea[id^="fleet-service-resolution-"]').fill('Repaired brake warning circuit and inspected road-test operation.')
  await workOrder.getByRole('button', { name: /Save service update/i }).click()
  const serviced = await waitForState(state => state.tickets.find(item => item.id === ticket.id)?.status === 'Resolved', 'technician closure')
  assert.ok(serviced.state.ticketHistory.some(entry => entry.ticketId === ticket.id && entry.snapshot.status === 'Scheduled'), 'Service schedule history missing')
  assert.ok(serviced.state.ticketHistory.some(entry => entry.ticketId === ticket.id && entry.snapshot.status === 'Resolved'), 'Service resolution history missing')
  assert.equal(serviced.state.vehicles.find(item => item.id === 'v006').status, 'In maintenance', 'Work-order closure silently released vehicle')

  // Admin operates in another session and sees the committed cross-role work.
  await reenterShared(admin)
  await assertWorkspace(admin, 'Fleet Admin', 'Fleet exceptions and assignments')
  await navigate(admin, 'Vehicle directory')
  await admin.page.locator('.fleet-vehicle-row').filter({ hasText: 'UTD-0220' }).click()
  await admin.page.locator('#fleet-vehicle-status').selectOption('Active')
  await admin.page.locator('#fleet-vehicle-status-note').fill('Garage repair reviewed; explicit return to service documented.')
  admin.page.once('dialog', dialog => dialog.accept())
  await admin.page.getByRole('button', { name: 'Save vehicle status' }).click()
  await waitForState(state => state.vehicles.find(vehicle => vehicle.id === 'v006')?.status === 'Active', 'administrator manual service release')

  // A task can be closed across users while its missing report stays missing.
  await navigate(admin, 'Exceptions')
  await admin.page.locator('#fleet-period').fill(twoMonthsAgo())
  await admin.page.locator('#fleet-department').selectOption('Facilities')
  const missing = admin.page.locator('.fleet-exception-row').filter({ hasText: 'UTD-0220' }).filter({ hasText: /Overdue report/i })
  if (!(await missing.count())) {
    const showAll = admin.page.getByRole('button', { name: /Show all \d+ exceptions/i })
    if (await showAll.count()) await showAll.click()
  }
  await missing.waitFor()
  await missing.getByRole('button', { name: 'Create follow-up' }).click()
  const form = admin.page.locator('.fleet-exception-follow-up-row')
  await form.getByLabel('Responsible owner').fill('Demo Facilities Supervisor')
  await form.getByLabel('Next check-in date').fill(futureDate(3))
  await form.getByLabel('Internal task note').fill('Call unit custodian about the missing monthly fleet report.')
  await form.getByRole('button', { name: 'Create internal task' }).click()
  const taskState = await waitForState(state => state.followUps.some(task => task.vehicleId === 'v006' && task.period === twoMonthsAgo() && task.status === 'Open'), 'local follow-up task')
  const task = taskState.state.followUps.find(item => item.vehicleId === 'v006' && item.period === twoMonthsAgo() && item.status === 'Open')
  assert.equal(taskState.state.reports.some(item => item.vehicleId === 'v006' && item.period === twoMonthsAgo()), false, 'Creating a local task was mistaken for report submission')
  const taskRow = admin.page.locator('.fleet-follow-up-row').filter({ hasText: 'UTD-0220' })
  await taskRow.getByRole('button', { name: 'Update task' }).click()
  await admin.page.locator('.fleet-follow-up-detail').getByLabel('Outcome or contact result (required to close)').fill('Custodian notified. Monthly report still due; no submitted record was received.')
  await admin.page.locator('.fleet-follow-up-detail').getByRole('button', { name: /Close with outcome/i }).click()
  const closed = await waitForState(state => state.followUps.find(item => item.id === task.id)?.status === 'Closed', 'local task outcome')
  assert.equal(closed.state.reports.some(item => item.vehicleId === 'v006' && item.period === twoMonthsAgo()), false, 'Closing a task falsely cleared the missed report')

  await navigate(admin, 'Quarterly review')
  await admin.page.getByText('Internal review staging only. No state submission.').waitFor()
  const [exportFile] = await Promise.all([
    admin.page.waitForEvent('download'),
    admin.page.getByRole('button', { name: /Download quarter review/i }).click(),
  ])
  const csv = await readFile(await exportFile.path(), 'utf8')
  assert.match(csv, /STAGING ONLY - NOT A TxFS SUBMISSION/i)
  assert.match(csv, /Data-quality issues requiring review/)
  assert.ok(!csv.includes('CART-'), 'Quarter reconciliation included unlicensed carts')
  await viewportFits(admin.page, 'Shared admin quarterly review')

  // A new device/session gets only its authorized mobile Driver workspace.
  const narrow = await newActor('Driver', { width: 320, height: 740 })
  narrow.account = testUsers.driver
  await enterShared(narrow)
  await assertWorkspace(narrow, 'Driver', 'My monthly report')
  assert.ok(await narrow.page.getByTestId('driver-workspace').isVisible())
  assert.ok(await narrow.page.locator('#fleet-report-vehicle').evaluate(element => element.getBoundingClientRect().height >= 44), '320px Driver vehicle picker is not touch-sized')
  await viewportFits(narrow.page, '320px shared Driver form')
  await narrow.page.goto(origin + '/campus-map', { waitUntil: 'domcontentloaded' })
  await narrow.page.locator('.leaflet-container').waitFor()
  await viewportFits(narrow.page, '320px preserved campus map')

  for (const actor of [admin, driver, supervisor, housing, maintenance, narrow]) {
    assert.deepEqual(actor.errors, [], actor.name + ' browser reported an uncaught JavaScript error')
    await actor.context.close()
  }
  console.log('FleetSync shared browser smoke passed: 6 isolated sessions; Driver / Supervisor / Technician / Admin personas, real submit→return→correct→approve, durable service assignment and hold, local follow-up completion, quarter review-only CSV, 390/320px and campus-map.')
} finally {
  await browser?.close()
  if (frontend?.httpServer) await new Promise((resolveClose, reject) => {
    frontend.httpServer.close(error => error ? reject(error) : resolveClose())
  })
  await backend?.close()
  await rm(temporary, { recursive: true, force: true })
}
