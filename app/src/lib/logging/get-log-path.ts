import { app } from 'electron'
import { getLogDirectory } from './log-directory'

let logDirectoryPath: string | null = null

export function getLogDirectoryPath() {
  if (!logDirectoryPath) {
    logDirectoryPath = getLogDirectory(
      app.getPath('userData'),
      process.platform,
      process.env.LOCALAPPDATA
    )
  }

  return logDirectoryPath
}
