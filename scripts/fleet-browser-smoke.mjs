import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { preview } from 'vite'

// Run after npm run build. This exercises the real production UI without
// changing any user's browser state or calling external fleet services.
const server = await preview({ preview: { host: '127.0.0.1', port: 4193, strictPort: true } })
let browser

async function clearDemo(page) {
  await page.goto('http://127.0.0.1:4193/', { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => localStorage.clear())
  await page.reload({ waitUntil: 'domcontentloaded' })
}

try {
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true })
  const page = await browser.newPage({ viewport: { width: 1365, height: 900 }, acceptDownloads: true })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await clearDemo(page)
  await page.getByRole('heading', { name: 'Fleet overview' }).waitFor()
  assert.ok(await page.locator('.fleet-app').isVisible(), 'FleetSync dashboard failed to mount')
  assert.ok(!(await page.locator('.fleet-overlay').isVisible()), 'An inactive mobile overlay is covering the desktop application')
  assert.ok(await page.locator('a[href="/campus-map"]').count() > 0, 'The preserved campus map is not linked')

  await page.locator('#fleet-role').selectOption('Driver')
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

  await page.locator('#fleet-role').selectOption('Supervisor')
  const item = page.locator('.fleet-review-item').filter({ hasText: 'UTD-0220' })
  await item.waitFor()
  await item.locator('textarea').fill('Please confirm the warning and mileage.')
  await item.getByRole('button', { name: /Return for correction/i }).click()
  assert.equal(await page.locator('.fleet-review-item').filter({ hasText: 'UTD-0220' }).count(), 0, 'Returned report remained pending')

  await page.locator('#fleet-role').selectOption('Driver')
  await page.locator('#fleet-report-vehicle').selectOption('v006')
  assert.ok(await page.getByText(/Returned for correction/i).first().isVisible())
  await page.locator('#fleet-report-end').fill('111914')
  await page.locator('#fleet-report-operator').fill('Demo Test Driver')
  await page.locator('#fleet-report-notes').fill('Brake warning lamp confirmed. Vehicle awaiting service check.')
  await page.locator('.fleet-form').filter({ has: page.locator('#fleet-report-vehicle') }).locator('button[type=submit]').click()

  await page.locator('#fleet-role').selectOption('Supervisor')
  const resubmitted = page.locator('.fleet-review-item').filter({ hasText: 'UTD-0220' })
  await resubmitted.waitFor()
  await resubmitted.getByRole('button', { name: /Approve report/i }).click()

  await page.locator('#fleet-role').selectOption('Maintenance')
  const ticket = page.locator('.fleet-ticket').filter({ hasText: 'UTD-0220' }).filter({ hasText: 'Safety-critical condition reported' })
  await ticket.waitFor()
  assert.ok(await ticket.getByText('Safety-critical condition reported').isVisible(), 'Unsafe condition did not produce a maintenance ticket')
  await ticket.locator('select').selectOption('Scheduled')
  assert.ok(await page.locator('.fleet-ticket').filter({ hasText: 'Safety-critical condition reported' }).getByText('Scheduled').first().isVisible())

  await page.locator('#fleet-role').selectOption('Fleet Admin')
  await page.getByRole('button', { name: /Exports & audit/i }).first().click()
  await page.getByText('Review-only preparation, not a certified TxFS batch file').waitFor()
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /Download CSV/i }).first().click(),
  ])
  const csv = await readFile(await download.path(), 'utf8')
  assert.ok(csv.includes('UTD-0220'), 'Approved report missing from review export')
  assert.ok(!csv.includes('CART-'), 'Cart records should not appear in licensed-vehicle export')
  assert.ok(await page.getByText('Report approved').first().isVisible(), 'Approval missing from audit history')

  await page.reload()
  await page.getByRole('heading', { name: 'Fleet overview' }).waitFor()
  await page.getByRole('button', { name: /Exports & audit/i }).first().click()
  assert.ok(await page.getByText('UTD-0220').first().isVisible(), 'Browser refresh lost saved records')

  // Exercise the remaining admin/maintenance creation paths with an
  // additional fictional unit, then confirm Reset restores the seed.
  await page.getByRole('button', { name: 'Vehicles', exact: true }).first().click()
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
  await page.getByRole('button', { name: 'Vehicles', exact: true }).first().click()
  assert.equal(await page.locator('.fleet-vehicle-row').filter({ hasText: 'DEMO-1001' }).count(), 0, 'Reset failed to remove demo-created vehicle')

  assert.deepEqual(errors, [], 'JavaScript errors occurred during fleet workflows')
  await page.close()

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const mobileErrors = []
  mobile.on('pageerror', error => mobileErrors.push(error.message))
  await mobile.goto('http://127.0.0.1:4193/', { waitUntil: 'domcontentloaded' })
  await mobile.getByRole('heading', { name: 'Fleet overview' }).waitFor()
  const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - innerWidth)
  assert.ok(overflow <= 2, 'Fleet dashboard overflows a phone viewport horizontally: ' + overflow)
  assert.ok(!(await mobile.locator('.fleet-overlay').isVisible()), 'Mobile drawer overlay shown before navigation opens')
  await mobile.getByRole('button', { name: /Open navigation/i }).click()
  await mobile.locator('.fleet-sidebar.is-open').waitFor({ state: 'visible', timeout: 4000 })
  await mobile.locator('a[href="/campus-map"]').first().click()
  await mobile.locator('.leaflet-container').waitFor()
  assert.ok(await mobile.locator('.leaflet-container').isVisible(), 'Navigating to preserved campus map failed')
  assert.deepEqual(mobileErrors, [], 'Mobile JavaScript errors occurred')
  await mobile.close()

  const narrow = await browser.newPage({ viewport: { width: 320, height: 740 }, isMobile: true, hasTouch: true })
  await narrow.goto('http://127.0.0.1:4193/', { waitUntil: 'domcontentloaded' })
  await narrow.getByRole('heading', { name: 'Fleet overview' }).waitFor()
  await narrow.locator('#fleet-role').selectOption('Driver')
  await narrow.locator('#fleet-report-vehicle').waitFor()
  const narrowOverflow = await narrow.evaluate(() => document.documentElement.scrollWidth - innerWidth)
  assert.ok(narrowOverflow <= 2, 'Driver reporting screen overflows 320px: ' + narrowOverflow)
  await narrow.close()

  console.log('FleetSync browser smoke passed: driver, return/resubmit, supervisor approval, vehicle creation, maintenance, CSV, persistence, reset, 320px usability, and campus-map mobile navigation.')
} finally {
  await browser?.close()
  await new Promise((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()))
}
