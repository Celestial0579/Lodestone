import { getHTMLURL } from './api'
import {
  getGitHubHtmlUrl,
  getNonForkGitHubRepository,
  isRepositoryWithGitHubRepository,
  Repository,
} from '../models/repository'

/**
 * The web address of the forge repository of a repository, or null if it has
 * none.
 *
 * The address the forge reported is used when the app has one. A repository
 * that was linked to a forge from its remote alone, before an API answer
 * arrived or after a failed refresh, has none stored, but the address follows
 * from the endpoint, the owner and the name, so it is built from those.
 * Without that, the menu offered "Create issue" for such a repository and the
 * click did nothing (#83).
 */
export function getRepositoryWebURL(repository: Repository): string | null {
  const reported = getGitHubHtmlUrl(repository)

  if (reported !== null) {
    return reported
  }

  if (!isRepositoryWithGitHubRepository(repository)) {
    return null
  }

  const gitHubRepository = getNonForkGitHubRepository(repository)
  const base = getHTMLURL(gitHubRepository.endpoint).replace(/\/+$/, '')

  return `${base}/${gitHubRepository.owner.login}/${gitHubRepository.name}`
}

/** The page to create an issue on the forge repository, if it has one. */
export function getIssueCreationURL(repository: Repository): string | null {
  const url = getRepositoryWebURL(repository)

  // GitHub's template chooser lives at /issues/new/choose, but Gitea and
  // Forgejo 404 on it, and /issues/new works on all of them.
  return url === null ? null : `${url}/issues/new`
}
