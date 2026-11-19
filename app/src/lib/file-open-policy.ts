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
 * connection types, and the types that carry a remote location.
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
])

/**
 * The extension of a file name as Windows reads it. Windows ignores trailing
 * dots and spaces and an alternate data stream suffix, so `run.exe.`,
 * `run.exe ` and `run.exe::$DATA` are `run.exe`. Returns an empty string when
 * there is none.
 */
export function getEffectiveExtension(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? ''
  const withoutStream = name.split(':')[0]
  const trimmed = withoutStream.replace(/[. ]+$/, '')
  const dot = trimmed.lastIndexOf('.')

  return dot <= 0 ? '' : trimmed.slice(dot).toLowerCase()
}

/** Whether a file of this extension, with a leading dot, is safe to open. */
export function isSafeToOpenExtension(
  extension: string,
  windows: boolean
): boolean {
  return !windows || !WindowsRiskyExtensions.has(extension.toLowerCase())
}

/** Whether the app may hand the file at `path` to the system to open. */
export function isSafeToOpenFile(path: string, windows: boolean): boolean {
  return isSafeToOpenExtension(getEffectiveExtension(path), windows)
}
