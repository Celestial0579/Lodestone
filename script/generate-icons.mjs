/**
 * Regenerates every icon asset from a single SVG.
 *
 *   npx electron script/generate-icons.mjs
 *
 * It has to run under Electron because there is no image library in the
 * dependency tree: Chromium rasterises the SVG and we pack the results into the
 * container formats ourselves. Both .ico and .icns are thin wrappers around PNG
 * data on anything newer than Vista and Snow Leopard, and the installer splash
 * needs a GIF, which we encode here too.
 *
 * Outputs, per release channel (prod and dev):
 *   app/static/logos/<channel>/icon-logo.ico
 *   app/static/logos/<channel>/icon-logo-legacy.icns
 *   app/static/logos/<channel>/icon-logo.icon/  (macOS 26 Icon Composer source)
 * and, once:
 *   app/static/logos/win32-installer-splash.gif
 *   app/static/linux/icon-logo.png
 *   app/static/common/logo-64x64@2x.png
 *   app/static/common/windows-logo-64x64@2x.png
 */

import { app, BrowserWindow } from 'electron'
import { readFileSync, writeFileSync, mkdirSync, rmSync, unlinkSync } from 'fs'
import { join, dirname } from 'path'
import { tmpdir } from 'os'
import { fileURLToPath } from 'url'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const logosDir = join(projectRoot, 'app', 'static', 'logos')
const commonDir = join(projectRoot, 'app', 'static', 'common')

const markSvg = readFileSync(
  join(logosDir, 'lodestone-mark.svg'),
  'utf8'
).replace(/<\?xml[^>]*\?>/, '')

// Firestrike's palette: steel for the tile, ember and spark for the needle.
const PROD_TILE = '#212B33'
// The dev channel gets the ember tile so the two are told apart in the taskbar.
const DEV_TILE = '#B4551F'

const ICON_SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024]

// Chromium enforces a minimum window size on Windows, so everything is drawn
// into the corner of one large window and cropped out.
const CANVAS = 1024

// Staged outside the project so a concurrent build can't sweep it away.
const staging = join(tmpdir(), 'gitea-desktop-icon-staging')

function iconPage(size, tileColor) {
  const radius = Math.round(size * 0.18)
  // At taskbar sizes the padding eats the mark, so the small renders get a
  // tighter margin than the large ones.
  const small = size <= 48
  const inset = Math.round(size * (small ? 0.06 : 0.14))

  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html, body { margin: 0; padding: 0; background: transparent; }
  body { width: ${CANVAS}px; height: ${CANVAS}px; overflow: hidden; }
  .tile {
    position: absolute; top: 0; left: 0;
    width: ${size}px; height: ${size}px;
    background: ${tileColor};
    border-radius: ${radius}px;
  }
  .mark {
    position: absolute;
    top: ${inset}px; left: ${inset}px;
    width: ${size - inset * 2}px; height: ${size - inset * 2}px;
  }
  .mark svg { width: 100%; height: 100%; display: block; }
  ${small ? '.mark .detail { display: none; }' : ''}
</style></head>
<body><div class="tile"></div><div class="mark">${markSvg}</div></body></html>`
}

const SPLASH_SIZE = 400

function splashPage() {
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html, body { margin: 0; padding: 0; background: transparent; }
  body {
    width: ${SPLASH_SIZE}px; height: ${SPLASH_SIZE}px;
    background: #212B33;
    font-family: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif;
    color: #EFF0ED;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    text-align: center;
  }
  .mark { width: 128px; height: 128px; margin-bottom: 28px; }
  .mark svg { width: 100%; height: 100%; display: block; }
  h1 { font-size: 34px; font-weight: 400; margin: 0 0 18px; letter-spacing: 0.3px; }
  p { font-size: 14px; line-height: 1.6; margin: 0; color: #C9CCC6;
      font-family: system-ui, "Segoe UI", sans-serif; }
</style></head>
<body>
  <div class="mark">${markSvg}</div>
  <h1>Lodestone</h1>
  <p>Lodestone is being installed.<br>It will launch once it is done.</p>
</body></html>`
}

/** Render a page and return the top-left `size` square of it. */
async function capture(win, html, width, height) {
  const pagePath = join(staging, 'page.html')
  writeFileSync(pagePath, html, 'utf8')
  await win.loadFile(pagePath)

  // Give Chromium a frame to lay the SVG out before grabbing it.
  await new Promise(resolve => setTimeout(resolve, 200))

  return win.webContents.capturePage({ x: 0, y: 0, width, height })
}

/** ICONDIR, one ICONDIRENTRY per image, then the PNG payloads. */
function buildIco(pngs) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(pngs.length, 4)

  let offset = 6 + 16 * pngs.length
  const entries = []

  for (const { size, data } of pngs) {
    const entry = Buffer.alloc(16)
    entry.writeUInt8(size >= 256 ? 0 : size, 0) // width, 0 means 256
    entry.writeUInt8(size >= 256 ? 0 : size, 1) // height
    entry.writeUInt8(0, 2) // palette size
    entry.writeUInt8(0, 3) // reserved
    entry.writeUInt16LE(1, 4) // colour planes
    entry.writeUInt16LE(32, 6) // bits per pixel
    entry.writeUInt32LE(data.length, 8)
    entry.writeUInt32LE(offset, 12)
    entries.push(entry)
    offset += data.length
  }

  return Buffer.concat([header, ...entries, ...pngs.map(p => p.data)])
}

// The OSTypes that take a PNG payload, and the pixel size each expects.
const ICNS_TYPES = [
  ['ic07', 128],
  ['ic08', 256],
  ['ic09', 512],
  ['ic10', 1024],
  ['ic11', 32], // 16pt @2x
  ['ic12', 64], // 32pt @2x
  ['ic13', 256], // 128pt @2x
  ['ic14', 512], // 256pt @2x
]

/** 'icns' magic, total length, then length-prefixed typed chunks. */
function buildIcns(bySize) {
  const chunks = []

  for (const [ostype, size] of ICNS_TYPES) {
    const data = bySize.get(size)
    const head = Buffer.alloc(8)
    head.write(ostype, 0, 4, 'ascii')
    head.writeUInt32BE(data.length + 8, 4)
    chunks.push(head, data)
  }

  const body = Buffer.concat(chunks)
  const header = Buffer.alloc(8)
  header.write('icns', 0, 4, 'ascii')
  header.writeUInt32BE(body.length + 8, 4)

  return Buffer.concat([header, body])
}

/**
 * Encode BGRA pixels as a GIF: reduce to a 256 colour palette, then LZW the
 * indices.
 */
function buildGif(bgra, width, height) {
  const counts = new Map()
  const pixels = new Array(width * height)

  for (let i = 0, p = 0; i < bgra.length; i += 4, p++) {
    const key = (bgra[i + 2] << 16) | (bgra[i + 1] << 8) | bgra[i]
    pixels[p] = key
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  const palette = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 256)
    .map(([colour]) => colour)

  const indexOf = new Map(palette.map((colour, i) => [colour, i]))
  const nearestCache = new Map()

  const nearest = colour => {
    const cached = nearestCache.get(colour)
    if (cached !== undefined) {
      return cached
    }

    const r = (colour >> 16) & 0xff
    const g = (colour >> 8) & 0xff
    const b = colour & 0xff
    let best = 0
    let bestDist = Infinity

    for (let i = 0; i < palette.length; i++) {
      const pr = (palette[i] >> 16) & 0xff
      const pg = (palette[i] >> 8) & 0xff
      const pb = palette[i] & 0xff
      const dist = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2
      if (dist < bestDist) {
        best = i
        bestDist = dist
        if (dist === 0) {
          break
        }
      }
    }

    nearestCache.set(colour, best)
    return best
  }

  const indices = Uint8Array.from(pixels, p => indexOf.get(p) ?? nearest(p))

  const sizeBits = Math.max(1, 32 - Math.clz32(Math.max(1, palette.length - 1)))
  const paletteSize = 1 << sizeBits
  const minCodeSize = Math.max(2, sizeBits)

  const out = []
  let bitBuffer = 0
  let bitCount = 0

  const emit = (code, size) => {
    bitBuffer |= code << bitCount
    bitCount += size
    while (bitCount >= 8) {
      out.push(bitBuffer & 0xff)
      bitBuffer >>>= 8
      bitCount -= 8
    }
  }

  const clearCode = 1 << minCodeSize
  const endCode = clearCode + 1

  let table = new Map()
  let nextCode = endCode + 1
  let codeSize = minCodeSize + 1

  const resetTable = () => {
    table = new Map()
    for (let i = 0; i < clearCode; i++) {
      table.set(String.fromCharCode(i), i)
    }
    nextCode = endCode + 1
    codeSize = minCodeSize + 1
  }

  resetTable()
  emit(clearCode, codeSize)

  let current = ''
  for (const index of indices) {
    const candidate = current + String.fromCharCode(index)
    if (table.has(candidate)) {
      current = candidate
      continue
    }

    emit(table.get(current), codeSize)
    table.set(candidate, nextCode++)

    if (nextCode > 1 << codeSize) {
      if (codeSize < 12) {
        codeSize++
      } else {
        emit(clearCode, codeSize)
        resetTable()
      }
    }

    current = String.fromCharCode(index)
  }

  if (current !== '') {
    emit(table.get(current), codeSize)
  }

  emit(endCode, codeSize)

  if (bitCount > 0) {
    out.push(bitBuffer & 0xff)
  }

  const parts = [Buffer.from('GIF89a', 'ascii')]

  const screen = Buffer.alloc(7)
  screen.writeUInt16LE(width, 0)
  screen.writeUInt16LE(height, 2)
  screen.writeUInt8(0xf0 | (sizeBits - 1), 4) // global colour table + its size
  screen.writeUInt8(0, 5) // background colour index
  screen.writeUInt8(0, 6) // square pixels
  parts.push(screen)

  const table3 = Buffer.alloc(paletteSize * 3)
  palette.forEach((colour, i) => {
    table3.writeUInt8((colour >> 16) & 0xff, i * 3)
    table3.writeUInt8((colour >> 8) & 0xff, i * 3 + 1)
    table3.writeUInt8(colour & 0xff, i * 3 + 2)
  })
  parts.push(table3)

  const descriptor = Buffer.alloc(11)
  descriptor.writeUInt8(0x2c, 0)
  descriptor.writeUInt16LE(0, 1)
  descriptor.writeUInt16LE(0, 3)
  descriptor.writeUInt16LE(width, 5)
  descriptor.writeUInt16LE(height, 7)
  descriptor.writeUInt8(0, 9) // no local table, not interlaced
  descriptor.writeUInt8(minCodeSize, 10)
  parts.push(descriptor)

  const compressed = Buffer.from(out)
  for (let start = 0; start < compressed.length; start += 255) {
    const block = compressed.subarray(start, start + 255)
    parts.push(Buffer.from([block.length]), block)
  }

  parts.push(Buffer.from([0x00, 0x3b])) // block terminator, trailer

  return Buffer.concat(parts)
}

/**
 * The macOS 26 icon bundle: a JSON description plus SVG layers. The foreground
 * layer is filled with a flat colour, so the artwork acts as a silhouette. Only
 * the body of the mark goes in; the teabag is white in the original and would
 * otherwise merge into the rest of the shape.
 */
function writeIconBundle(channel, gradient) {
  // The foreground layer is filled with a flat colour by the renderer, so the
  // artwork acts as a silhouette. The needle alone carries the shape; the
  // bearing ring and the pivot would only muddy it at this size.
  const needle = [...markSvg.matchAll(/<path d="(M320 (?:96|544)[^"]+)"/g)].map(
    m => m[1]
  )

  if (needle.length !== 2) {
    throw new Error(
      `expected both needle halves in the mark, found ${needle.length}`
    )
  }

  const scale = 1.15
  const offset = (1024 - 640 * scale) / 2
  const paths = needle
    .map(d => `    <path d="${d}" fill="white"/>`)
    .join('\n')

  const layer = `<svg width="1024" height="1024" viewBox="0 0 1024 1024" fill="none" xmlns="http://www.w3.org/2000/svg">
  <g transform="translate(${offset},${offset}) scale(${scale})">
${paths}
  </g>
</svg>
`

  const bundle = join(logosDir, channel, 'icon-logo.icon')
  const assets = join(bundle, 'Assets')

  rmSync(assets, { recursive: true, force: true })
  mkdirSync(assets, { recursive: true })
  writeFileSync(join(assets, 'lodestone.svg'), layer, 'utf8')

  const icon = {
    fill: {
      'linear-gradient': gradient,
      orientation: { start: { x: 0.5, y: 0 }, stop: { x: 0.5, y: 0.7 } },
    },
    groups: [
      {
        layers: [
          {
            'fill-specializations': [
              { value: { solid: 'srgb:1.00000,1.00000,1.00000,1.00000' } },
              {
                appearance: 'dark',
                value: { solid: 'srgb:1.00000,1.00000,1.00000,1.00000' },
              },
            ],
            'image-name': 'lodestone.svg',
            name: 'lodestone',
          },
        ],
        name: 'foreground',
        shadow: { kind: 'neutral', opacity: 0.5 },
        translucency: { enabled: true, value: 0.5 },
      },
    ],
    'supported-platforms': { circles: ['watchOS'], squares: 'shared' },
  }

  writeFileSync(
    join(bundle, 'icon.json'),
    JSON.stringify(icon, null, 2) + '\n',
    'utf8'
  )
}

app.disableHardwareAcceleration()
app.commandLine.appendSwitch('force-device-scale-factor', '1')
// ClearType puts colour fringes on the splash text, which both looks wrong on a
// flat design and burns through the colours a GIF palette has.
app.commandLine.appendSwitch('disable-lcd-text')

app.whenReady().then(run).catch(err => {
  // Without this an exception leaves the Electron process alive with no window
  // and no message, which looks exactly like a hang.
  console.error(err)
  app.exit(1)
})

async function run() {
  mkdirSync(staging, { recursive: true })

  const win = new BrowserWindow({
    width: CANVAS,
    height: CANVAS,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    useContentSize: true,
  })

  for (const [channel, tile, gradient] of [
    // steel for the release channel, ember for the dev channel
    [
      'prod',
      PROD_TILE,
      [
        'srgb:0.20000,0.25500,0.29400,1.00000',
        'srgb:0.12900,0.16900,0.20000,1.00000',
      ],
    ],
    [
      'dev',
      DEV_TILE,
      [
        'srgb:0.90600,0.63900,0.23900,1.00000',
        'srgb:0.70600,0.33300,0.12200,1.00000',
      ],
    ],
  ]) {
    const bySize = new Map()

    for (const size of ICON_SIZES) {
      const image = await capture(win, iconPage(size, tile), size, size)
      bySize.set(size, image.toPNG())
    }

    const icoSizes = [16, 24, 32, 48, 64, 128, 256]
    writeFileSync(
      join(logosDir, channel, 'icon-logo.ico'),
      buildIco(icoSizes.map(size => ({ size, data: bySize.get(size) })))
    )
    writeFileSync(
      join(logosDir, channel, 'icon-logo-legacy.icns'),
      buildIcns(bySize)
    )
    writeIconBundle(channel, gradient)

    console.log(`${channel}: wrote icon-logo.ico, icon-logo-legacy.icns, icon-logo.icon`)

    if (channel === 'prod') {
      // The about dialog and the Linux window icon reuse the release artwork.
      writeFileSync(join(commonDir, 'logo-64x64@2x.png'), bySize.get(128))
      writeFileSync(join(commonDir, 'windows-logo-64x64@2x.png'), bySize.get(128))
      writeFileSync(
        join(projectRoot, 'app', 'static', 'linux', 'icon-logo.png'),
        bySize.get(256)
      )
      console.log('prod: wrote about dialog and linux window icons')
    }
  }

  const splash = await capture(win, splashPage(), SPLASH_SIZE, SPLASH_SIZE)
  writeFileSync(
    join(logosDir, 'win32-installer-splash.gif'),
    buildGif(splash.toBitmap(), SPLASH_SIZE, SPLASH_SIZE)
  )
  console.log('wrote win32-installer-splash.gif')

  unlinkSync(join(staging, 'page.html'))
  win.destroy()
  app.quit()
}
