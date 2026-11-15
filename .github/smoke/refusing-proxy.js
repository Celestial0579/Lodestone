// A proxy that lets nothing through and writes down what it was asked for.
//
// The smoke test starts the installed app with --proxy-server pointing here.
// Every HTTPS request Chromium makes then begins with a CONNECT naming the
// host, which this logs and refuses. The app's update check fails on that, and
// its log names the repository it was checking. Together the two say where the
// check goes, without the test talking to GitHub on the app's behalf.
//
//   node refusing-proxy.js <port> <log file>

const http = require('http')
const fs = require('fs')

const [port, logFile] = process.argv.slice(2)
const note = line => fs.appendFileSync(logFile, `${line}\n`)

const server = http.createServer((req, res) => {
  note(`${req.method} ${req.url}`)
  res.writeHead(403)
  res.end()
})

server.on('connect', (req, socket) => {
  note(`CONNECT ${req.url}`)
  socket.end('HTTP/1.1 403 Forbidden\r\n\r\n')
})

server.listen(Number(port), '127.0.0.1', () => note(`listening on ${port}`))
