/**
 * What the dialog holding the app's settings is called.
 *
 * Its menu item and its title say Options on Windows and on Linux, and
 * Settings on macOS. Neither says "Preferences", which is what upstream once
 * called it and what some of its messages went on calling it.
 */
export function getSettingsDialogName(): string {
  return __DARWIN__ ? 'Settings' : 'Options'
}
