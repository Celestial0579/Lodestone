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
