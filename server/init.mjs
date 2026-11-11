import { resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import { FleetStore } from './storage.mjs'

const path = resolve(process.env.FLEETSYNC_DB_PATH || '.local-data/fleetsync.sqlite')
const users = [
  { username: 'fleet-admin', displayName: 'Demo Fleet Administrator', role: 'Fleet Admin' },
  { username: 'facilities-driver', displayName: 'Demo Facilities Driver', role: 'Driver', department: 'Facilities' },
  { username: 'facilities-supervisor', displayName: 'Demo Facilities Supervisor', role: 'Supervisor', department: 'Facilities' },
  { username: 'housing-supervisor', displayName: 'Demo Housing Supervisor', role: 'Supervisor', department: 'Housing' },
  { username: 'fleet-maintenance', displayName: 'Demo Maintenance Technician', role: 'Maintenance' },
]
const store = new FleetStore(path)
try {
  console.log('Local development account setup for', path)
  console.log('Save the following generated passwords in a password manager. They are not written to the repository.')
  for (const info of users) {
    const exists = store.db.prepare('SELECT id FROM users WHERE username = ?').get(info.username)
    if (exists) {
      console.log(info.username + ': already exists (password unchanged)')
      continue
    }
    const password = randomBytes(18).toString('base64url')
    store.provisionUser({ ...info, password })
    console.log(info.username + ': ' + password)
  }
} finally {
  store.close()
}
