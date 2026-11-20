import { shell } from '../../lib/app-shell'
import { Dispatcher } from '../dispatcher'
import { isSafeToOpenFile } from '../../lib/file-open-policy'

export async function openFile(
  fullPath: string,
  dispatcher: Dispatcher
): Promise<void> {
  // Every caller comes through here, so the check is here and not in the
  // menus, which only hide an item.
  if (!isSafeToOpenFile(fullPath, __WIN32__)) {
    await dispatcher.postError({
      name: 'unsafe-file-type',
      message: `${fullPath} is a type of file that Windows runs or starts a program with, so Lodestone does not open it. Show it in its folder instead.`,
    })
    return
  }

  const errorMessage = await shell.openPath(fullPath)

  if (errorMessage !== '') {
    const error = {
      name: 'no-external-program',
      message: `Unable to open file ${fullPath} in an external program. Please check you have a program associated with this file extension`,
    }
    await dispatcher.postError(error)
  }
}
