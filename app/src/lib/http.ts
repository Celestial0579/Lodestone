import { coreRequest, HTTPMethod } from './http-core'
import { isGiteaEndpoint } from './gitea/gitea-endpoint'
import { giteaRequest } from './gitea/gitea-api-adapter'

export * from './http-core'

/**
 * Make an API request.
 *
 * Requests aimed at a Gitea instance are routed through the Gitea adapter,
 * which translates paths and payloads between the GitHub shape the rest of the
 * app is written against and the Gitea REST API. Every other endpoint is passed
 * straight through to the underlying request implementation.
 *
 * @param endpoint      - The API endpoint.
 * @param token         - The token to use for authentication.
 * @param method        - The HTTP method.
 * @param path          - The path, including any query string parameters.
 * @param jsonBody      - The JSON body to send.
 * @param customHeaders - Any optional additional headers to send.
 * @param reloadCache   - sets cache option to reload — The browser fetches
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
  if (isGiteaEndpoint(endpoint)) {
    return giteaRequest({
      endpoint,
      token,
      method,
      path,
      jsonBody,
      customHeaders,
      reloadCache,
    })
  }

  return coreRequest(
    endpoint,
    token,
    method,
    path,
    jsonBody,
    customHeaders,
    reloadCache
  )
}
