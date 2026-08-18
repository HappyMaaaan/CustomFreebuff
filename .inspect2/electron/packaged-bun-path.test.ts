import { expect, test } from 'bun:test'
import { basename, join } from 'node:path'

const { packagedBunPath } = require('./packaged-bun-path.cjs')

test('launches the staged Windows baseline binary when present', () => {
  const resources = join('test-app', 'resources')
  const result = packagedBunPath(
    resources,
    'win32',
    (candidate: string) => basename(candidate) === 'bun-baseline.exe',
  )

  expect(result).toBe(join(resources, 'bun', 'bun-baseline.exe'))
})

test('falls back to the standard packaged Bun on every platform', () => {
  const resources = join('test-app', 'resources')

  expect(packagedBunPath(resources, 'win32', () => false)).toBe(
    join(resources, 'bun', 'bun.exe'),
  )
  expect(packagedBunPath(resources, 'darwin', () => false)).toBe(
    join(resources, 'bun', 'bun'),
  )
})
