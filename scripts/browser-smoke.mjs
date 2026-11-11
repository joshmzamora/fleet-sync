import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { preview } from 'vite'

// This small end-to-end check expects a production build first: npm run build.
// Use PLAYWRIGHT_CHANNEL=chromium if Chromium was installed via playwright install.
const server = await preview({ preview: { host: '127.0.0.1', port: 4179, strictPort: true } })
let browser

async function checkPageErrors(page, callback) {
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await callback()
  assert.deepEqual(errors, [], `Unexpected JavaScript errors: ${errors.join('; ')}`)
}

try {
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true })
  const desktop = await browser.newPage({ viewport: { width: 1365, height: 850 } })
  await checkPageErrors(desktop, async () => {
    await desktop.goto('http://127.0.0.1:4179/campus-map', { waitUntil: 'domcontentloaded' })
    await desktop.locator('.leaflet-container').waitFor()
    assert.ok(await desktop.locator('.leaflet-container').isVisible(), 'Interactive map missing')
    assert.ok(await desktop.getByRole('tab', { name: /Locations/ }).isVisible(), 'Locations tab missing')

    const search = desktop.locator('#campus-search')
    await search.fill('ECSW')
    await desktop.locator('.location-row', { hasText: 'Engineering and Computer Science West' }).first().click()
    assert.ok(await desktop.locator('.detail-panel').isVisible(), 'Selecting a search result did not open details')
    assert.ok(await desktop.locator('.detail-panel').getByText('Engineering and Computer Science West').isVisible())

    await desktop.getByRole('button', { name: 'Close location details' }).click()
    await desktop.getByRole('button', { name: /open room locator/i }).click()
    await desktop.locator('#room-lookup').fill('SCI 2.102')
    await desktop.locator('.room-dialog button[type=submit]').click()
    assert.ok(await desktop.locator('.room-result').getByText('Sciences Building').isVisible(), 'Room code lookup failed')
    await desktop.getByRole('button', { name: 'Close room locator' }).click()

    await desktop.getByRole('tab', { name: /Tours/ }).click()
    await desktop.getByRole('button', { name: /Start tour/ }).first().click()
    assert.ok(await desktop.locator('.tour-progress-card').isVisible(), 'Campus tour did not start')
    await desktop.getByRole('button', { name: /Next stop/ }).first().click()
    assert.ok(await desktop.getByText('STOP 2 OF').isVisible(), 'Tour did not advance')
    await desktop.getByRole('button', { name: 'End tour' }).click()
    await desktop.getByRole('button', { name: 'Close location details' }).click()

    await desktop.getByRole('button', { name: 'Get directions' }).click()
    assert.ok(await desktop.locator('#route-to').isVisible(), 'Wayfinding controls missing')
    await desktop.locator('#route-from').selectOption('su')
    await desktop.locator('#route-to').selectOption('sci')
    assert.ok(await desktop.locator('.directions-external').isVisible(), 'External navigation fallback missing')
    await desktop.getByRole('button', { name: 'Close directions' }).click()
  })
  await desktop.close()

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  await checkPageErrors(mobile, async () => {
    await mobile.goto('http://127.0.0.1:4179/campus-map', { waitUntil: 'domcontentloaded' })
    const mapBox = await mobile.locator('.leaflet-container').boundingBox()
    assert.ok(mapBox && mapBox.width >= 360, 'Map should fill phone width')
    const menu = mobile.getByRole('button', { name: /Open locations menu/ }).first()
    assert.ok(await menu.isVisible(), 'Phone menu button is missing')
    const buttonBox = await menu.boundingBox()
    assert.ok(buttonBox && buttonBox.width <= 55, 'Phone menu button should not cover the full header')
    await menu.click()
    assert.ok(await mobile.locator('.locations-sidebar').isVisible(), 'Mobile sidebar did not open')
    await mobile.getByRole('button', { name: 'Close locations menu' }).first().click()
  })
  await mobile.close()

  const narrow = await browser.newPage({ viewport: { width: 320, height: 740 }, isMobile: true, hasTouch: true })
  await checkPageErrors(narrow, async () => {
    await narrow.goto('http://127.0.0.1:4179/campus-map', { waitUntil: 'domcontentloaded' })
    const mapBox = await narrow.locator('.leaflet-container').boundingBox()
    assert.ok(mapBox && mapBox.width >= 300, 'Campus map should fill a 320px phone')
    const overflow = await narrow.evaluate(() => document.documentElement.scrollWidth - innerWidth)
    assert.ok(overflow <= 2, 'Campus map creates horizontal page overflow at 320px: ' + overflow)
    await narrow.getByRole('button', { name: /Open locations menu/ }).first().click()
    await narrow.locator('.locations-sidebar').waitFor()
    const search = narrow.locator('#campus-search')
    await search.fill('Student Union')
    assert.ok(await narrow.locator('.location-row', { hasText: 'Student Union' }).first().isVisible(), '320px map sidebar location search failed')
    await narrow.getByRole('button', { name: 'Close locations menu' }).first().click()
  })
  await narrow.close()
  console.log('Browser smoke checks passed: map, search, room lookup, tours, directions, 390px and 320px mobile layouts.')
} finally {
  await browser?.close()
  await new Promise((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()))
}
