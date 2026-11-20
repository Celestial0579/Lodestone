/**
 * Which files the app will not open with the program the system has for them.
 *
 * Opening a file hands it to the shell, which for some types runs it or starts
 * a program with it: scripts, shortcuts, installers, files that make Windows
 * connect somewhere. A repository the user cloned can hold any of them, so the
 * app does not open them and offers to show the file in its folder instead.
 *
 * The list is of types Windows starts rather than displays: what PATHEXT names
 * as runnable, the shortcut, script, installer, package, settings and
 * connection types, and the types that carry a remote location. It holds every
 * type on Microsoft's list of attachments Outlook blocks
 * (https://support.microsoft.com/en-us/office/blocked-attachments-in-outlook-434752e1-02d3-4e90-9124-8b81e49a8519,
 * read on 2026-11-20: 133 types; the test pins that list), and in addition
 * the types Windows Explorer treats as executable or as shell links, PATHEXT,
 * the script hosts commonly installed with Python, Ruby and Perl, and these
 * that Outlook's list lacks: .searchconnector-ms (a remote location, like
 * .search-ms), .deskthemepack (like .themepack), .vsto (an Office add-in
 * installer), .xla and .ppa (old add-ins, like .xlam and .ppam).
 *
 * Not covered: macOS and Linux types (.command, .terminal, .tool, .app,
 * .desktop). The app is built for Windows only; the check is skipped elsewhere.
 */

/**
 * Every type on Microsoft's list of blocked Outlook attachments (133 types).
 * Kept apart so that a test can pin it as it was read.
 */
export const OutlookBlockedExtensions: ReadonlyArray<string> = [
  '.ade',
  '.adp',
  '.apk',
  '.app',
  '.appcontent-ms',
  '.application',
  '.appref-ms',
  '.appx',
  '.asp',
  '.aspx',
  '.asx',
  '.bas',
  '.bat',
  '.bgi',
  '.cab',
  '.cdxml',
  '.cer',
  '.chm',
  '.cmd',
  '.cnt',
  '.com',
  '.cpl',
  '.crt',
  '.csh',
  '.der',
  '.diagcab',
  '.exe',
  '.fxp',
  '.gadget',
  '.grp',
  '.hlp',
  '.hpj',
  '.hta',
  '.htc',
  '.img',
  '.inf',
  '.ins',
  '.iso',
  '.isp',
  '.its',
  '.jar',
  '.jnlp',
  '.js',
  '.jse',
  '.ksh',
  '.library-ms',
  '.lnk',
  '.mad',
  '.maf',
  '.mag',
  '.mam',
  '.maq',
  '.mar',
  '.mas',
  '.mat',
  '.mau',
  '.mav',
  '.maw',
  '.mcf',
  '.mda',
  '.mdb',
  '.mde',
  '.mdt',
  '.mdw',
  '.mdz',
  '.msc',
  '.mht',
  '.mhtml',
  '.msh',
  '.msh1',
  '.msh2',
  '.mshxml',
  '.msh1xml',
  '.msh2xml',
  '.msi',
  '.msp',
  '.mst',
  '.msu',
  '.ops',
  '.osd',
  '.pcd',
  '.pif',
  '.pl',
  '.plg',
  '.prf',
  '.prg',
  '.printerexport',
  '.ps1',
  '.ps1xml',
  '.ps2',
  '.ps2xml',
  '.psc1',
  '.psc2',
  '.psd1',
  '.psdm1',
  '.pssc',
  '.pst',
  '.py',
  '.pyc',
  '.pyo',
  '.pyw',
  '.pyz',
  '.pyzw',
  '.reg',
  '.scf',
  '.scr',
  '.sct',
  '.search-ms',
  '.settingcontent-ms',
  '.shb',
  '.shs',
  '.theme',
  '.tmp',
  '.udl',
  '.url',
  '.vb',
  '.vbe',
  '.vbp',
  '.vbs',
  '.vhd',
  '.vhdx',
  '.vsmacros',
  '.vsw',
  '.webpnp',
  '.website',
  '.ws',
  '.wsb',
  '.wsc',
  '.wsf',
  '.wsh',
  '.xbap',
  '.xll',
  '.xnk',
]

/** Types beyond Outlook's list that Windows runs, installs or connects with. */
const OtherRiskyExtensions: ReadonlyArray<string> = [
  '.psm1',
  '.sh',
  '.appxbundle',
  '.msix',
  '.msixbundle',
  '.appinstaller',
  '.diagpkg',
  '.themepack',
  '.rdp',
  '.rdg',
  '.rb',
  '.rbw',
  '.xlam',
  '.ppam',
  '.deskthemepack',
  '.searchconnector-ms',
  '.vsto',
  '.xla',
  '.ppa',
]

const WindowsRiskyExtensions: ReadonlySet<string> = new Set([
  ...OutlookBlockedExtensions,
  ...OtherRiskyExtensions,
])

/**
 * The extension of a file name as Windows reads it. Windows ignores trailing
 * dots and spaces, so `run.exe.` and `run.exe ` are `run.exe`. A name that
 * starts with the dot, such as `.bat`, has that extension: Windows runs it.
 * Returns an empty string when the name has no dot.
 */
export function getEffectiveExtension(path: string): string {
  return getRawEffectiveExtension(path).toLowerCase()
}

/** The same, in the case it has in the name. */
function getRawEffectiveExtension(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? ''
  const trimmed = name.replace(/[. ]+$/, '')
  const dot = trimmed.lastIndexOf('.')

  return dot === -1 ? '' : trimmed.slice(dot)
}

/** Whether a file of this extension, with a leading dot, is safe to open. */
export function isSafeToOpenExtension(
  extension: string,
  windows: boolean
): boolean {
  return !windows || !WindowsRiskyExtensions.has(extension.toLowerCase())
}

/**
 * Whether the app may hand the file at `path` to the system to open. On
 * Windows a name with a colon in it is refused whatever its extension: a colon
 * names an alternate data stream, and the type Windows goes by is then the
 * stream's, not the one before the colon.
 */
export function isSafeToOpenFile(path: string, windows: boolean): boolean {
  if (windows) {
    const name = path.split(/[\\/]/).pop() ?? ''
    if (name.includes(':')) {
      return false
    }

    // The registry matches extensions without regard to case through
    // Windows' own upper-case table, and it is not known which letters that
    // table folds together (`vbſ` for `vbs`, `ınf` for `inf`, the Kelvin
    // sign for `k`). An extension with any character outside ASCII is refused.
    // Checked on the extension as written, before it is lower-cased.
    if (/[^\x00-\x7f]/.test(getRawEffectiveExtension(path))) {
      return false
    }
  }

  return isSafeToOpenExtension(getEffectiveExtension(path), windows)
}
