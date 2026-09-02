import { IDataStore, ISecureStore } from './stores'
import { getKeyForAccount } from '../auth'
import {
  forgetRefreshMaterial,
  getRefreshMaterial,
  IRefreshMaterial,
  rememberRefreshMaterial,
  setTokenRefreshedCallback,
} from '../forges/forge-token-refresh'
import { Account, isDotComAccount } from '../../models/account'
import { fetchUser, EmailVisibility, getEnterpriseAPIURL } from '../api'
import { fatalError } from '../fatal-error'
import { TypedBaseStore } from './base-store'
import { isGHE } from '../endpoint-capabilities'
import { compare, compareDescending } from '../compare'

// Ensure that GitHub.com accounts appear first followed by Enterprise
// accounts, sorted by the order in which they were added.
const sortAccounts = (accounts: ReadonlyArray<Account>) =>
  accounts
    .map((account, ix) => [account, ix] as const)
    .sort(
      ([xAccount, xIx], [yAccount, yIx]) =>
        compareDescending(
          isDotComAccount(xAccount),
          isDotComAccount(yAccount)
        ) || compare(xIx, yIx)
    )
    .map(([account]) => account)

/** The data-only interface for storage. */
interface IEmail {
  readonly email: string
  /**
   * Represents whether GitHub has confirmed the user has access to this
   * email address. New users require a verified email address before
   * they can sign into Lodestone.
   */
  readonly verified: boolean
  /**
   * Flag for the user's preferred email address. Other email addresses
   * are provided for associating commit authors with the one GitHub account.
   */
  readonly primary: boolean

  /** The way in which the email is visible. */
  readonly visibility: EmailVisibility
}

function isKeyChainError(e: any) {
  const error = e as Error
  return (
    error.message &&
    error.message.startsWith(
      'The user name or passphrase you entered is not correct'
    )
  )
}

/** The data-only interface for storage. */
interface IAccount {
  readonly token: string
  readonly login: string
  readonly endpoint: string
  readonly emails: ReadonlyArray<IEmail>
  readonly avatarURL: string
  readonly id: number
  readonly name: string
  readonly plan?: string
}

/** The store for logged in accounts. */
export class AccountsStore extends TypedBaseStore<ReadonlyArray<Account>> {
  private dataStore: IDataStore
  private secureStore: ISecureStore

  private accounts: ReadonlyArray<Account> = []

  /** A promise that will resolve when the accounts have been loaded. */
  private loadingPromise: Promise<void>

  public constructor(dataStore: IDataStore, secureStore: ISecureStore) {
    super()

    this.dataStore = dataStore
    this.secureStore = secureStore

    // How a token renewed deep in the request layer gets written back.
    setTokenRefreshedCallback((previous, next, material) =>
      this.applyRefreshedToken(previous, next, material)
    )
    this.loadingPromise = this.loadFromStore()
  }

  /**
   * Get the list of accounts in the cache.
   */
  public async getAll(): Promise<ReadonlyArray<Account>> {
    await this.loadingPromise

    return this.accounts.slice()
  }

  /**
   * Add the account to the store.
   */
  public async addAccount(account: Account): Promise<Account | null> {
    await this.loadingPromise

    try {
      const key = getKeyForAccount(account)
      await this.secureStore.setItem(key, account.login, account.token)
      await this.saveRefreshMaterial(account.login, key, account.token)
    } catch (e) {
      log.error(`Error adding account '${account.login}'`, e)

      if (__DARWIN__ && isKeyChainError(e)) {
        this.emitError(
          new Error(
            `Lodestone was unable to store the account token in the keychain. Please check you have unlocked access to the 'login' keychain.`
          )
        )
      } else {
        this.emitError(e)
      }
      return null
    }

    const accountsByEndpoint = this.accounts.reduce(
      (map, x) => map.set(x.endpoint, x),
      new Map<string, Account>()
    )
    accountsByEndpoint.set(account.endpoint, account)

    this.accounts = sortAccounts([...accountsByEndpoint.values()])

    this.save()
    return account
  }

  /** Refresh all accounts by fetching their latest info from the API. */
  public async refresh(): Promise<void> {
    this.accounts = await Promise.all(
      this.accounts.map(acc => this.tryUpdateAccount(acc))
    )

    this.save()
    this.emitUpdate(this.accounts)
  }

  /**
   * Attempts to update the Account with new information from
   * the API.
   *
   * If the update fails for whatever reason this function
   * will return the old Account instance. Usually updates fails
   * due to connectivity issues but in the future we should
   * investigate whether we're able to detect here that the
   * token is definitely not valid anymore and let the
   * user know that they've been signed out.
   */
  private async tryUpdateAccount(account: Account): Promise<Account> {
    try {
      return await updatedAccount(account)
    } catch (e) {
      log.warn(`Error refreshing account '${account.login}'`, e)
      return account
    }
  }

  /**
   * Remove the account from the store.
   */
  public async removeAccount(account: Account): Promise<void> {
    await this.loadingPromise

    try {
      const key = getKeyForAccount(account)

      await this.secureStore.deleteItem(key, account.login)

      // Signing out has to take the means of getting back in with it.
      forgetRefreshMaterial(account.token)
      await this.secureStore
        .deleteItem(AccountsStore.refreshKey(key), account.login)
        .catch(() => {
          // Nothing was stored for an account that signed in with a token.
        })
    } catch (e) {
      log.error(`Error removing account '${account.login}'`, e)
      this.emitError(e)
      return
    }

    this.accounts = this.accounts.filter(
      a => !(a.endpoint === account.endpoint && a.id === account.id)
    )

    this.save()
  }

  private getMigratedGHEAccounts(
    accounts: ReadonlyArray<IAccount>
  ): ReadonlyArray<IAccount> | null {
    let migrated = false
    const migratedAccounts = accounts.map(account => {
      let endpoint = account.endpoint
      const endpointURL = new URL(endpoint)
      // Migrate endpoints of subdomains of `.ghe.com` that use the `/api/v3`
      // path to the correct URL using the `api.` subdomain.
      if (isGHE(endpoint) && !endpointURL.hostname.startsWith('api.')) {
        endpoint = getEnterpriseAPIURL(endpoint)
        migrated = true
      }

      return {
        ...account,
        endpoint,
      }
    })

    return migrated ? migratedAccounts : null
  }

  /**
   * Load the users into memory from storage.
   */
  private async loadFromStore(): Promise<void> {
    const raw = this.dataStore.getItem('users')
    if (!raw || !raw.length) {
      return
    }

    const parsedAccounts: ReadonlyArray<IAccount> = JSON.parse(raw)
    const migratedAccounts = this.getMigratedGHEAccounts(parsedAccounts)
    const rawAccounts = migratedAccounts ?? parsedAccounts

    const accountsWithTokens = []
    for (const account of rawAccounts) {
      const accountWithoutToken = new Account(
        account.login,
        account.endpoint,
        '',
        account.emails,
        account.avatarURL,
        account.id,
        account.name,
        account.plan
      )

      const key = getKeyForAccount(accountWithoutToken)
      try {
        const token = await this.secureStore.getItem(key, account.login)
        await this.loadRefreshMaterial(account.login, key, token || '')
        accountsWithTokens.push(accountWithoutToken.withToken(token || ''))
      } catch (e) {
        log.error(`Error getting token for '${key}'. Skipping.`, e)

        this.emitError(e)
      }
    }

    this.accounts = sortAccounts(accountsWithTokens)
    // If any account was migrated, make sure to persist the new value
    if (migratedAccounts !== null) {
      this.save() // Save already emits an update
    } else {
      this.emitUpdate(this.accounts)
    }
  }

  /** Where an account's refresh token lives, beside its access token. */
  private static refreshKey(key: string) {
    return `${key} (refresh)`
  }

  /**
   * Persist the refresh material for a token that has some.
   *
   * Silent when there is none: personal access tokens do not expire and have
   * nothing to renew with, which is the common case.
   */
  private async saveRefreshMaterial(
    login: string,
    key: string,
    token: string
  ): Promise<void> {
    const material = getRefreshMaterial(token)

    if (material === undefined) {
      return
    }

    await this.secureStore.setItem(
      AccountsStore.refreshKey(key),
      login,
      JSON.stringify(material)
    )
  }

  /** Re-register refresh material stored by an earlier run. */
  private async loadRefreshMaterial(
    login: string,
    key: string,
    token: string
  ): Promise<void> {
    if (token.length === 0) {
      return
    }

    try {
      const raw = await this.secureStore.getItem(
        AccountsStore.refreshKey(key),
        login
      )

      if (raw === null || raw.length === 0) {
        return
      }

      const material: IRefreshMaterial = JSON.parse(raw)

      if (typeof material?.refreshToken === 'string') {
        rememberRefreshMaterial(token, material)
      }
    } catch (e) {
      // Losing this only costs the user a fresh sign-in when the token
      // expires, so it is not worth failing account loading over.
      log.warn(`Could not read refresh material for '${key}'`, e)
    }
  }

  /**
   * Take a renewed access token and put it everywhere the old one was: the
   * secure store, the in-memory accounts, and anyone listening for updates.
   */
  private async applyRefreshedToken(
    previousToken: string,
    nextToken: string,
    material: IRefreshMaterial
  ): Promise<void> {
    const account = this.accounts.find(a => a.token === previousToken)

    if (account === undefined) {
      return
    }

    const key = getKeyForAccount(account)

    await this.secureStore.setItem(key, account.login, nextToken)
    await this.secureStore.setItem(
      AccountsStore.refreshKey(key),
      account.login,
      JSON.stringify(material)
    )

    this.accounts = this.accounts.map(a =>
      a.token === previousToken ? a.withToken(nextToken) : a
    )

    this.emitUpdate(this.accounts)
  }

  private save() {
    const usersWithoutTokens = this.accounts.map(account =>
      account.withToken('')
    )
    this.dataStore.setItem('users', JSON.stringify(usersWithoutTokens))

    this.emitUpdate(this.accounts)
  }
}

async function updatedAccount(account: Account): Promise<Account> {
  if (!account.token) {
    return fatalError(
      `Cannot update an account which doesn't have a token: ${account.login}`
    )
  }

  return fetchUser(account.endpoint, account.token)
}
