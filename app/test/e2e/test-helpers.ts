/* eslint-disable no-sync */

import { execFileSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'

// The names have spaces and umlauts, as the folders of many users do (#49).
export const smokeRepoPath = path.join(
  os.tmpdir(),
  'Lodestone E2E Prüfung Müller',
  'Repository mit Leerzeichen'
)
export const smokeRepoName = path.basename(smokeRepoPath)
export const smokeRepoFileName = 'smoke-change.txt'

/**
 * A file deep in the repository, whose path is longer than the 260 characters
 * Windows allows without long path support (#49). It is in the first commit, so
 * that the changes list of the test stays the one file it was.
 */
export const longPathFileName = 'lange-datei.txt'
export const longPathDirectories = Array.from(
  { length: 14 },
  (_, i) => `Unterordner mit langem Namen ${i + 1}`
)

export const smokeRepoFileContents =
  'This file should appear in the changes list.'

export function ensureSmokeTestRepository() {
  fs.rmSync(smokeRepoPath, { recursive: true, force: true })
  fs.mkdirSync(smokeRepoPath, { recursive: true })

  runGit(['init'], smokeRepoPath)
  runGit(['config', 'user.name', 'Lodestone E2E'], smokeRepoPath)
  runGit(['config', 'user.email', 'lodestone-e2e@example.com'], smokeRepoPath)

  fs.writeFileSync(
    path.join(smokeRepoPath, 'README.md'),
    '# Lodestone Smoke Repo\n'
  )

  // Git for Windows needs this for a path of that length, as it does for any
  // repository that has one.
  runGit(['config', 'core.longpaths', 'true'], smokeRepoPath)

  const longDirectory = path.join(smokeRepoPath, ...longPathDirectories)
  fs.mkdirSync(longDirectory, { recursive: true })
  fs.writeFileSync(path.join(longDirectory, longPathFileName), 'long\n')

  runGit(['add', '.'], smokeRepoPath)
  runGit(['commit', '-m', 'Initial commit'], smokeRepoPath)

  fs.writeFileSync(
    path.join(smokeRepoPath, smokeRepoFileName),
    `${smokeRepoFileContents}\n`
  )
}

function runGit(args: ReadonlyArray<string>, cwd: string) {
  execFileSync('git', [...args], {
    cwd,
    stdio: 'ignore',
  })
}

function readGitOutput(args: ReadonlyArray<string>, cwd: string) {
  return execFileSync('git', [...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim()
}

export function getSmokeRepoStatus() {
  return readGitOutput(['status', '--short'], smokeRepoPath)
}

export function getSmokeRepoHeadMessage() {
  return readGitOutput(['log', '-1', '--pretty=%s'], smokeRepoPath)
}

export function getSmokeRepoHeadSha() {
  return readGitOutput(['rev-parse', 'HEAD'], smokeRepoPath)
}

export function getSmokeRepoCurrentBranch() {
  return readGitOutput(['branch', '--show-current'], smokeRepoPath)
}
