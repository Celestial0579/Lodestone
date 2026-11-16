import * as Path from 'path'

/**
 * Where the logs go. On Windows they are machine-bound files, so they belong
 * in the local profile (`%LOCALAPPDATA%\<app>\logs`), where a roaming profile
 * does not carry them from one machine to the next. `userData` is in the
 * roaming one. Everywhere else it stays `<userData>/logs`.
 */
export function getLogDirectory(
  userData: string,
  platform: NodeJS.Platform,
  localAppData: string | undefined
) {
  if (platform === 'win32' && localAppData && Path.isAbsolute(localAppData)) {
    return Path.join(localAppData, Path.basename(userData), 'logs')
  }

  return Path.join(userData, 'logs')
}
