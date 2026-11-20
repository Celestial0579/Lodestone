/**
 * A probe for #116: which ssh-keygen does Git start on the Windows runner, and
 * what do the Cygwin-style links look like to Node. It only reports
 * (t.diagnostic) and cannot fail.
 */
import { describe, it } from 'node:test'
import { spawnSync } from 'child_process'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  writeFileSync,
} from 'fs'
import { join } from 'path'
import { exec } from 'dugite'
import { createTempDirectory } from '../../helpers/temp'

const run = (file: string, args: string[], cwd: string, env = {}) => {
  const r = spawnSync(file, args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    timeout: 60000,
  })
  return `rc=${r.status} out=${(r.stdout ?? '').trim().slice(0, 400)} err=${(
    r.stderr ?? ''
  )
    .trim()
    .slice(0, 400)} error=${r.error?.message ?? ''}`
}

describe('ssh-keygen probe (windows only, reports only)', () => {
  it('reports', async t => {
    if (process.platform !== 'win32') {
      return t.skip('Windows only')
    }

    try {
      const dir = await createTempDirectory(t)
      const say = (m: string) => t.diagnostic(`PROBE ${m}`)

      say(
        `PATH entries with git/openssh/msys/cygwin: ${(process.env.PATH ?? '')
          .split(';')
          .filter(p => /git|openssh|msys|cygwin/i.test(p))
          .join(' | ')}`
      )
      say(
        `where ssh-keygen: ${run(
          'cmd.exe',
          ['/d', '/c', 'where ssh-keygen'],
          dir
        )}`
      )

      const gitUsrBin = 'C:\\Program Files\\Git\\usr\\bin'
      say(
        `git usr\\bin exists=${existsSync(gitUsrBin)} ssh-keygen=${existsSync(
          join(gitUsrBin, 'ssh-keygen.exe')
        )} ln=${existsSync(join(gitUsrBin, 'ln.exe'))}`
      )
      const win = 'C:\\Windows\\System32\\OpenSSH\\ssh-keygen.exe'
      say(`windows openssh exists=${existsSync(win)}`)

      // The git the app uses (dugite) and what it starts for ssh signing.
      const repo = join(dir, 'repo')
      mkdirSync(repo)
      const key = join(dir, 'key')
      const gen = existsSync(win) ? win : join(gitUsrBin, 'ssh-keygen.exe')
      say(
        `keygen: ${run(gen, ['-t', 'ed25519', '-N', '', '-f', key, '-q'], dir)}`
      )
      await exec(['init', '-q', '-b', 'main'], repo)
      await exec(['config', 'user.name', 't'], repo)
      await exec(['config', 'user.email', 't@example.com'], repo)
      await exec(['config', 'gpg.format', 'ssh'], repo)
      await exec(['config', 'user.signingkey', key.replace(/\\/g, '/')], repo)
      await exec(['config', 'commit.gpgsign', 'true'], repo)
      writeFileSync(join(repo, 'a.txt'), 'a\n')
      await exec(['add', '.'], repo)
      const c = await exec(['commit', '-q', '-m', 'x'], repo, {
        env: { GIT_TRACE: '1' },
      })
      const lines = `${c.stderr}\n${c.stdout}`
        .split(/\r?\n/)
        .filter(l => /ssh-keygen|run_command|gpg/i.test(l))
        .slice(0, 8)
      say(`commit -S rc=${c.exitCode} trace=${lines.join(' || ')}`)
      const v = await exec(['--version'], repo)
      say(`dugite git: ${v.stdout.trim()}`)
      const ep = await exec(['--exec-path'], repo)
      say(`exec-path: ${ep.stdout.trim()}`)

      // Cygwin-style links made by the runner's MSYS2 ln.
      const ln = join(gitUsrBin, 'ln.exe')
      if (existsSync(ln)) {
        const target = join(dir, 'real')
        mkdirSync(target)
        writeFileSync(join(target, 'key'), 'x')
        for (const mode of ['sys', 'lnk', 'native']) {
          const link = join(dir, `lnk-${mode}`)
          const out = run(
            ln,
            ['-s', target.replace(/\\/g, '/'), link.replace(/\\/g, '/')],
            dir,
            { MSYS: `winsymlinks:${mode}` }
          )
          let kind = 'missing'
          let attrs = ''
          try {
            const s = lstatSync(link)
            kind = s.isSymbolicLink()
              ? 'symlink'
              : s.isDirectory()
              ? 'dir'
              : s.isFile()
              ? 'file'
              : 'other'
          } catch {
            kind = 'lstat-error'
          }
          const lnkFile = existsSync(`${link}.lnk`)
          const via = run(
            join(gitUsrBin, 'ls.exe'),
            [`${link.replace(/\\/g, '/')}/key`],
            dir
          )
          attrs = run('cmd.exe', ['/d', '/c', `attrib "${link}"`], dir)
          say(
            `ln mode=${mode}: ${out} | lstat=${kind} | .lnk next to it=${lnkFile} | ls via link: ${via} | attrib: ${attrs}`
          )
          say(`dir entries: ${readdirSync(dir).join(', ')}`)
        }
      }
    } catch (e) {
      t.diagnostic(`PROBE error: ${String(e)}`)
    }
  })
})
