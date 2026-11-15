// A repository on a forge, as far as the self-update sees one: the releases
// API of Gitea and Forgejo, and release downloads that redirect to where the
// file is stored, the way github.com hands them to its asset storage. Served
// over HTTPS on localhost, with a certificate the smoke test makes and trusts.
//
//   node release-server.js <port> <pfx> <passphrase> <folder> <version> <mode> <log file>
//
// The folder holds the files of the release. <mode> is what the release does:
//   good              everything as it should be
//   foreign-redirect  the download redirects to another host (127.0.0.1)
//   bad-sum           SHA256SUMS.txt lists a wrong sum for the package

const https = require('https')
const fs = require('fs')
const path = require('path')

const [port, pfx, passphrase, folder, version, mode, logFile] =
  process.argv.slice(2)
const note = line => fs.appendFileSync(logFile, `${line}\n`)
const origin = `https://localhost:${port}`
const repository = '/Celestial0579/Lodestone'
const downloads = `${repository}/releases/download/v${version}/`

const files = () =>
  fs.readdirSync(folder).filter(f => fs.statSync(path.join(folder, f)).isFile())

function sums() {
  const text = fs.readFileSync(path.join(folder, 'SHA256SUMS.txt'), 'utf8')
  return mode === 'bad-sum'
    ? text.replace(
        /^[0-9a-f]{64}(?=\s+Lodestone-.*-full\.nupkg)/m,
        '0'.repeat(64)
      )
    : text
}

function serve(req, res) {
  note(`${req.method} ${req.url}`)
  const url = new URL(req.url, origin)

  if (url.pathname === `/api/v1/repos${repository}/releases/latest`) {
    const body = {
      tag_name: `v${version}`,
      name: `Lodestone ${version}`,
      html_url: `${origin}${repository}/releases/tag/v${version}`,
      draft: false,
      prerelease: false,
      assets: files().map(name => ({
        name,
        browser_download_url: `${origin}${downloads}${name}`,
        size:
          name === 'SHA256SUMS.txt'
            ? Buffer.byteLength(sums())
            : fs.statSync(path.join(folder, name)).size,
      })),
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(body))
    return
  }

  if (url.pathname.startsWith(downloads)) {
    const name = url.pathname.slice(downloads.length)
    const host =
      mode === 'foreign-redirect' && name.endsWith('.nupkg')
        ? `https://127.0.0.1:${port}`
        : origin
    res.writeHead(302, { Location: `${host}/storage/${name}` })
    res.end()
    return
  }

  if (url.pathname.startsWith('/storage/')) {
    const name = path.basename(url.pathname)
    if (!files().includes(name)) {
      res.writeHead(404)
      res.end()
      return
    }
    res.writeHead(200, { 'Content-Type': 'application/octet-stream' })
    if (name === 'SHA256SUMS.txt') {
      res.end(sums())
    } else {
      fs.createReadStream(path.join(folder, name)).pipe(res)
    }
    return
  }

  res.writeHead(404)
  res.end()
}

// localhost may resolve to either loopback address. Both are served, and
// nothing else: never every interface.
for (const address of ['127.0.0.1', '::1']) {
  https
    .createServer({ pfx: fs.readFileSync(pfx), passphrase }, serve)
    .listen(Number(port), address, () =>
      note(`serving ${version} (${mode}) on ${address} port ${port}`)
    )
}
