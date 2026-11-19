import { openLocalFile } from '../main-process-proxy'
import { Dispatcher } from '../dispatcher'

export async function openFile(
  fullPath: string,
  dispatcher: Dispatcher
): Promise<void> {
  const result = await openLocalFile(fullPath)

  if (!result) {
    const error = {
      name: 'no-external-program',
      message: `Unable to open file ${fullPath} in an external program. Please check you have a program associated with this file extension`,
    }
    await dispatcher.postError(error)
  }
}
