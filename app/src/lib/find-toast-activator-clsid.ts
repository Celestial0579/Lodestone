import { shell } from 'electron'
import { getSquirrelShortcutPaths } from '../main-process/squirrel-install-state'

/**
 * Checks all Windows shortcuts created by Squirrel looking for the toast
 * activator CLSID needed to handle Windows notifications from the Action Center.
 */
export function findToastActivatorClsid() {
  for (const shortcutPath of getSquirrelShortcutPaths()) {
    const toastActivatorClsid = findToastActivatorClsidInShorcut(shortcutPath)

    if (toastActivatorClsid !== undefined) {
      return toastActivatorClsid
    }
  }

  return undefined
}

function findToastActivatorClsidInShorcut(shortcutPath: string) {
  try {
    const shortcutDetails = shell.readShortcutLink(shortcutPath)

    if (
      shortcutDetails.toastActivatorClsid === undefined ||
      shortcutDetails.toastActivatorClsid === ''
    ) {
      return undefined
    }

    return shortcutDetails.toastActivatorClsid
  } catch (error) {
    log.error(
      `Error looking for toast activator CLSID in shortcut ${shortcutPath}`,
      error
    )
    return undefined
  }
}
