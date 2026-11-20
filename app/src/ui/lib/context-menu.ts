import { isSafeToOpenFile } from '../../lib/file-open-policy'

export const CopyFilePathLabel = __DARWIN__
  ? 'Copy File Path'
  : 'Copy file path'

export const CopyRelativeFilePathLabel = __DARWIN__
  ? 'Copy Relative File Path'
  : 'Copy relative file path'

export const CopySelectedPathsLabel = __DARWIN__ ? 'Copy Paths' : 'Copy paths'

export const CopySelectedRelativePathsLabel = __DARWIN__
  ? 'Copy Relative Paths'
  : 'Copy relative paths'

export const DefaultEditorLabel = __DARWIN__
  ? 'Open in External Editor'
  : 'Open in external editor'

export const DefaultShellLabel = __DARWIN__ ? 'Open in Shell' : 'Open in shell'

export const RevealInFileManagerLabel = __DARWIN__
  ? 'Reveal in Finder'
  : __WIN32__
  ? 'Show in Explorer'
  : 'Show in your File Manager'

export const TrashNameLabel = __WIN32__ ? 'Recycle Bin' : 'Trash'

export const OpenWithDefaultProgramLabel = __DARWIN__
  ? 'Open with Default Program'
  : 'Open with default program'

/**
 * Whether the context menu may offer to open the file at `path` with its
 * default program. It decides as `openFile` does, by the whole name: a name
 * that is all extension, one with trailing dots or spaces, one with a colon
 * and one with an extension outside ASCII are refused there as they are here.
 */
export function canOpenWithDefaultProgram(
  path: string,
  windows: boolean = __WIN32__
): boolean {
  return isSafeToOpenFile(path, windows)
}
