import * as React from 'react'
import { WelcomeStep } from './welcome'
import { LinkButton } from '../lib/link-button'
import { Dispatcher } from '../dispatcher'
import { Button } from '../lib/button'

interface IStartProps {
  readonly advance: (step: WelcomeStep) => void
  readonly dispatcher: Dispatcher
}

/** The first step of the Welcome flow. */
export class Start extends React.Component<IStartProps, {}> {
  public render() {
    return (
      <section
        id="start"
        aria-label="Welcome to Lodestone"
        aria-describedby="start-description"
      >
        <div className="start-content">
          <h1 className="welcome-title">
            Welcome to <span>Lodestone</span>
          </h1>
          <p id="start-description" className="welcome-text">
            Lodestone is a seamless way to contribute to projects on Gitea,
            Forgejo, GitHub and other Git hosts. Sign in below to get started
            with your existing projects.
          </p>

          <div className="welcome-main-buttons">
            <Button type="submit" onClick={this.signIn} autoFocus={true}>
              Sign in
            </Button>
          </div>
          <div className="skip-action-container">
            <LinkButton className="skip-button" onClick={this.skip}>
              Skip this step
            </LinkButton>
          </div>
        </div>

        <div className="start-footer">
          <p>
            Lodestone talks to the instance you sign in to, and checks its own
            project repository for new versions. It sends no usage data
            anywhere, and the update check can be turned off.
          </p>
        </div>
      </section>
    )
  }

  private signIn = (event?: React.MouseEvent<HTMLButtonElement>) => {
    event?.preventDefault()
    this.props.advance(WelcomeStep.SignIn)
  }

  private skip = () => {
    this.props.advance(WelcomeStep.ConfigureGit)
  }
}
