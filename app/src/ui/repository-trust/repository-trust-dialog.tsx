import * as React from 'react'
import { Dialog, DialogContent, DialogFooter } from '../dialog'
import { Button } from '../lib/button'
import { Repository } from '../../models/repository'
import { makeVisible } from '../../lib/git/repository-trust'

interface IRepositoryTrustDialogProps {
  readonly repository: Repository
  /** What the repository brings, one line each, already with controls visible. */
  readonly lines: ReadonlyArray<string>
  /** The transport keys: while untrusted, no fetch, pull or push. */
  readonly networkKeys: ReadonlyArray<string>
  /** core.hooksPath or an included file lies in the work tree, where a pull can change it. */
  readonly inWorkTree: boolean
  readonly onAnswer: (repository: Repository, trusted: boolean) => void
  readonly onDismissed: () => void
}

/**
 * Asks whether to trust a repository that carries its own configuration or
 * hooks that run programs. The default answer, on Enter and in focus when the
 * dialog opens, is not to trust. Closing the dialog is not an answer either.
 */
export class RepositoryTrustDialog extends React.Component<IRepositoryTrustDialogProps> {
  public render() {
    const { repository, lines, networkKeys, inWorkTree } = this.props
    const descriptionId = 'repository-trust-description'

    return (
      <Dialog
        id="repository-trust"
        role="alertdialog"
        ariaDescribedBy={descriptionId}
        title={__DARWIN__ ? 'Trust This Repository?' : 'Trust this repository?'}
        type="warning"
        onDismissed={this.props.onDismissed}
        onSubmit={this.onDontTrust}
      >
        <DialogContent>
          <div id={descriptionId}>
            <p>
              The repository {makeVisible(repository.name)} carries its own Git
              settings or hooks that can run programs on this computer. If you
              did not make them yourself, whoever made the repository chose what
              runs. Until you trust it, Lodestone runs Git with these switched
              off.
            </p>
            {networkKeys.length > 0 && (
              <p>
                It also sets {networkKeys.map(makeVisible).join(', ')}, which
                changes where Git connects or what it trusts. While it is not
                trusted, Lodestone does not fetch, pull or push in it. Local
                work keeps working.
              </p>
            )}
            {inWorkTree && (
              <p>
                Some of these files lie in the working folder, so a pull or a
                checkout can change them. Lodestone asks again when they change.
              </p>
            )}
          </div>
          <p id="repository-trust-list-label">Found in this repository:</p>
          <ul
            className="repository-trust-list"
            aria-labelledby="repository-trust-list-label"
          >
            {lines.map((line, i) => (
              <li key={i}>
                <code>{line}</code>
              </li>
            ))}
          </ul>
        </DialogContent>
        <DialogFooter>
          <Button type="submit" autoFocus={true}>
            Don’t trust
          </Button>
          <Button type="button" onClick={this.onTrust}>
            Trust this repository
          </Button>
        </DialogFooter>
      </Dialog>
    )
  }

  private onDontTrust = () => {
    this.props.onAnswer(this.props.repository, false)
    this.props.onDismissed()
  }

  private onTrust = () => {
    this.props.onAnswer(this.props.repository, true)
    this.props.onDismissed()
  }
}
