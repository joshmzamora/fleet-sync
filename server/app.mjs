import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { extname, relative, resolve, sep } from 'node:path'
import { FleetStore, validateImportedFleet, FleetConflictError } from './storage.mjs'
import { AccessError, applyAction, projectStateForUser } from './operations.mjs'

const MAX_JSON = 8 * 1024 * 1024
const COOKIE = 'fleet_session'
const PUBLIC_MIMES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.json': 'application/json; charset=utf-8',
}

function reject(status, error, code = 'REQUEST_ERROR') {
  const failure = new Error(error)
  failure.status = status
  failure.code = code
  return failure
}
function headers() {
  return {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, private',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Resource-Policy': 'same-origin',
  }
}
function send(res, status, value, extra = {}) {
  res.writeHead(status, { ...headers(), ...extra })
  res.end(JSON.stringify(value))
}
function cookieToken(req) {
  const cookies = String(req.headers.cookie ?? '').split(';')
  return cookies.map(cookie => cookie.trim()).find(cookie => cookie.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1) ?? null
}
function sessionCookie(token, expires, secure = false) {
  return COOKIE + '=' + token + '; Path=/; HttpOnly; SameSite=Strict' +
    (secure ? '; Secure' : '') + '; Max-Age=' + Math.max(0, Math.floor((expires - Date.now()) / 1000))
}
async function bodyJson(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_JSON) throw reject(413, 'Request is larger than the allowed local import size.')
    chunks.push(chunk)
  }
  if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
    throw reject(415, 'JSON Content-Type is required for shared actions.')
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) }
  catch { throw reject(400, 'Invalid JSON request body.') }
}
function requireUser(user) {
  if (!user) throw reject(401, 'Sign in to the shared workspace before accessing fleet records.', 'UNAUTHENTICATED')
  return user
}
function requireAdmin(user) {
  if (requireUser(user).role !== 'Fleet Admin') throw new AccessError('Only a shared fleet administrator can import fleet data.')
}
function validateMutationRequest(req) {
  if (req.headers['x-fleetsync-request'] !== '1') throw reject(403, 'Shared changes require a same-origin application request.', 'CSRF_CHECK_FAILED')
  const origin = req.headers.origin
  if (origin) {
    let parsed
    try { parsed = new URL(origin) } catch { throw reject(403, 'Invalid request origin.', 'CSRF_CHECK_FAILED') }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw reject(403, 'Invalid request origin.', 'CSRF_CHECK_FAILED')
    // This server intentionally binds to loopback. A Vite proxy can originate
    // on another loopback port, but an unrelated remote origin is rejected.
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)) {
      throw reject(403, 'Shared changes are only accepted from this local application.', 'CSRF_CHECK_FAILED')
    }
  }
}
function safeFingerprint(state) {
  return createHash('sha256').update(JSON.stringify(state)).digest('hex')
}
async function serveBuiltApp(req, res, pathname, distDir) {
  if (req.method !== 'GET' && req.method !== 'HEAD') throw reject(405, 'Only GET and HEAD are supported for the application.')
  let name
  try { name = decodeURIComponent(pathname) }
  catch { throw reject(400, 'Invalid file path.') }
  const index = name === '/' || name === '/campus-map' || name === '/campus-map/'
  const target = resolve(distDir, index ? 'index.html' : '.' + name)
  const relativePath = relative(distDir, target)
  if (relativePath === '..' || relativePath.startsWith('..' + sep) ||
      relativePath.split(/[\\/]/).some(segment => segment.startsWith('.')) ||
      (!index && !Object.prototype.hasOwnProperty.call(PUBLIC_MIMES, extname(target)))) {
    throw reject(404, 'Application file not found.')
  }
  try {
    const fileStat = await stat(target)
    if (!fileStat.isFile()) throw reject(404, 'Application file not found.')
    const content = await readFile(target)
    res.writeHead(200, {
      'Content-Type': PUBLIC_MIMES[extname(target)] || 'application/octet-stream',
      'Cache-Control': extname(target) === '.html' ? 'no-store' : 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Cross-Origin-Resource-Policy': 'same-origin',
    })
    res.end(req.method === 'HEAD' ? undefined : content)
  } catch (error) {
    if (error.code === 'ENOENT') throw reject(404, 'Build the app first with npm run build.')
    throw error
  }
}

/**
 * Startable real HTTP API. All ordinary mutations are role-checked domain
 * commands; the browser cannot POST arbitrary state or spoof the actor.
 * Loopback-only server, local dev accounts, no institutional auth claims.
 */
export function createFleetServer({ dbPath = resolve('.local-data/fleetsync.sqlite'), host = '127.0.0.1', port = 0, distDir = resolve('dist') } = {}) {
  if (!['127.0.0.1', '::1', 'localhost'].includes(host)) throw new Error('Shared FleetSync only binds to loopback. A reverse proxy/auth review is required for public hosting.')
  const store = new FleetStore(dbPath)
  // Import preview authorization lives only in this server process. A browser
  // must review the actual payload with an authenticated admin account first;
  // posting a self-computed hash cannot bypass the preview step.
  const importPreviews = new Map()
  const server = createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname
      if (!pathname.startsWith('/api/')) {
        await serveBuiltApp(req, res, pathname, resolve(distDir))
        return
      }
      const method = req.method ?? 'GET'
      if (!['GET', 'POST'].includes(method)) throw reject(405, 'HTTP method not supported.')
      if (method === 'POST') validateMutationRequest(req)
      const user = store.session(cookieToken(req))
      if (method === 'GET' && pathname === '/api/health') {
        send(res, 200, { shared: true, localOnly: true, schemaVersion: 1 })
        return
      }
      if (method === 'GET' && pathname === '/api/session') {
        send(res, 200, { user: user ?? null })
        return
      }
      if (method === 'POST' && pathname === '/api/login') {
        const body = await bodyJson(req)
        const result = store.login(body.username, body.password)
        if (!result) throw reject(401, 'Invalid username or password.', 'LOGIN_FAILED')
        send(res, 200, { user: result.user }, { 'Set-Cookie': sessionCookie(result.token, result.expires) })
        return
      }
      if (method === 'POST' && pathname === '/api/logout') {
        importPreviews.delete(cookieToken(req))
        store.logout(cookieToken(req))
        send(res, 200, { user: null }, { 'Set-Cookie': COOKIE + '=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0' })
        return
      }
      const actor = requireUser(user)
      if (method === 'GET' && pathname === '/api/state') {
        const { revision, state } = store.read()
        send(res, 200, { revision, state: projectStateForUser(state, actor) })
        return
      }
      if (method === 'POST' && pathname === '/api/actions') {
        const body = await bodyJson(req)
        const result = store.mutate(body.revision, state => applyAction(state, actor, body.type, body.payload))
        send(res, 200, { revision: result.revision, state: projectStateForUser(result.state, actor) })
        return
      }
      if (method === 'POST' && pathname === '/api/import/preview') {
        requireAdmin(actor)
        const body = await bodyJson(req)
        validateImportedFleet(body.state)
        const fleetPresent = store.fleetCount() > 0 || store.read().state.reports.length > 0
        const fingerprint = safeFingerprint(body.state)
        const sessionKey = cookieToken(req)
        if (!fleetPresent) importPreviews.set(sessionKey, {
          fingerprint, revision: store.revision(), expires: Date.now() + 5 * 60 * 1000,
        })
        else importPreviews.delete(sessionKey)
        send(res, 200, {
          allowed: !fleetPresent,
          reason: fleetPresent ? 'Shared fleet already has records. This import will not replace or merge them.' : 'Empty shared fleet. Import requires a second explicit confirmation.',
          fingerprint,
          counts: {
            vehicles: body.state.vehicles.length, reports: body.state.reports.length,
            tickets: body.state.tickets.length, followUps: body.state.followUps.length,
          },
        })
        return
      }
      if (method === 'POST' && pathname === '/api/import') {
        requireAdmin(actor)
        const body = await bodyJson(req)
        validateImportedFleet(body.state)
        if (body.fingerprint !== safeFingerprint(body.state)) throw reject(400, 'Import preview no longer matches the selected data.')
        if (store.fleetCount() > 0 || store.read().state.reports.length > 0) {
          throw reject(409, 'Shared workspace already contains records. Import cannot replace or merge them.', 'IMPORT_NOT_EMPTY')
        }
        const sessionKey = cookieToken(req)
        const preview = importPreviews.get(sessionKey)
        if (!preview || preview.expires < Date.now() || preview.fingerprint !== body.fingerprint || preview.revision !== body.revision) {
          throw reject(403, 'Preview this exact import in the current authenticated session before confirming it.', 'IMPORT_PREVIEW_REQUIRED')
        }
        const result = store.importFleet(body.revision, body.state, actor.displayName)
        importPreviews.delete(sessionKey)
        send(res, 200, { revision: result.revision, state: projectStateForUser(result.state, actor) })
        return
      }
      throw reject(404, 'Unknown API route.')
    } catch (error) {
      const status = error.status ?? (error instanceof FleetConflictError ? 409 : error instanceof AccessError ? 403 : 400)
      const message = status >= 500 ? 'Unexpected server error.' : String(error.message || 'Request failed.')
      send(res, status, {
        error: message,
        code: error.code ?? (status === 409 ? 'VERSION_CONFLICT' : status === 403 ? 'FORBIDDEN' : 'VALIDATION_ERROR'),
        ...(status === 409 ? { revision: error.revision ?? store.revision() } : {}),
      })
    }
  })
  server.requestTimeout = 15000
  return {
    server, store,
    provisionUser: input => store.provisionUser(input),
    listen: () => new Promise((resolveListening, rejectListening) => {
      server.once('error', rejectListening)
      server.listen(port, host, () => {
        server.off('error', rejectListening)
        const address = server.address()
        resolveListening({ port: address.port, origin: 'http://' + (host === '::1' ? '[::1]' : host) + ':' + address.port })
      })
    }),
    close: () => new Promise((resolveClose, rejectClose) => {
      if (!server.listening) { store.close(); resolveClose(); return }
      server.close(error => {
        if (error) rejectClose(error)
        else { store.close(); resolveClose() }
      })
    }),
  }
}
