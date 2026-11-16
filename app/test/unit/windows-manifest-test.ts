import { describe, it } from 'node:test'
import assert from 'node:assert'
import { readFileSync } from 'fs'
import * as Path from 'path'

describe('the Windows manifest', () => {
  const manifest = readFileSync(
    Path.join(
      __dirname,
      '..',
      '..',
      '..',
      'script',
      'windows',
      'lodestone.manifest'
    ),
    'utf8'
  )

  it('runs as the invoking user, never elevated', () => {
    assert.match(manifest, /requestedExecutionLevel level="asInvoker"/)
    assert.doesNotMatch(manifest, /requireAdministrator|highestAvailable/)
  })

  it('supports long paths and keeps the DPI awareness', () => {
    assert.match(manifest, /<longPathAware [^>]*>true<\/longPathAware>/)
    assert.match(manifest, /<dpiAware [^>]*>true\/pm<\/dpiAware>/)
  })

  it('names Windows 10 and 11', () => {
    assert.match(manifest, /8e0f7a12-bfb3-4fe8-b9a5-48fd50a15a9a/)
  })
})
