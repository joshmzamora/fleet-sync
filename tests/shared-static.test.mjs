import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createFleetServer } from '../server/app.mjs'

test('the authenticated local server serves only built FleetSync and campus-map assets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fleetsync-built-static-'))
  const distDir = join(root, 'dist')
  const api = createFleetServer({ dbPath: join(root, 'data', 'shared.sqlite'), distDir, port: 0 })
  try {
    await mkdir(join(distDir, 'assets'), { recursive: true })
    await writeFile(join(distDir, 'index.html'), '<!doctype html><title>FleetSync local server</title>')
    await writeFile(join(distDir, 'assets', 'app.js'), 'console.log("FleetSync")')
    const { origin } = await api.listen()
    for (const path of ['/', '/campus-map', '/campus-map/']) {
      const res = await fetch(origin + path)
      assert.equal(res.status, 200, path + ' did not serve the app')
      assert.match(await res.text(), /FleetSync local server/)
      assert.match(res.headers.get('content-type'), /text\/html/)
    }
    const asset = await fetch(origin + '/assets/app.js')
    assert.equal(asset.status, 200)
    assert.match(asset.headers.get('content-type'), /javascript/)
    assert.match(await asset.text(), /console.log/)
    const head = await fetch(origin + '/assets/app.js', { method: 'HEAD' })
    assert.equal(head.status, 200)
    assert.equal(await head.text(), '')
    const health = await fetch(origin + '/api/health')
    assert.equal(health.status, 200)
    assert.equal((await health.json()).shared, true)
    for (const path of ['/server/storage.mjs', '/package.json', '/.local-data/fleetsync.sqlite', '/unknown', '/assets/not-here.js']) {
      const missing = await fetch(origin + path)
      assert.equal(missing.status, 404, path + ' unexpectedly exposed an application-private file')
    }
  } finally {
    await api.close()
    await rm(root, { recursive: true, force: true })
  }
})
