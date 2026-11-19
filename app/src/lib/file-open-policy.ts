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
 * connection types, and the types that carry a remote location. Sources:
 * Microsoft's list of file types Outlook blocks at level 1, the types Windows
 * Explorer treats as executable or as shell links, PATHEXT, and the script
 * hosts commonly installed with Python, Ruby and Perl.
 *
 * Not covered: macOS and Linux types (.command, .terminal, .tool, .app,
 * .desktop). The app is built for Windows only; the check is skipped elsewhere.
 */

const WindowsRiskyExtensions: ReadonlySet<string> = new Set([
  // Programs and what PATHEXT runs.
  '.exe',
  '.com',
  '.bat',
  '.cmd',
  '.scr',
  '.pif',
  '.cpl',
  '.msc',
  // Scripts.
  '.js',
  '.jse',
  '.vbs',
  '.vbe',
  '.wsf',
  '.wsh',
  '.ws',
  '.hta',
  '.ps1',
  '.ps1xml',
  '.psm1',
  '.psd1',
  '.psc1',
  '.sh',
  '.jar',
  '.reg',
  '.inf',
  '.scf',
  // Shortcuts and what points elsewhere.
  '.lnk',
  '.url',
  '.website',
  '.appref-ms',
  '.application',
  '.xbap',
  '.gadget',
  // Installers and packages.
  '.msi',
  '.msp',
  '.mst',
  '.appx',
  '.appxbundle',
  '.msix',
  '.msixbundle',
  '.appinstaller',
  '.diagcab',
  '.diagpkg',
  // Settings and connections.
  '.settingcontent-ms',
  '.search-ms',
  '.library-ms',
  '.theme',
  '.themepack',
  '.rdp',
  '.rdg',
  '.chm',
  '.hlp',
  // Scripting hosts of other languages.
  '.py',
  '.pyw',
  '.pyz',
  '.pyzw',
  '.rb',
  '.rbw',
  '.pl',
  '.wsc',
  '.sct',
  // Shell scrap objects and Office add-ins that run code when opened.
  '.shb',
  '.shs',
  '.xll',
  '.xlam',
  '.ppam',
  // The rest of Outlook's level 1 list.
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
])

/**
 * The extension of a file name as Windows reads it. Windows ignores trailing
 * dots and spaces, so `run.exe.` and `run.exe ` are `run.exe`. A name that
 * starts with the dot, such as `.bat`, has that extension: Windows runs it.
 * Returns an empty string when the name has no dot.
 */
export function getEffectiveExtension(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? ''
  const trimmed = name.replace(/[. ]+$/, '')
  const dot = trimmed.lastIndexOf('.')

  return dot === -1 ? '' : trimmed.slice(dot).toLowerCase()
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
  }

  return isSafeToOpenExtension(getEffectiveExtension(path), windows)
}
