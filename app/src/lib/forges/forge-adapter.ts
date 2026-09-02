/**
 * Picking the request adapter for an endpoint.
 *
 * There are two dialects, not one per product. Gitea and Forgejo share
 * `/api/v1` down to the details this app depends on — the same paths and verbs,
 * `status` rather than `state` on commit statuses, no `pushed_at` on
 * repositories, `page`/`limit` pagination with a `Link` header, and the same
 * `sort` vocabulary with no `direction`. One adapter serves both; splitting
 * them would duplicate the translation and let the copies drift.
 *
 * If the two ever diverge on something the app calls, the answer is a version
 * check on the affected route inside the Gitea adapter, not a second adapter.
 */

import { coreRequest } from '../http-core'
import { giteaRequest, IGiteaRequestOptions } from '../gitea/gitea-api-adapter'
import { ForgeFamily, getForgeFamily } from './forge-type'

/** Everything needed to perform one API request. */
export type IForgeRequestOptions = IGiteaRequestOptions

export interface IForgeAdapter {
  readonly family: ForgeFamily
  request(options: IForgeRequestOptions): Promise<Response>
}

/**
 * GitHub and GitHub Enterprise need no translation: the app was written against
 * this API, so the request goes out exactly as the caller built it.
 */
const githubAdapter: IForgeAdapter = {
  family: ForgeFamily.GitHub,
  request: ({
    endpoint,
    token,
    method,
    path,
    jsonBody,
    customHeaders,
    reloadCache,
  }) =>
    coreRequest(
      endpoint,
      token,
      method,
      path,
      jsonBody,
      customHeaders,
      reloadCache
    ),
}

/** Gitea and Forgejo, translated from the GitHub shape the caller used. */
const giteaAdapter: IForgeAdapter = {
  family: ForgeFamily.Gitea,
  request: giteaRequest,
}

const adapters: Record<ForgeFamily, IForgeAdapter> = {
  [ForgeFamily.GitHub]: githubAdapter,
  [ForgeFamily.Gitea]: giteaAdapter,
}

/** The adapter that speaks this endpoint's dialect. */
export const getForgeAdapter = (endpoint: string): IForgeAdapter =>
  adapters[getForgeFamily(endpoint)]
