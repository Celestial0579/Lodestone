import { createHash } from 'crypto'

/**
 * The App User Model ID Squirrel.Windows gives the installed app:
 * `com.squirrel.<package id>.<executable name>`, each without spaces.
 */
export const squirrelAppUserModelId = 'com.squirrel.Lodestone.Lodestone'

/** The ISO OID namespace of RFC 4122, the one Squirrel.Windows hashes into. */
const isoOidNamespace = '6ba7b8129dad11d180b400c04fd430c8'

/**
 * The toast activator CLSID Squirrel.Windows writes into the shortcuts of an
 * app with the given App User Model ID: the version 5 UUID of that ID.
 *
 * https://github.com/Squirrel/Squirrel.Windows/blob/7396fa50ccebf97e28c79ef519c07cb9eee121be/src/Squirrel/UpdateManager.ApplyReleases.cs#L258
 *
 * Deriving it, rather than writing the value down, keeps it this app's own.
 * The value upstream had here was the one for GitHub Desktop, and it stayed
 * through the rename.
 */
export function getSquirrelToastActivatorClsid(
  appUserModelId: string = squirrelAppUserModelId
): string {
  const hash = createHash('sha1')
    .update(Buffer.from(isoOidNamespace, 'hex'))
    .update(appUserModelId, 'utf8')
    .digest()

  const uuid = Buffer.from(hash.subarray(0, 16))
  uuid[6] = (uuid[6] & 0x0f) | 0x50
  uuid[8] = (uuid[8] & 0x3f) | 0x80

  const hex = uuid.toString('hex').toUpperCase()
  const groups = [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ]

  return `{${groups.join('-')}}`
}
