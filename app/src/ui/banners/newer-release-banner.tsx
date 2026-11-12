import * as React from 'react'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { Banner } from './banner'
import { LinkButton } from '../lib/link-button'
import { IForgeRelease } from '../../lib/forges/update-source'

interface INewerReleaseBannerProps {
  /** The release the update check found. */
  readonly release: IForgeRelease
  readonly onDismissed: () => void
}

/**
 * Says in the main window that the update check found a newer release.
 *
 * A release on a forge is a file to download, not something the app can
 * install, so the updater's own banner, which offers a restart, does not fit.
 * Before this the About dialog was the only place that named the release, and
 * someone who never opened it never heard of an update.
 */
export class NewerReleaseBanner extends React.Component<INewerReleaseBannerProps> {
  public render() {
    const { release } = this.props

    return (
      <Banner
        id="newer-release-banner"
        dismissable={true}
        onDismissed={this.props.onDismissed}
      >
        <Octicon className="download-icon" symbol={octicons.desktopDownload} />
        <span>
          <LinkButton uri={release.htmlURL}>{release.name}</LinkButton> is
          available for download.
        </span>
      </Banner>
    )
  }
}
