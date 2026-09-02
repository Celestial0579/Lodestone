import { HTTPMethod } from './http-core'
import { getForgeAdapter } from './forges/forge-adapter'

export * from './http-core'

/**
 * Make an API request.
 *
 * Callers everywhere build GitHub-shaped requests. Which dialect actually goes
 * out over the wire is decided here, by the endpoint: GitHub and GitHub
 * Enterprise pass through untouched, Gitea and Forgejo are translated.
 *
 * @param endpoint      - The API endpoint.
 * @param token         - The token to use for authentication.
 * @param method        - The HTTP method.
 * @param path          - The path, including any query string parameters.
 * @param jsonBody      - The JSON body to send.
 * @param customHeaders - Any optional additional headers to send.
 * @param reloadCache   - sets cache option to reload - The browser fetches
 * the resource from the remote server without first looking in the cache, but
 * then will update the cache with the downloaded resource.
 */
export function request(
  endpoint: string,
  token: string | null,
  method: HTTPMethod,
  path: string,
  jsonBody?: Object,
  customHeaders?: Object,
  reloadCache: boolean = false
): Promise<Response> {
  return getForgeAdapter(endpoint).request({
    endpoint,
    token,
    method,
    path,
    jsonBody,
    customHeaders,
    reloadCache,
  })
}
