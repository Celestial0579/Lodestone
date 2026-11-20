import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  getEffectiveExtension,
  isSafeToOpenExtension,
  isSafeToOpenFile,
} from '../../src/lib/file-open-policy'

describe('getEffectiveExtension', () => {
  it('reads the extension, in lower case, from a path with either separator', () => {
    assert.equal(getEffectiveExtension('C:\\repo\\Run.EXE'), '.exe')
    assert.equal(getEffectiveExtension('/repo/dir.d/run.Lnk'), '.lnk')
  })

  it('reads a name the way Windows does', () => {
    for (const name of ['run.exe.', 'run.exe..', 'run.exe ', 'run.exe. .']) {
      assert.equal(getEffectiveExtension(`C:\\repo\\${name}`), '.exe', name)
    }
  })

  it('takes the last extension of several', () => {
    assert.equal(getEffectiveExtension('C:\\repo\\a.txt.lnk'), '.lnk')
    assert.equal(getEffectiveExtension('C:\\repo\\a.lnk.txt'), '.txt')
  })

  it('has none for a name without a dot', () => {
    assert.equal(getEffectiveExtension('C:\\repo\\Makefile'), '')
    assert.equal(getEffectiveExtension('C:\\repo\\dir.d\\'), '')
    assert.equal(getEffectiveExtension(''), '')
  })
})

describe('isSafeToOpenFile on Windows', () => {
  it('refuses what Windows runs or starts a program with', () => {
    for (const ext of [
      '.exe',
      '.com',
      '.bat',
      '.cmd',
      '.scr',
      '.pif',
      '.cpl',
      '.msc',
      '.js',
      '.jse',
      '.vbs',
      '.vbe',
      '.wsf',
      '.wsh',
      '.hta',
      '.ps1',
      '.psm1',
      '.sh',
      '.jar',
      '.reg',
      '.inf',
      '.scf',
      '.lnk',
      '.url',
      '.website',
      '.appref-ms',
      '.application',
      '.xbap',
      '.msi',
      '.msp',
      '.mst',
      '.appx',
      '.msix',
      '.appinstaller',
      '.diagcab',
      '.settingcontent-ms',
      '.search-ms',
      '.library-ms',
      '.theme',
      '.themepack',
      '.rdp',
      '.chm',
    ]) {
      assert.equal(isSafeToOpenFile(`C:\\repo\\file${ext}`, true), false, ext)
    }
  })

  it('refuses them whatever the case and however Windows reads the name', () => {
    for (const name of [
      'README.LNK',
      'README.Hta',
      'run.exe.',
      'run.exe ',
      'dir.d\\inner.URL',
    ]) {
      assert.equal(isSafeToOpenFile(`C:\\repo\\${name}`, true), false, name)
    }
  })

  it('lets documents, images, text and source through', () => {
    for (const name of [
      'README.md',
      'notes.txt',
      'photo.PNG',
      'doc.pdf',
      'data.json',
      'main.ts',
      'style.css',
      'index.html',
      'Makefile',
      '.gitignore',
      'a.lnk.txt',
    ]) {
      assert.equal(isSafeToOpenFile(`C:\\repo\\${name}`, true), true, name)
    }
  })
})

describe('names that are all extension', () => {
  it('are read by the extension, as Windows does', () => {
    assert.equal(getEffectiveExtension('C:\\repo\\.bat'), '.bat')
    assert.equal(getEffectiveExtension('C:\\repo\\.gitignore'), '.gitignore')
  })

  it('are refused when the extension is on the list', () => {
    for (const name of ['.bat', '.HTA', '.lnk ', '.url.', '.exe', '.ps1']) {
      assert.equal(isSafeToOpenFile(`C:\\repo\\${name}`, true), false, name)
    }
  })

  it('are opened when it is not', () => {
    for (const name of ['.gitignore', '.editorconfig', '.env', '.eslintrc']) {
      assert.equal(isSafeToOpenFile(`C:\\repo\\${name}`, true), true, name)
    }
  })
})

describe('names with a colon on Windows', () => {
  it('are refused whatever the extension', () => {
    for (const name of [
      'a.txt:evil.vbs',
      'a.txt:stream',
      'run.exe::$DATA',
      'run.exe:stream:$DATA',
      'readme.md:x',
      'a:b',
    ]) {
      assert.equal(isSafeToOpenFile(`C:\\repo\\${name}`, true), false, name)
    }
  })

  it('are left alone elsewhere, where a colon is a plain character', () => {
    assert.equal(isSafeToOpenFile('/repo/a:b.txt', false), true)
  })
})

describe('the added types', () => {
  it('are refused', () => {
    for (const ext of [
      '.py',
      '.pyw',
      '.pyz',
      '.pyzw',
      '.rb',
      '.rbw',
      '.pl',
      '.wsc',
      '.sct',
      '.shb',
      '.shs',
      '.xll',
      '.xlam',
      '.ppam',
      '.ade',
      '.adp',
      '.mda',
      '.mdb',
      '.mde',
      '.mdt',
      '.mdw',
      '.mdz',
      '.ins',
      '.isp',
      '.its',
      '.mau',
      '.ops',
      '.pcd',
      '.prf',
      '.prg',
      '.vsmacros',
      '.vsw',
    ]) {
      assert.equal(isSafeToOpenFile(`C:\\repo\\file${ext}`, true), false, ext)
    }
  })
})

describe('isSafeToOpenFile elsewhere', () => {
  it('leaves the other systems as they were', () => {
    assert.equal(isSafeToOpenFile('/repo/run.sh', false), true)
    assert.equal(isSafeToOpenExtension('.lnk', false), true)
  })
})

/**
 * Microsoft's list of file types Outlook blocks, as read from
 * https://support.microsoft.com/en-us/office/blocked-attachments-in-outlook-434752e1-02d3-4e90-9124-8b81e49a8519
 * on 2026-11-20: 133 types, in the order of the page. Pinned verbatim: the
 * policy must hold every one of them.
 */
const MicrosoftOutlookBlockedList = `
.ade
.adp
.apk
.app
.appcontent-ms
.application
.appref-ms
.appx
.asp
.aspx
.asx
.bas
.bat
.bgi
.cab
.cdxml
.cer
.chm
.cmd
.cnt
.com
.cpl
.crt
.csh
.der
.diagcab
.exe
.fxp
.gadget
.grp
.hlp
.hpj
.hta
.htc
.img
.inf
.ins
.iso
.isp
.its
.jar
.jnlp
.js
.jse
.ksh
.library-ms
.lnk
.mad
.maf
.mag
.mam
.maq
.mar
.mas
.mat
.mau
.mav
.maw
.mcf
.mda
.mdb
.mde
.mdt
.mdw
.mdz
.msc
.mht
.mhtml
.msh
.msh1
.msh2
.mshxml
.msh1xml
.msh2xml
.msi
.msp
.mst
.msu
.ops
.osd
.pcd
.pif
.pl
.plg
.prf
.prg
.printerexport
.ps1
.ps1xml
.ps2
.ps2xml
.psc1
.psc2
.psd1
.psdm1
.pssc
.pst
.py
.pyc
.pyo
.pyw
.pyz
.pyzw
.reg
.scf
.scr
.sct
.search-ms
.settingcontent-ms
.shb
.shs
.theme
.tmp
.udl
.url
.vb
.vbe
.vbp
.vbs
.vhd
.vhdx
.vsmacros
.vsw
.webpnp
.website
.ws
.wsb
.wsc
.wsf
.wsh
.xbap
.xll
.xnk
`
  .trim()
  .split(/\s+/)

describe("Microsoft's list of blocked Outlook attachments", () => {
  it('has the 133 types it had when it was read', () => {
    assert.equal(MicrosoftOutlookBlockedList.length, 133)
    assert.equal(new Set(MicrosoftOutlookBlockedList).size, 133)
  })

  it('is refused in full, in any case and with trailing dots', () => {
    for (const ext of MicrosoftOutlookBlockedList) {
      assert.equal(isSafeToOpenExtension(ext, true), false, ext)
      assert.equal(
        isSafeToOpenFile(`C:\\repo\\x${ext.toUpperCase()}.`, true),
        false,
        ext
      )
    }
  })

  it('includes the types Windows installs, mounts and runs', () => {
    for (const ext of [
      '.msu',
      '.wsb',
      '.jnlp',
      '.iso',
      '.img',
      '.vhd',
      '.vhdx',
      '.printerexport',
      '.pyc',
      '.pyo',
      '.appcontent-ms',
      '.udl',
    ]) {
      assert.equal(isSafeToOpenFile(`C:\\repo\\x${ext}`, true), false, ext)
    }
  })

  it('is not refused elsewhere than Windows', () => {
    assert.equal(isSafeToOpenFile('/repo/x.msu', false), true)
  })
})

describe('types beyond the Outlook list', () => {
  it('are refused', () => {
    for (const ext of [
      '.searchconnector-ms',
      '.deskthemepack',
      '.vsto',
      '.xla',
      '.ppa',
    ]) {
      assert.equal(isSafeToOpenFile(`C:\\repo\\x${ext}`, true), false, ext)
    }
  })
})

describe('extensions with a character outside ASCII on Windows', () => {
  it('are refused: the registry may fold them onto a risky type', () => {
    for (const name of [
      'x.vb\u017F',
      'x.\u0131nf',
      'x.ln\u212A',
      'x.\u0130nf',
      'x.\u00e9',
      'x.md\u00e9',
    ]) {
      assert.equal(isSafeToOpenFile(`C:\\repo\\${name}`, true), false, name)
    }
  })

  it('leave a non-ASCII name with an ASCII extension alone', () => {
    for (const name of ['x.md', 'r\u00e9sum\u00e9.md', '\u65e5\u672c.txt']) {
      assert.equal(isSafeToOpenFile(`C:\\repo\\${name}`, true), true, name)
    }
  })

  it('are left alone elsewhere than Windows', () => {
    assert.equal(isSafeToOpenFile('/repo/x.\u00e9', false), true)
  })
})
