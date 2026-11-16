import { describe, it } from 'node:test'
import assert from 'node:assert'
import * as Path from 'path'
import { getLogDirectory } from '../../../src/lib/logging/log-directory'

describe('getLogDirectory', () => {
  it('puts the logs in the local profile on Windows', () => {
    assert.equal(
      getLogDirectory('/u/Roaming/Lodestone', 'win32', '/u/Local'),
      Path.join('/u/Local', 'Lodestone', 'logs')
    )
  })

  it('keeps them in the user data folder elsewhere', () => {
    assert.equal(
      getLogDirectory('/home/a/.config/Lodestone', 'linux', '/tmp'),
      '/home/a/.config/Lodestone/logs'
    )
  })

  it('falls back to the user data folder without a usable local profile', () => {
    assert.equal(
      getLogDirectory('/u/Lodestone', 'win32', undefined),
      '/u/Lodestone/logs'
    )
    assert.equal(
      getLogDirectory('/u/Lodestone', 'win32', 'relative'),
      '/u/Lodestone/logs'
    )
  })
})
