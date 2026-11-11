import test from 'node:test'
import assert from 'node:assert/strict'
import { locations } from '../src/data/campus.ts'

const allowedCategories = new Set([
  'Academic & Administrative', 'Construction', 'Dining', 'Housing', 'Landmarks',
  'Parking & Transportation', 'Services', 'Skybridge', 'Sports Facilities',
])

test('campus points have unique stable identifiers and known categories', () => {
  assert.ok(locations.length >= 60, 'Expected a usable campus location directory')
  const ids = locations.map(location => location.id)
  assert.equal(new Set(ids).size, ids.length, 'Duplicate campus location ID')
  for (const location of locations) {
    assert.ok(location.id && location.name, 'Empty campus location identity')
    assert.ok(allowedCategories.has(location.category), `Unknown category: ${location.category}`)
  }
})

test('every location resolves to a plausible map point near the university', () => {
  for (const location of locations) {
    assert.ok(Number.isFinite(location.lat) && Number.isFinite(location.lng), `Invalid coordinates for ${location.name}`)
    assert.ok(location.lat > 32.98 && location.lat < 33, `Latitude outside campus area: ${location.name}`)
    assert.ok(location.lng > -96.76 && location.lng < -96.74, `Longitude outside campus area: ${location.name}`)
  }
})

test('building codes are unique and major campus destinations are searchable', () => {
  const codes = locations.map(location => location.code).filter(Boolean)
  assert.equal(new Set(codes).size, codes.length, 'Duplicate building code')
  for (const code of ['SU', 'ECSW', 'ECSN', 'ECSS', 'JO', 'MC', 'SCI', 'JSOM', 'VCB', 'RHS', 'PS3']) {
    assert.ok(codes.includes(code), `Missing core building code ${code}`)
  }
})
