import * as Path from 'path'
import { lstat, stat } from 'fs/promises'

type FileSystem = {
  readonly stat: (path: string) => Promise<unknown>
  readonly lstat: (path: string) => Promise<{ isSymbolicLink(): boolean }>
}

/**
 * Find a command that is on the PATH only as an app execution alias.
 *
 * Windows gives the commands of a packaged app a place on the PATH by putting
 * a zero-byte reparse point into `%LOCALAPPDATA%\Microsoft\WindowsApps`.
 * PowerShell 7 is such an app when it comes from winget or the Store, and
 * `pwsh.exe` is then nowhere else.
 *
 * Node cannot `stat` such a file. It gets EACCES, and so the `which` package,
 * which wants every candidate to be a regular file, passes it over. `lstat`
 * sees it, as a link, and it starts like any other executable. Seen with
 * Node 24.15.0 and with Electron 42.0.1 on Windows 11.
 *
 * Only that folder is looked at. Elsewhere a link that cannot be followed is
 * more likely to be just that.
 */
export async function findAppExecutionAlias(
  command: string,
  pathEnv: string = process.env.PATH ?? '',
  fs: FileSystem = { stat, lstat },
  path: Pick<typeof Path, 'basename' | 'delimiter' | 'join'> = Path
): Promise<string | null> {
  for (const entry of pathEnv.split(path.delimiter)) {
    const folder = entry.replace(/^"(.*)"$/, '$1')

    if (path.basename(folder).toLowerCase() !== 'windowsapps') {
      continue
    }

    const candidate = path.join(folder, command)

    const isAlias = await fs.stat(candidate).then(
      () => false,
      (e: NodeJS.ErrnoException) =>
        e.code === 'EACCES' &&
        fs.lstat(candidate).then(
          s => s.isSymbolicLink(),
          () => false
        )
    )

    if (isAlias) {
      return candidate
    }
  }

  return null
}
