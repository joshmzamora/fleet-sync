import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { preview } from 'vite'

// Run after npm run build. This exercises the real production UI without
// changing any user's browser state or calling external fleet services.
// Keep preview isolated even if another local Vite preview occupies 4193.
const server = await preview({ preview: { host: '127.0.0.1', port: 4193, strictPort: false } })
const address = server.httpServer.address()
assert.ok(address && typeof address === 'object', 'Vite preview did not bind a local port')
const baseUrl = 'http://127.0.0.1:' + address.port
const storageKey = 'fleetsync-operations-demo-v1'
let browser

async function clearDemo(page) {
  await page.goto(baseUrl + '/', { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => localStorage.clear())
  await page.reload({ waitUntil: 'domcontentloaded' })
}

async function savedFleet(page) {
  return page.evaluate(key => {
    const value = localStorage.getItem(key)
    return value ? JSON.parse(value) : null
  }, storageKey)
}

async function savedReport(page, vehicleId, period) {
  const state = await savedFleet(page)
  assert.ok(state, 'Fleet changes were not written to local storage')
  return state.reports.find(report => report.vehicleId === vehicleId && report.period === period)
}

async function assertViewportFits(page, label) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  assert.ok(overflow <= 2, label + ' overflows horizontally by ' + overflow + 'px')
}

function futureDate(days = 14) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}

try {
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await clearDemo(page)
  await page.getByRole('heading', { name: 'Exceptions and reporting' }).waitFor()
  assert.ok(await page.locator('.fleet-app').isVisible(), 'FleetSync dashboard failed to mount')
  assert.ok(!(await page.locator('.fleet-overlay').isVisible()), 'An inactive mobile overlay is covering the desktop application')
  assert.ok(await page.locator('a[href="/campus-map"]').count() > 0, 'The preserved campus map is not linked')
  await assertViewportFits(page, 'Operational work queues at 1440px')
  assert.equal(await page.locator('.fleet-ops-summary__item').count(), 6, 'Operational KPI strip should expose six distinct metrics')
  const desktopLayout = await page.evaluate(() => {
    const strip = document.querySelector('.fleet-ops-summary')
    const exceptions = document.querySelector('.fleet-overview-grid .fleet-actions-card')
    const orders = document.querySelector('.fleet-open-work-orders')
    if (!strip || !exceptions || !orders) return null
    return {
      columns: getComputedStyle(strip).gridTemplateColumns.split(' ').length,
      exceptions: exceptions.getBoundingClientRect().top,
      orders: orders.getBoundingClientRect().top,
      exceptionWidth: exceptions.getBoundingClientRect().width,
      workWidth: orders.getBoundingClientRect().width,
    }
  })
  assert.ok(desktopLayout, 'Operational summary or work queues missing')
  assert.equal(desktopLayout.columns, 6, 'Desktop KPI labels/values are not in a six-column summary')
  assert.ok(desktopLayout.exceptions < desktopLayout.orders, 'Exceptions must precede work orders in the desktop workflow')
  assert.ok(Math.abs(desktopLayout.exceptionWidth - desktopLayout.workWidth) <= 2, 'Exception and work order tables should both be full-width')

  await page.locator('#fleet-role').selectOption('Driver')
  const initialPeriod = await page.locator('#fleet-period').inputValue()
  await page.locator('#fleet-report-vehicle').selectOption('v006')
  await page.locator('#fleet-report-start').fill('111900')
  await page.locator('#fleet-report-end').fill('111912')
  await page.locator('#fleet-report-fuel').fill('4')
  await page.locator('#fleet-report-cost').fill('15.50')
  await page.locator('#fleet-report-condition').selectOption('Unsafe')
  await page.locator('#fleet-report-operator').fill('Demo Test Driver')
  await page.locator('#fleet-report-notes').fill('Brake warning lamp illuminated during use.')
  await page.locator('.fleet-form').filter({ has: page.locator('#fleet-report-vehicle') }).locator('button[type=submit]').click()
  assert.ok(await page.getByText('Monthly report sent to the demo supervisor queue.').isVisible(), 'Driver submission did not succeed')
  assert.ok(await page.locator('.fleet-app').getByText('UTD-0220').first().isVisible())
  const firstReport = await savedReport(page, 'v006', initialPeriod)
  assert.equal(firstReport?.status, 'Pending', 'Driver submission did not enter the supervisor queue')
  assert.equal(firstReport?.revision, 1, 'First driver submission should be revision 1')
  assert.equal(firstReport?.endOdometer, 111912, 'First driver mileage was not saved')
  assert.match(firstReport?.notes ?? '', /Brake warning lamp illuminated/, 'First driver safety observation was not saved')
  assert.equal((await savedFleet(page)).vehicles.find(vehicle => vehicle.id === 'v006')?.status, 'In maintenance', 'Unsafe driver observation did not place vehicle on a service hold')

  await page.locator('#fleet-role').selectOption('Supervisor')
  const item = page.locator('.fleet-review-item').filter({ hasText: 'UTD-0220' })
  await item.waitFor()
  await item.locator('textarea').fill('Please confirm the warning and mileage.')
  await item.getByRole('button', { name: /Return for correction/i }).click()
  assert.equal(await page.locator('.fleet-review-item').filter({ hasText: 'UTD-0220' }).count(), 0, 'Returned report remained pending')
  assert.equal((await savedReport(page, 'v006', initialPeriod))?.status, 'Returned', 'Supervisor return was not persisted')

  await page.locator('#fleet-role').selectOption('Driver')
  await page.locator('#fleet-report-vehicle').selectOption('v006')
  assert.ok(await page.getByText(/Returned for correction/i).first().isVisible())
  await page.locator('#fleet-report-end').fill('111914')
  await page.locator('#fleet-report-operator').fill('Demo Test Driver')
  await page.locator('#fleet-report-notes').fill('Brake warning lamp confirmed. Vehicle awaiting service check.')
  await page.locator('.fleet-form').filter({ has: page.locator('#fleet-report-vehicle') }).locator('button[type=submit]').click()
  const correctedReport = await savedReport(page, 'v006', initialPeriod)
  assert.equal(correctedReport?.status, 'Pending', 'Corrected driver report did not re-enter review')
  assert.equal(correctedReport?.revision, 2, 'Corrected driver report did not increment revision')
  assert.equal(correctedReport?.endOdometer, 111914, 'Corrected mileage was not persisted')
  assert.match(correctedReport?.notes ?? '', /confirmed/, 'Corrected condition notes not persisted')

  await page.locator('#fleet-role').selectOption('Supervisor')
  const resubmitted = page.locator('.fleet-review-item').filter({ hasText: 'UTD-0220' })
  await resubmitted.waitFor()
  await resubmitted.getByRole('button', { name: /Approve report/i }).click()
  const approvedReport = await savedReport(page, 'v006', initialPeriod)
  assert.equal(approvedReport?.status, 'Approved', 'Supervisor approval did not persist')
  assert.equal(approvedReport?.revision, 2, 'Supervisor approval should not alter driver revision number')
  const approvedState = await savedFleet(page)
  assert.equal(approvedState.vehicles.find(vehicle => vehicle.id === 'v006')?.status, 'In maintenance', 'Supervisor approval prematurely released a vehicle safety hold')
  // The domain stores newest-first, while this invariant checks the actual
  // chronology of saved immutable versions.
  const revisionTimeline = approvedState.reportHistory.filter(entry => entry.reportId === approvedReport.id).reverse()
  assert.deepEqual(
    revisionTimeline.map(entry => entry.action),
    ['Submitted', 'Returned', 'Resubmitted', 'Approved'],
    'Driver correction and supervisor decisions must retain an append-only report history',
  )
  assert.deepEqual(
    revisionTimeline.map(entry => entry.revision),
    [1, 1, 2, 2],
    'Supervisor decisions must not overwrite or increment the driver revision sequence',
  )
  assert.equal(revisionTimeline[0].snapshot.endOdometer, 111912, 'Original odometer was not preserved in revision history')
  assert.equal(revisionTimeline[2].snapshot.endOdometer, 111914, 'Corrected odometer was not preserved in revision history')
  assert.match(revisionTimeline[1].snapshot.reviewNote ?? '', /confirm the warning/i, 'Supervisor return reason missing from revision history')
  assert.equal(revisionTimeline[0].snapshot.status, 'Pending', 'Original submission snapshot was mutated after approval')
  // Do not stop at storage assertions: drivers and reviewers need to inspect
  // exactly what changed through the real history UI.
  await page.getByRole('tab', { name: /All reports/i }).click()
  const reportedRow = page.locator('.fleet-record-anchor').filter({ hasText: 'UTD-0220' })
  await reportedRow.getByRole('button', { name: 'History', exact: true }).click()
  const reportTimeline = page.locator('.fleet-history-expanded .fleet-history-ledger')
  await reportTimeline.waitFor()
  assert.equal(await reportTimeline.locator('.fleet-history-entry').count(), 4, 'Report history UI omitted correction or review events')
  assert.ok(await reportTimeline.getByText(/Revision 1 · Submitted/i).isVisible(), 'Original revision missing from the history panel')
  assert.ok(await reportTimeline.getByText(/Revision 2 · Resubmitted/i).isVisible(), 'Corrected revision missing from the history panel')
  assert.ok(await reportTimeline.getByText(/111,900.*111,912.*mi/i).first().isVisible(), 'Original mileage is not inspectable in the history panel')
  assert.ok(await reportTimeline.getByText(/111,900.*111,914.*mi/i).first().isVisible(), 'Corrected mileage is not inspectable in the history panel')
  assert.ok(await reportTimeline.getByText(/Please confirm the warning and mileage/i).isVisible(), 'Supervisor feedback not visible in report history')

  await page.locator('#fleet-role').selectOption('Maintenance')
  const ticket = page.locator('.fleet-ticket').filter({ hasText: 'UTD-0220' }).filter({ hasText: 'Safety-critical condition reported' })
  await ticket.waitFor()
  assert.ok(await ticket.getByText('Safety-critical condition reported').isVisible(), 'Unsafe condition did not produce a maintenance ticket')
  await ticket.getByRole('button', { name: /Update work/i }).click()
  await ticket.locator('select[id^="fleet-service-status-"]').selectOption('Scheduled')
  await ticket.locator('input[id^="fleet-service-assignee-"]').fill('Demo Garage Dispatcher')
  await ticket.locator('input[id^="fleet-service-date-"]').fill(futureDate(14))
  await ticket.getByRole('button', { name: 'Save service update' }).click()
  assert.ok(await ticket.getByText('Scheduled', { exact: true }).first().isVisible(), 'Scheduled service follow-through was not saved')
  assert.equal((await savedFleet(page)).vehicles.find(vehicle => vehicle.id === 'v006')?.status, 'In maintenance', 'Scheduling service prematurely released a safety hold')

  await page.locator('#fleet-role').selectOption('Fleet Admin')
  await page.getByRole('button', { name: /Quarterly review/i }).first().click()
  await page.getByText('Internal review staging only. No state submission.').waitFor()
  await assertViewportFits(page, 'Quarter reconciliation at 1440px')
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /Download monthly review/i }).first().click(),
  ])
  const csv = await readFile(await download.path(), 'utf8')
  assert.ok(csv.includes('UTD-0220'), 'Approved report missing from review export')
  assert.ok(!csv.includes('CART-'), 'Cart records should not appear in licensed-vehicle export')
  assert.ok(await page.getByText('Report approved').first().isVisible(), 'Approval missing from audit history')

  await page.reload()
  await page.getByRole('heading', { name: 'Exceptions and reporting' }).waitFor()
  await page.getByRole('button', { name: /Quarterly review/i }).first().click()
  assert.ok(await page.getByText('UTD-0220').first().isVisible(), 'Browser refresh lost saved records')

  // Exercise the remaining admin/maintenance creation paths with an
  // additional fictional unit, then confirm Reset restores the seed.
  await page.getByRole('button', { name: 'Vehicle directory', exact: true }).first().click()
  await page.getByRole('button', { name: /Add vehicle/i }).first().click()
  await page.locator('#fleet-new-unit').fill('DEMO-1001')
  await page.locator('#fleet-new-department').selectOption('Housing')
  await page.locator('#fleet-new-year').fill('2022')
  await page.locator('#fleet-new-make').fill('Ford')
  await page.locator('#fleet-new-model').fill('Test Van')
  await page.locator('#fleet-new-kind').selectOption('Van')
  await page.locator('#fleet-new-plate').fill('DEMO-PLATE')
  await page.locator('#fleet-new-odometer').fill('120')
  await page.locator('#fleet-new-custodian').fill('Demo Housing Custodian')
  await page.locator('.fleet-create-card form button[type=submit]').click()
  await page.locator('.fleet-vehicle-row').filter({ hasText: 'DEMO-1001' }).waitFor()

  await page.locator('#fleet-role').selectOption('Maintenance')
  await page.getByRole('button', { name: /New issue/i }).first().click()
  const addedVehicleOption = page.locator('#fleet-new-ticket-vehicle option').filter({ hasText: 'DEMO-1001' })
  const addedVehicleId = await addedVehicleOption.getAttribute('value')
  assert.ok(addedVehicleId, 'Newly created vehicle unavailable in maintenance form')
  await page.locator('#fleet-new-ticket-vehicle').selectOption(addedVehicleId)
  await page.locator('#fleet-new-ticket-title').fill('Demo tire inspection')
  await page.locator('#fleet-new-ticket-severity').selectOption('Medium')
  await page.locator('#fleet-new-ticket-description').fill('Check front tires before next trip.')
  await page.locator('.fleet-create-card form button[type=submit]').click()
  await page.locator('.fleet-ticket').filter({ hasText: 'Demo tire inspection' }).waitFor()
  await page.locator('#fleet-department').selectOption('Housing')
  assert.ok(await page.locator('.fleet-ticket').filter({ hasText: 'Demo tire inspection' }).isVisible(), 'Department filtering lost maintenance item')

  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: /Reset demo data/i }).first().click()
  await page.getByRole('button', { name: 'Vehicle directory', exact: true }).first().click()
  assert.equal(await page.locator('.fleet-vehicle-row').filter({ hasText: 'DEMO-1001' }).count(), 0, 'Reset failed to remove demo-created vehicle')

  assert.deepEqual(errors, [], 'JavaScript errors occurred during fleet workflows')
  await page.close()

  // Independent operations scenario: every follow-up and department change
  // must survive in the same local record store after navigating and refreshing.
  const operations = await browser.newPage({ viewport: { width: 1280, height: 850 }, acceptDownloads: true })
  const operationsErrors = []
  operations.on('pageerror', error => operationsErrors.push(error.message))
  await clearDemo(operations)
  await operations.getByRole('heading', { name: 'Exceptions and reporting' }).waitFor()

  const thisPeriod = await operations.locator('#fleet-period').inputValue()
  const [year, month] = thisPeriod.split('-').map(Number)
  const overdueDate = new Date(year, month - 3, 1)
  const overduePeriod = overdueDate.getFullYear() + '-' + String(overdueDate.getMonth() + 1).padStart(2, '0')
  await operations.locator('#fleet-period').fill(overduePeriod)
  await operations.locator('#fleet-department').selectOption('Facilities')

  const missing = operations.locator('.fleet-exception-row').filter({ hasText: 'UTD-0220' }).filter({ hasText: /Overdue report/i })
  if (await missing.count() === 0) {
    const showAll = operations.getByRole('button', { name: /Show all \d+ exceptions/i })
    if (await showAll.count()) await showAll.click()
  }
  await missing.waitFor()
  assert.ok(await missing.getByText(/overdue/i).first().isVisible(), 'Past-due missing submission was not actionable')
  await missing.getByRole('button', { name: 'Create follow-up' }).click()
  const followUpEditor = operations.locator('.fleet-exception-follow-up-row')
  await followUpEditor.getByLabel('Responsible owner').fill('Demo Facilities Dispatch')
  await followUpEditor.getByLabel('Next check-in date').fill(futureDate(4))
  await followUpEditor.getByLabel('Internal task note').fill('Call Facilities coordinator to request the missing use report.')
  await followUpEditor.getByRole('button', { name: 'Create internal task' }).click()
  let operationsState = await savedFleet(operations)
  const followUp = operationsState.followUps.find(task => task.vehicleId === 'v006' && task.period === overduePeriod)
  assert.ok(followUp, 'Follow-up action did not persist a local task')
  assert.equal(followUp.status, 'Open', 'New follow-up task must be open')
  assert.equal(followUp.owner, 'Demo Facilities Dispatch', 'Follow-up owner was not saved')
  assert.equal(followUp.dueOn, futureDate(4), 'Next check-in date was not saved')
  assert.match(followUp.note, /Call Facilities coordinator/, 'Task notes were not saved')
  assert.equal(operationsState.reports.some(report => report.vehicleId === 'v006' && report.period === overduePeriod), false, 'Creating a local task must not fabricate a submitted report')
  assert.ok(operationsState.audit.some(entry => /Follow-up logged/i.test(entry.action)), 'Follow-up audit trail missing')

  const taskRow = operations.locator('.fleet-follow-up-row').filter({ hasText: 'UTD-0220' })
  await taskRow.waitFor()
  await taskRow.getByRole('button', { name: 'Update task' }).click()
  const taskEditor = operations.locator('.fleet-follow-up-detail')
  const closeTask = taskEditor.getByRole('button', { name: /Close with outcome/i })
  assert.ok(await closeTask.isDisabled(), 'A follow-up must not be closable without an outcome')
  await taskEditor.getByLabel('Outcome or contact result (required to close)').fill('Reached department coordinator. They will submit the missing monthly form tomorrow.')
  await closeTask.click()
  operationsState = await savedFleet(operations)
  const closedTask = operationsState.followUps.find(task => task.id === followUp.id)
  assert.equal(closedTask?.status, 'Closed', 'Follow-up task did not close')
  assert.match(closedTask?.outcome ?? '', /Reached department coordinator/, 'Task closure outcome was not preserved')
  assert.ok(closedTask?.closedAt && closedTask?.closedBy, 'Task closure actor or timestamp missing')
  assert.equal(operationsState.reports.some(report => report.vehicleId === 'v006' && report.period === overduePeriod), false, 'Closing a follow-up must not substitute for an actual monthly submission')
  assert.ok(operationsState.audit.some(entry => /Follow-up task closed.*no message sent/i.test(entry.action)), 'Local-only task closure was not audited')
  await operations.locator('.fleet-follow-up-queue').getByRole('button', { name: /Closed \(1\)/i }).click()
  assert.ok(await operations.locator('.fleet-follow-up-row').filter({ hasText: 'UTD-0220' }).getByText('Closed', { exact: true }).isVisible(), 'Closed follow-up is not reviewable')
  assert.ok(await missing.isVisible(), 'A closed follow-up incorrectly cleared the overdue reporting exception')

  await missing.getByRole('button', { name: /Submit for UTD-0220/i }).click()
  await operations.locator('#fleet-report-vehicle').waitFor()
  assert.equal(await operations.locator('#fleet-report-vehicle').inputValue(), 'v006', 'Exception did not open the missing vehicle report')
  assert.equal(await operations.locator('#fleet-period').inputValue(), overduePeriod, 'Exception lost the selected reporting month')

  await operations.getByRole('button', { name: /^Exceptions\b/ }).click()
  const facilities = operations.locator('.fleet-scorecard-table tbody tr').filter({ hasText: 'Facilities' })
  await facilities.getByRole('button', { name: 'Edit' }).click()
  await operations.locator('#fleet-dept-coordinator').fill('Demo Accountability Lead')
  await operations.locator('#fleet-dept-contact').fill('coordinator@example.test')
  await operations.locator('#fleet-dept-day').fill('8')
  await operations.locator('#fleet-dept-notes').fill('Verify monthly fleet mileage by the internal due day.')
  await operations.getByRole('button', { name: /Save department settings/i }).click()
  operationsState = await savedFleet(operations)
  const facilitiesProfile = operationsState.departmentProfiles.find(profile => profile.name === 'Facilities')
  assert.equal(facilitiesProfile?.coordinator, 'Demo Accountability Lead', 'Department coordinator edit was not saved')
  assert.equal(facilitiesProfile?.monthlyDueDay, 8, 'Department due-day edit was not saved')
  assert.equal(facilitiesProfile?.contact, 'coordinator@example.test', 'Department contact edit was not saved')

  await operations.getByRole('button', { name: 'Vehicle directory', exact: true }).click()
  await operations.locator('.fleet-vehicle-row').filter({ hasText: 'UTD-0220' }).click()
  await operations.getByRole('button', { name: 'Edit vehicle' }).click()
  await operations.locator('#fleet-edit-custodian').fill('Demo QA Custodian')
  await operations.locator('#fleet-edit-notes').fill('Unit is awaiting an internal maintenance inspection.')
  await operations.getByRole('button', { name: 'Save vehicle details' }).click()
  operationsState = await savedFleet(operations)
  assert.equal(operationsState.vehicles.find(vehicle => vehicle.id === 'v006')?.custodian, 'Demo QA Custodian', 'Vehicle custodian update did not persist')
  assert.match(operationsState.vehicles.find(vehicle => vehicle.id === 'v006')?.notes ?? '', /awaiting an internal maintenance inspection/i, 'Vehicle notes update did not persist')

  await operations.locator('#fleet-vehicle-status').selectOption('In maintenance')
  await operations.locator('#fleet-vehicle-status-note').fill('Maintenance hold pending confirmed inspection and service review.')
  await operations.getByRole('button', { name: 'Save vehicle status' }).click()
  operationsState = await savedFleet(operations)
  assert.equal(operationsState.vehicles.find(vehicle => vehicle.id === 'v006')?.status, 'In maintenance', 'Vehicle service hold did not persist')
  assert.ok(operationsState.audit.some(entry => /Vehicle status changed/i.test(entry.action)), 'Vehicle status change missing from audit')

  await operations.locator('#fleet-vehicle-search').fill('Demo QA Custodian')
  assert.equal(await operations.locator('.fleet-vehicle-row').count(), 1, 'Vehicle search must filter the directory rather than just changing a counter')
  assert.ok(await operations.locator('.fleet-vehicle-row').filter({ hasText: 'UTD-0220' }).isVisible(), 'Vehicle search did not match edited custodian')
  await operations.reload({ waitUntil: 'domcontentloaded' })
  await operations.getByRole('button', { name: 'Vehicle directory', exact: true }).click()
  assert.equal(await operations.locator('#fleet-vehicle-search').inputValue(), 'Demo QA Custodian', 'Saved directory search filter was not restored after browser refresh')
  await operations.getByRole('button', { name: 'Clear vehicle search' }).click()
  assert.ok(await operations.locator('.fleet-vehicle-row').count() > 1, 'Clearing vehicle search did not restore directory results')

  await operations.locator('#fleet-role').selectOption('Maintenance')
  const oilChange = operations.locator('.fleet-ticket').filter({ hasText: 'Oil change overdue' })
  await oilChange.waitFor()
  await oilChange.getByRole('button', { name: 'Update work' }).click()
  let serviceEditor = oilChange.locator('.fleet-maintenance-editor')
  await serviceEditor.locator('select[id^="fleet-service-status-"]').selectOption('Scheduled')
  await serviceEditor.locator('input[id^="fleet-service-assignee-"]').fill('Demo Maintenance Technician')
  await serviceEditor.locator('input[id^="fleet-service-date-"]').fill(futureDate(7))
  await serviceEditor.getByRole('button', { name: 'Save service update' }).click()
  assert.equal((await savedFleet(operations)).tickets.find(item => item.id === 't003')?.status, 'Scheduled', 'Work order did not move to scheduled service')
  await oilChange.getByRole('button', { name: 'Update work' }).click()
  serviceEditor = oilChange.locator('.fleet-maintenance-editor')
  await serviceEditor.locator('select[id^="fleet-service-status-"]').selectOption('Resolved')
  assert.equal(await serviceEditor.locator('textarea:required').count(), 1, 'Resolution note should be mandatory for resolved tickets')
  await serviceEditor.getByRole('button', { name: 'Save service update' }).click()
  assert.equal((await savedFleet(operations)).tickets.find(item => item.id === 't003')?.status, 'Scheduled', 'Ticket resolved without a repair note')
  await serviceEditor.locator('input[id^="fleet-service-cost-"]').fill('78.25')
  await serviceEditor.locator('textarea[id^="fleet-service-resolution-"]').fill('Replaced oil filter, checked fluid levels, and confirmed normal readings.')
  await serviceEditor.getByRole('button', { name: 'Save service update' }).click()
  operationsState = await savedFleet(operations)
  const repaired = operationsState.tickets.find(item => item.id === 't003')
  assert.equal(repaired?.status, 'Resolved', 'Maintenance resolution did not persist')
  assert.match(repaired?.resolutionNote ?? '', /Replaced oil filter/, 'Resolution note not saved')
  assert.equal(repaired?.assignee, 'Demo Maintenance Technician', 'Maintenance owner not saved')
  assert.equal(repaired?.actualCost, 78.25, 'Actual maintenance cost not saved')
  const oilHistory = operationsState.ticketHistory.filter(entry => entry.ticketId === 't003')
  assert.ok(oilHistory.some(entry => entry.snapshot.status === 'Open'), 'Original work-order state missing from service history')
  assert.ok(oilHistory.some(entry => entry.snapshot.status === 'Scheduled' && entry.snapshot.assignee === 'Demo Maintenance Technician'), 'Scheduled work-order state missing from service history')
  assert.ok(oilHistory.some(entry => entry.snapshot.status === 'Resolved' && /Replaced oil filter/.test(entry.snapshot.resolutionNote ?? '')), 'Work-order closure snapshot and resolution outcome were not preserved')
  assert.equal(operationsState.vehicles.find(vehicle => vehicle.id === 'v006')?.status, 'In maintenance', 'Closing a ticket should not silently release a vehicle hold')
  await operations.getByRole('group', { name: 'Filter maintenance status' }).getByRole('button', { name: 'All', exact: true }).click()
  const closedOilOrder = operations.locator('.fleet-ticket').filter({ hasText: 'Oil change overdue' })
  const visibleServiceHistory = closedOilOrder.locator('.fleet-work-order-history')
  // Saving service work automatically expands its history. Only open it when
  // still collapsed; the button changes its name to "Hide activity" when open.
  if (!(await visibleServiceHistory.isVisible())) {
    await closedOilOrder.getByRole('button', { name: /Activity \(/i }).click()
  }
  await visibleServiceHistory.waitFor()
  assert.ok(await visibleServiceHistory.getByText('Scheduled', { exact: true }).first().isVisible(), 'Service scheduling is absent from visible work-order history')
  assert.ok(await visibleServiceHistory.getByText('Resolved', { exact: true }).first().isVisible(), 'Service closure is absent from visible work-order history')
  assert.ok(await visibleServiceHistory.getByText(/Replaced oil filter/i).first().isVisible(), 'Repair outcome is not inspectable in the work-order activity')

  await operations.locator('#fleet-role').selectOption('Fleet Admin')
  await operations.getByRole('button', { name: /Quarterly review/i }).first().click()
  await operations.getByRole('heading', { name: 'Three-month readiness' }).waitFor()
  assert.equal(await operations.locator('.fleet-quarterly-month').count(), 3, 'Quarter review should display exactly three months')
  assert.ok(await operations.getByText(/not validated TxFS batch layouts/i).isVisible(), 'Quarter review staging disclaimer missing')
  const quarterSelect = operations.locator('#fleet-quarter-number')
  const originalQuarter = await quarterSelect.inputValue()
  const otherQuarter = originalQuarter === '1' ? '2' : '1'
  await quarterSelect.selectOption(otherQuarter)
  assert.equal(await quarterSelect.inputValue(), otherQuarter, 'Fiscal quarter selector did not change the review')
  await quarterSelect.selectOption(originalQuarter)
  const fiscalYear = await operations.locator('#fleet-quarter-year').inputValue()
  const [quarterDownload] = await Promise.all([
    operations.waitForEvent('download'),
    operations.getByRole('button', { name: /Download quarter review/i }).click(),
  ])
  assert.match(quarterDownload.suggestedFilename(), new RegExp('FY' + fiscalYear + '-Q' + originalQuarter), 'Quarter export filename lost the fiscal scope')
  const quarterCsv = await readFile(await quarterDownload.path(), 'utf8')
  assert.match(quarterCsv, /STAGING ONLY - NOT A TxFS SUBMISSION/i, 'Quarter worksheet lacks the staging-only header')
  assert.match(quarterCsv, /UTD-0220/, 'Licensed vehicle omitted from quarter reconciliation')
  assert.match(quarterCsv, /Missing/, 'Quarter worksheet should show incomplete month statuses')
  assert.ok(!quarterCsv.includes('CART-'), 'Unlicensed carts leaked into quarterly licensed-vehicle staging')
  operationsState = await savedFleet(operations)
  assert.ok(operationsState.audit.some(entry => /Quarterly review CSV prepared \(local only\)/i.test(entry.action)), 'Quarter export was not audited')

  const overdueMonthName = overdueDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  const quarterGap = operations.getByRole('button', { name: 'Missing for UTD-0220 in ' + overdueMonthName + '. Open workflow' })
  await quarterGap.click()
  await operations.locator('#fleet-report-vehicle').waitFor()
  assert.equal(await operations.locator('#fleet-report-vehicle').inputValue(), 'v006', 'Quarter gap did not open its vehicle')
  assert.equal(await operations.locator('#fleet-period').inputValue(), overduePeriod, 'Quarter gap opened the wrong month')

  // Review the quarter containing the deliberately incomplete approved demo
  // record from two months ago, even across fiscal-quarter boundaries.
  // Quality warnings are independent from approval status.
  await operations.getByRole('button', { name: /Quarterly review/i }).first().click()
  await operations.locator('#fleet-department').selectOption('All departments')
  const qualityYear = overdueDate.getFullYear()
  const qualityMonth = overdueDate.getMonth() + 1
  const seededFiscalYear = qualityMonth >= 9 ? qualityYear + 1 : qualityYear
  const seededQuarter = qualityMonth >= 9 ? Math.floor((qualityMonth - 9) / 3) + 1 : Math.floor((qualityMonth + 3) / 3) + 1
  await operations.locator('#fleet-quarter-year').selectOption(String(seededFiscalYear))
  await operations.locator('#fleet-quarter-number').selectOption(String(seededQuarter))
  const qualityCount = Number((await operations.locator('.fleet-quarterly-quality strong').textContent())?.trim())
  assert.ok(qualityCount > 0, 'Historical attribution checks should be visible, not silently treated as clean approvals')
  const quarterFilter = operations.getByRole('group', { name: 'Quarterly reconciliation filter' })
  await quarterFilter.getByRole('button', { name: /Data checks \(/i }).click()
  const qualityToggles = operations.locator('.fleet-quarterly-reconcile tbody button[aria-expanded]')
  assert.ok(await qualityToggles.count() > 0, 'Quality-only filter did not show records requiring source review')
  await qualityToggles.first().click()
  const qualityDetails = operations.locator('.fleet-quality-issues')
  await qualityDetails.waitFor()
  assert.ok(await qualityDetails.locator('li').count() > 0, 'Expanded data-quality row lacks actionable issue explanations')
  assert.ok(await qualityDetails.getByText(/historical vehicle attribution|original department|approval/i).first().isVisible(), 'Missing source/attribution quality detail')
  const [qualityCsvDownload] = await Promise.all([
    operations.waitForEvent('download'),
    operations.getByRole('button', { name: /Download quarter review/i }).click(),
  ])
  const qualityCsv = await readFile(await qualityCsvDownload.path(), 'utf8')
  assert.match(qualityCsv, /Data-quality issues requiring review/i, 'Quarter staging CSV omitted quality-review column')
  assert.match(qualityCsv, /NEEDS DATA CHECK/i, 'Quarter staging CSV silently marked quality-flagged records complete')
  assert.match(qualityCsv, /historical vehicle attribution|original department|approval reviewer/i, 'Quarter staging CSV omitted source-quality issue details')
  await qualityDetails.getByRole('button', { name: /Inspect record/i }).first().click()
  await operations.locator('.fleet-history-ledger').waitFor()
  assert.ok(await operations.locator('.fleet-history-entry').count() > 0, 'Data-quality drilldown did not open the source report history')

  // An approved historical record with bad source evidence must be reopened
  // explicitly. Never mutate an approved snapshot in place or claim the
  // quarter is reconciled merely because the record was approved.
  const flaggedReportBefore = (await savedFleet(operations)).reports.find(report =>
    report.vehicleId === 'v004' && report.period === overduePeriod,
  )
  assert.equal(flaggedReportBefore?.status, 'Approved', 'The seeded data-quality scenario requires an approved historical report')
  await operations.getByRole('button', { name: /Quarterly review/i }).first().click()
  await operations.getByRole('group', { name: 'Quarterly reconciliation filter' }).getByRole('button', { name: /Data checks/i }).click()
  const qualityToggle = operations.locator('.fleet-quarterly-reconcile tbody button[aria-expanded]').first()
  if ((await qualityToggle.getAttribute('aria-expanded')) !== 'true') await qualityToggle.click()
  const correctionDetails = operations.locator('.fleet-quality-issues')
  await correctionDetails.getByRole('button', { name: /Request correction/i }).first().click()
  const correctionForm = operations.locator('.fleet-quarterly-correction-form')
  const reopenButton = correctionForm.getByRole('button', { name: /Reopen report for correction/i })
  assert.ok(await reopenButton.isDisabled(), 'Approved records must not reopen without a documented correction reason')
  await correctionForm.getByLabel('Reason for reopening approved record (required)').fill('Missing supervisor approval evidence. Request signed reviewer confirmation.')
  await reopenButton.click()
  operationsState = await savedFleet(operations)
  const flaggedReportAfter = operationsState.reports.find(report => report.id === flaggedReportBefore.id)
  assert.equal(flaggedReportAfter?.status, 'Returned', 'Approved report did not explicitly transition to Returned')
  assert.equal(flaggedReportAfter?.revision, flaggedReportBefore.revision, 'Administrative reopening should not invent a driver revision')
  assert.match(flaggedReportAfter?.reviewNote ?? '', /Missing supervisor approval evidence/, 'Correction reason not saved')
  const approvedSnapshots = operationsState.reportHistory.filter(entry => entry.reportId === flaggedReportBefore.id)
  assert.ok(approvedSnapshots.some(entry => entry.snapshot.status === 'Approved'), 'Approved snapshot was lost when reopening the record')
  assert.ok(approvedSnapshots.some(entry => entry.action === 'Reopened for correction' && entry.snapshot.status === 'Returned'), 'Correction request was not retained in report history')
  assert.ok(operationsState.audit.some(entry => /Approved report reopened for correction/i.test(entry.action)), 'Approved-record reopening not audited')
  assert.equal(await operations.locator('#fleet-report-vehicle').inputValue(), 'v004', 'Correction workflow did not open the affected driver record')
  await operations.getByRole('button', { name: /Quarterly review/i }).first().click()
  const qualityAfterCorrection = Number((await operations.locator('.fleet-quarterly-quality strong').textContent())?.trim())
  assert.ok(qualityAfterCorrection < qualityCount, 'Quarter quality counter did not acknowledge the reopened approved record')
  await operations.getByRole('group', { name: 'Quarterly reconciliation filter' }).getByRole('button', { name: /All units/i }).click()
  const reopenedQuarterRow = operations.locator('.fleet-quarterly-reconcile tbody tr').filter({ hasText: 'UTD-0477' })
  assert.ok(await reopenedQuarterRow.getByRole('button', {
    name: 'Returned for UTD-0477 in ' + overdueMonthName + '. Open workflow',
  }).isVisible(), 'Quarter reconciliation failed to show returned correction gap for the reopened month')

  await operations.reload({ waitUntil: 'domcontentloaded' })
  await operations.getByRole('heading', { name: 'Exceptions and reporting' }).waitFor()
  operationsState = await savedFleet(operations)
  assert.equal(operationsState.departmentProfiles.find(profile => profile.name === 'Facilities')?.coordinator, 'Demo Accountability Lead', 'Refreshing removed department edits')
  assert.equal(operationsState.vehicles.find(vehicle => vehicle.id === 'v006')?.status, 'In maintenance', 'Refreshing removed service hold')
  assert.equal(operationsState.tickets.find(item => item.id === 't003')?.status, 'Resolved', 'Refreshing removed maintenance resolution')
  assert.ok(operationsState.followUps.some(item =>
    item.vehicleId === 'v006' && item.period === overduePeriod &&
    item.status === 'Closed' && /Reached department coordinator/.test(item.outcome ?? '')
  ), 'Refreshing removed the completed local follow-up outcome')
  assert.deepEqual(operationsErrors, [], 'JavaScript errors occurred during operational workflows')
  await operations.close()

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const mobileErrors = []
  mobile.on('pageerror', error => mobileErrors.push(error.message))
  await mobile.goto(baseUrl + '/', { waitUntil: 'domcontentloaded' })
  await mobile.getByRole('heading', { name: 'Exceptions and reporting' }).waitFor()
  await assertViewportFits(mobile, 'Fleet dashboard at 390px')
  assert.ok(!(await mobile.locator('.fleet-overlay').isVisible()), 'Mobile drawer overlay shown before navigation opens')
  await mobile.locator('#fleet-role').selectOption('Driver')
  await mobile.locator('#fleet-report-vehicle').waitFor()
  const driverFirstFieldTop = await mobile.locator('#fleet-report-vehicle').evaluate(element => element.getBoundingClientRect().top)
  assert.ok(driverFirstFieldTop <= 760, 'Driver form begins too far below the fold at 390px: ' + driverFirstFieldTop + 'px')
  await assertViewportFits(mobile, 'Driver form at 390px')
  await mobile.locator('#fleet-role').selectOption('Fleet Admin')
  await mobile.getByRole('button', { name: /Open navigation/i }).click()
  await mobile.locator('.fleet-sidebar.is-open').getByRole('button', { name: /Quarterly review/i }).click()
  await mobile.getByRole('heading', { name: 'Three-month readiness' }).waitFor()
  await assertViewportFits(mobile, 'Quarter review at 390px')
  await mobile.getByRole('button', { name: /Open navigation/i }).click()
  await mobile.locator('.fleet-sidebar.is-open').waitFor({ state: 'visible', timeout: 4000 })
  await mobile.locator('a[href="/campus-map"]').first().click()
  await mobile.locator('.leaflet-container').waitFor()
  assert.ok(await mobile.locator('.leaflet-container').isVisible(), 'Navigating to preserved campus map failed')
  assert.deepEqual(mobileErrors, [], 'Mobile JavaScript errors occurred')
  await mobile.close()

  const narrow = await browser.newPage({ viewport: { width: 320, height: 740 }, isMobile: true, hasTouch: true })
  await narrow.goto(baseUrl + '/', { waitUntil: 'domcontentloaded' })
  await narrow.getByRole('heading', { name: 'Exceptions and reporting' }).waitFor()
  assert.equal(await narrow.locator('.fleet-ops-summary__item').count(), 6, 'Mobile summary lost operational metrics')
  const mobileColumns = await narrow.locator('.fleet-ops-summary').evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length)
  assert.equal(mobileColumns, 2, 'Narrow phone metrics should render in two columns')
  await narrow.locator('#fleet-role').selectOption('Driver')
  await narrow.locator('#fleet-report-vehicle').waitFor()
  await assertViewportFits(narrow, 'Driver reporting screen at 320px')
  const touchHeight = await narrow.locator('#fleet-report-vehicle').evaluate(element => element.getBoundingClientRect().height)
  assert.ok(touchHeight >= 44, 'Driver vehicle picker is shorter than a 44px touch target: ' + touchHeight)
  await narrow.locator('#fleet-role').selectOption('Fleet Admin')
  await narrow.getByRole('button', { name: 'Open navigation' }).click()
  await narrow.locator('.fleet-sidebar.is-open').getByRole('button', { name: /Quarterly review/i }).click()
  await narrow.getByRole('heading', { name: 'Three-month readiness' }).waitFor()
  await assertViewportFits(narrow, 'Quarterly review at 320px')
  const scrollTable = await narrow.locator('.fleet-quarterly-reconcile').evaluate(table => {
    const wrap = table.closest('.fleet-table-wrap')
    return wrap && wrap.scrollWidth > wrap.clientWidth
  })
  assert.ok(scrollTable, 'Quarter reconciliation should scroll inside its table container on narrow screens')
  await narrow.getByRole('button', { name: 'Open navigation' }).click()
  await narrow.locator('.fleet-sidebar.is-open').locator('a[href="/campus-map"]').click()
  await narrow.locator('.leaflet-container').waitFor()
  assert.ok(await narrow.locator('.leaflet-container').isVisible(), 'Preserved campus map did not render on 320px phone')
  await narrow.close()

  console.log('FleetSync browser smoke passed: driver, supervisor, overdue follow-up, department and vehicle edits, service hold/resolution, quarterly and monthly staging CSV, persistence, reset, 320px accessibility, and original campus-map navigation.')
} finally {
  await browser?.close()
  await new Promise((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()))
}
