/**
 * A probe for #121: why did the excludesFile network case once report two
 * findings on the Windows runner? It repeats the sequence of that test and
 * reports (t.diagnostic) what the check finds at each step, with the
 * configuration Git sees. It cannot fail.
 */
import { describe, it } from 'node:test'
import { exec } from 'dugite'
import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { createTempDirectory } from '../../helpers/temp'
import { findNetworkPaths } from '../../../src/lib/git/repository-trust-paths'

describe('excludesFile duplicate probe (reports only)', () => {
  it('reports', async t => {
    try {
      const path = await createTempDirectory(t)
      const say = (m: string) => t.diagnostic(`PROBE ${m}`)
      await exec(['init', '-q', '-b', 'main'], path)
      const cfg = async (label: string) => {
        const list = await exec(
          ['config', '--local', '--list', '--show-origin', '-z'],
          path
        )
        say(`${label}: found=${JSON.stringify(await findNetworkPaths(path))}`)
        say(
          `${label}: config=${JSON.stringify(
            list.stdout.split('\0').filter(Boolean).slice(-6)
          )}`
        )
      }

      say(`path=${path}`)
      await cfg('fresh')
      const a = await exec(
        ['config', 'include.path', '//host/share/x.inc'],
        path
      )
      say(`set include.path rc=${a.exitCode} err=${a.stderr.trim()}`)
      await cfg('after include.path')
      const u = await exec(['config', '--unset', 'include.path'], path)
      say(`unset include.path rc=${u.exitCode} err=${u.stderr.trim()}`)
      await cfg('after unset')
      const e = await exec(
        ['config', 'core.excludesFile', '\\\\host\\share\\ignore'],
        path
      )
      say(`set excludesFile rc=${e.exitCode} err=${e.stderr.trim()}`)
      await cfg('after excludesFile')
      const u2 = await exec(['config', '--unset', 'core.excludesFile'], path)
      say(`unset excludesFile rc=${u2.exitCode}`)
      await cfg('after unset excludesFile')
      await mkdir(join(path, '.git', 'objects', 'info'), { recursive: true })
      await writeFile(
        join(path, '.git', 'objects', 'info', 'alternates'),
        '//host/share/objects\n'
      )
      await cfg('with alternates')

      // The same without the earlier steps.
      const clean = await createTempDirectory(t)
      await exec(['init', '-q', '-b', 'main'], clean)
      await exec(
        ['config', 'core.excludesFile', '\\\\host\\share\\ignore'],
        clean
      )
      say(
        `clean excludesFile only: found=${JSON.stringify(
          await findNetworkPaths(clean)
        )}`
      )
      say(
        `clean config text: ${JSON.stringify(
          (await exec(['config', '--local', '--list', '--show-origin'], clean))
            .stdout
        )}`
      )
    } catch (e) {
      t.diagnostic(`PROBE error: ${String(e)}`)
    }
  })
})
