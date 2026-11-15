// Starts the installed app, points its update source at the local release
// server, and waits for what the self-update makes of the release there.
//
//   node self-update.js <playwright-core folder> <exe> <source> <expect> <version> <log folder>
//
// <expect> is "updated" (Squirrel installed <version>) or a piece of the
// line the app logs when it refuses the release. Exits 0 when that came true.

const path = require('path')
const fs = require('fs')

const [playwright, exe, source, expect, version, logs] = process.argv.slice(2)
const { _electron } = require(path.join(
  playwright,
  'node_modules',
  'playwright-core'
))

const versionFolder = path.join(path.dirname(exe), '..', `app-${version}`)

const logText = () =>
  fs.existsSync(logs)
    ? fs
        .readdirSync(logs)
        .filter(f => f.endsWith('.log'))
        .map(f => fs.readFileSync(path.join(logs, f), 'utf8'))
        .join('\n')
    : ''

const updateLines = () =>
  logText()
    .split('\n')
    .filter(l => l.includes('[updates]'))

async function main() {
  const before = updateLines().length
  const app = await _electron.launch({ executablePath: exe })
  const window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')
  await window.evaluate(
    url => localStorage.setItem('gitea-update-source-url', url),
    source
  )
  // The check runs when the main window starts, so start it again.
  await window.reload()

  let outcome = null
  for (let i = 0; i < 150 && outcome === null; i++) {
    await new Promise(r => setTimeout(r, 2000))
    const lines = updateLines().slice(before)

    if (expect === 'updated') {
      if (lines.some(l => l.includes('Squirrel applied the update'))) {
        outcome = fs.existsSync(path.join(versionFolder, 'Lodestone.exe'))
      } else if (lines.some(l => /refused|could not|not updating/.test(l))) {
        outcome = false
      }
    } else if (lines.some(l => l.includes(expect))) {
      outcome = !fs.existsSync(versionFolder)
    } else if (lines.some(l => l.includes('handing it to Squirrel'))) {
      outcome = false
    }
  }

  console.log('--- update lines in the app log')
  console.log(updateLines().slice(before).join('\n'))
  console.log(`--- ${versionFolder}: ${fs.existsSync(versionFolder)}`)
  await app.close().catch(() => {})

  if (outcome !== true) {
    console.log(`expected ${expect}, which did not come true`)
    process.exit(1)
  }
  console.log(`as expected: ${expect}`)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
