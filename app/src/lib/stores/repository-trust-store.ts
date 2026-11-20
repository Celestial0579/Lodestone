/**
 * Whether the user trusts a repository's own configuration and hooks (#98).
 *
 * The answer is kept per folder together with a fingerprint of what the
 * repository brought when it was given: its keys, values, the files they came
 * from, and the names and content of its hooks. When the fingerprint changes,
 * the answer no longer applies and the repository is untrusted until the user
 * answers again. A repository that brings nothing needs no answer.
 *
 * The record holds paths, key names and hashes, no secrets.
 */

import { findNetworkPaths } from '../git/repository-trust-paths'
import { readRepositoryFindings } from '../git/repository-trust-facts'
import {
  describeFindings,
  fingerprintFindings,
  getTransportBlockKeys,
  hasFindings,
  IRepositoryFindings,
} from '../git/repository-trust'
import {
  buildRepositoryGitPolicy,
  pendingPolicy,
  repositoryPolicyKey,
  RepositoryTrust,
  setRepositoryGitPolicy,
  NotCheckedYet,
  setRepositoryRefusal,
} from '../git/repository-trust-state'

/** What was answered for one folder. */
export interface IStoredTrustAnswer {
  readonly path: string
  readonly fingerprint: string
  readonly trusted: boolean
  readonly answeredAt: number
}

/** Where the answers live. */
export interface ITrustStorage {
  read(): Readonly<Record<string, IStoredTrustAnswer>>
  write(answers: Readonly<Record<string, IStoredTrustAnswer>>): void
}

const StorageKey = 'repository-trust-answers'

/** The answers in the app's local storage, which only the user's profile can read. */
export const localStorageTrust: ITrustStorage = {
  read() {
    try {
      const parsed = JSON.parse(localStorage.getItem(StorageKey) ?? '{}')
      return typeof parsed === 'object' && parsed !== null ? parsed : {}
    } catch {
      return {}
    }
  },
  write(answers) {
    try {
      localStorage.setItem(StorageKey, JSON.stringify(answers))
    } catch (e) {
      log.warn('[trust] could not save the answers', e)
    }
  },
}

/** What looking at a repository came to. */
export interface ITrustEvaluation {
  readonly trust: RepositoryTrust
  /** The user has to be asked: it brings something and nothing was answered for it. */
  readonly needsQuestion: boolean
  readonly findings: IRepositoryFindings | null
  readonly fingerprint: string | null
  /** The findings as text, one line each, for the question. */
  readonly lines: ReadonlyArray<string>
  /** The keys that block network operations while the repository is untrusted. */
  readonly networkKeys: ReadonlyArray<string>
}

export class RepositoryTrustStore {
  private lastEvaluations = new Map<string, ITrustEvaluation>()

  public constructor(
    private readonly storage: ITrustStorage = localStorageTrust,
    private readonly readFindings: (
      path: string
    ) => Promise<IRepositoryFindings | null> = readRepositoryFindings
  ) {}

  /** Until a repository has been looked at, nothing it names runs. */
  public markPending(path: string) {
    setRepositoryGitPolicy(path, pendingPolicy())
    // No Git runs in it until its files have been read (see inspectPaths).
    setRepositoryRefusal(path, [NotCheckedYet])
  }

  /**
   * Read the files that name paths Git opens on every call, and refuse the
   * folder if one is a network or device path. Without Git touching it.
   */
  public async inspectPaths(path: string): Promise<ReadonlyArray<string>> {
    const found = await findNetworkPaths(path)
    setRepositoryRefusal(path, found)
    return found
  }

  /**
   * Look at a repository, set how Git runs in it, and say whether the user
   * has to be asked. Run it again after anything that can change the
   * repository's own files.
   */
  public async evaluate(path: string): Promise<ITrustEvaluation> {
    const refusal = await this.inspectPaths(path)
    const findings = refusal.length > 0 ? null : await this.readFindings(path)

    if (findings === null) {
      // Git could not be asked: the repository stays as it is until it can.
      this.markPending(path)
      const result: ITrustEvaluation = {
        trust: 'pending',
        needsQuestion: false,
        findings: null,
        fingerprint: null,
        lines: [],
        networkKeys: [],
      }
      this.lastEvaluations.set(repositoryPolicyKey(path), result)
      return result
    }

    const fingerprint = fingerprintFindings(findings)
    const stored = this.storage.read()[repositoryPolicyKey(path)]

    let trust: RepositoryTrust
    let needsQuestion = false

    if (!hasFindings(findings)) {
      trust = 'trusted'
    } else if (stored !== undefined && stored.fingerprint === fingerprint) {
      trust = stored.trusted ? 'trusted' : 'untrusted'
    } else {
      trust = 'untrusted'
      needsQuestion = true
    }

    setRepositoryGitPolicy(path, buildRepositoryGitPolicy(trust, findings))

    const result: ITrustEvaluation = {
      trust,
      needsQuestion,
      findings,
      fingerprint,
      lines: describeFindings(findings),
      networkKeys: getTransportBlockKeys(findings),
    }
    this.lastEvaluations.set(repositoryPolicyKey(path), result)
    return result
  }

  /** The user answered for what the last evaluation found. */
  public answer(path: string, trusted: boolean): ITrustEvaluation | null {
    const key = repositoryPolicyKey(path)
    const evaluation = this.lastEvaluations.get(key)

    if (
      evaluation === undefined ||
      evaluation.findings === null ||
      evaluation.fingerprint === null
    ) {
      return null
    }

    this.storage.write({
      ...this.storage.read(),
      [key]: {
        path,
        fingerprint: evaluation.fingerprint,
        trusted,
        answeredAt: Date.now(),
      },
    })

    const trust: RepositoryTrust = trusted ? 'trusted' : 'untrusted'
    setRepositoryGitPolicy(
      path,
      buildRepositoryGitPolicy(trust, evaluation.findings)
    )
    const result = { ...evaluation, trust, needsQuestion: false }
    this.lastEvaluations.set(key, result)
    return result
  }

  /** Forget the answer for a folder, so that it is asked about again. */
  public revoke(path: string) {
    const rest = { ...this.storage.read() }
    delete rest[repositoryPolicyKey(path)]
    this.storage.write(rest)
    this.lastEvaluations.delete(repositoryPolicyKey(path))
  }

  /** The folders the user said yes for. */
  public listTrusted(): ReadonlyArray<IStoredTrustAnswer> {
    return Object.values(this.storage.read())
      .filter(a => a.trusted)
      .sort((a, b) => a.path.localeCompare(b.path))
  }
}
