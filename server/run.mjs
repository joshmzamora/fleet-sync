import { resolve } from 'node:path'
import { createFleetServer } from './app.mjs'

const port = Number(process.env.FLEETSYNC_PORT || '4317')
const path = resolve(process.env.FLEETSYNC_DB_PATH || '.local-data/fleetsync.sqlite')
const app = createFleetServer({ dbPath: path, host: '127.0.0.1', port })
const listening = await app.listen()
console.log('FleetSync local shared API:', listening.origin, '(loopback only)')
console.log('SQLite workspace:', path)
console.log('The shared workspace uses local development accounts, not UT Dallas authentication.')
async function shutdown() {
  await app.close()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
