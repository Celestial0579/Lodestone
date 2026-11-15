import {
  initializeNotifications,
  onNotificationEvent,
  terminateNotifications,
} from 'desktop-notifications'
import { BrowserWindow } from 'electron'
import { findToastActivatorClsid } from '../lib/find-toast-activator-clsid'
import { getSquirrelToastActivatorClsid } from '../lib/toast-activator-clsid'
import { DesktopAliveEvent } from '../lib/stores/alive-store'
import * as ipcWebContents from './ipc-webcontents'

let windowsToastActivatorClsid: string | undefined = undefined

export function initializeDesktopNotifications() {
  if (__LINUX__) {
    // notifications not currently supported
    return
  }

  if (__DARWIN__) {
    initializeNotifications({})
    return
  }

  if (windowsToastActivatorClsid !== undefined) {
    return
  }

  windowsToastActivatorClsid = findToastActivatorClsid()

  if (windowsToastActivatorClsid === undefined) {
    log.error(
      'Toast activator CLSID not found in any of the shortcuts. Falling back to the one Squirrel derives for this app.'
    )

    windowsToastActivatorClsid = getSquirrelToastActivatorClsid()
  }

  log.info(`Using toast activator CLSID ${windowsToastActivatorClsid}`)
  initializeNotifications({ toastActivatorClsid: windowsToastActivatorClsid })
}

export function terminateDesktopNotifications() {
  terminateNotifications()
}

export function installNotificationCallback(window: BrowserWindow) {
  onNotificationEvent<DesktopAliveEvent>((event, id, userInfo) => {
    ipcWebContents.send(
      window.webContents,
      'notification-event',
      event,
      id,
      userInfo
    )
  })
}
