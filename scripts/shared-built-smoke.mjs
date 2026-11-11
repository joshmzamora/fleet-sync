import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { chromium } from 'playwright'
import { createFleetServer } from '../server/app.mjs'

// Use after npm run build. Verifies a single locally hosted production
// FleetSync instance can serve its UI, authenticate, and preserve /campus-map.
const folder = await mkdtemp(join(tmpdir(), 'fleetsync-built-browser-'))
const app = createFleetServer({ dbPath: join(folder, 'fleet.sqlite'), port: 0 })
let browser
try {
  app.provisionUser({
    username: 'built-driver', password: 'IsolatedBuildTest-2026!',
    displayName: 'Built Server Driver', role: 'Driver', department: 'Facilities',
  })
  const { origin } = await app.listen()
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true })
  const page = await browser.newPage({ viewport: { width: 1365, height: 800 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const response = await page.goto(origin + '/', { waitUntil: 'domcontentloaded' })
  assert.equal(response.status(), 200)
  await page.locator('.fleet-app[data-mode="demo"]').waitFor()
  await page.locator('.fleet-shared-open').click()
  await page.locator('.fleet-auth-form').waitFor()
  await page.locator('#fleet-shared-username').fill('built-driver')
  await page.locator('#fleet-shared-password').fill('IsolatedBuildTest-2026!')
  await page.locator('.fleet-auth-form button[type=submit]').click()
  await page.locator('.fleet-app[data-mode="shared"][data-role="Driver"]').waitFor()
  await page.getByRole('heading', { name: 'My monthly report' }).waitFor()
  assert.equal(await page.locator('#fleet-role').count(), 0, 'Shared role must not be spoofable')
  assert.equal(await page.locator('.fleet-nav__item').filter({ hasText: 'Quarterly review' }).count(), 0)
  const directCampus = await page.goto(origin + '/campus-map', { waitUntil: 'domcontentloaded' })
  assert.equal(directCampus.status(), 200)
  await page.locator('.leaflet-container').waitFor()
  assert.deepEqual(errors, [], 'Built local server page emitted JavaScript errors')
  await page.close()
  console.log('Production built-server smoke passed: one local server, authenticated driver workspace and preserved campus map.')
} finally {
  await browser?.close()
  await app.close()
  await rm(folder, { recursive: true, force: true })
}
