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
        aria-label="Welcome to Gitea Desktop"
        aria-describedby="start-description"
      >
        <div className="start-content">
          <h1 className="welcome-title">
            Welcome to <span>Gitea Desktop</span>
          </h1>
          <p id="start-description" className="welcome-text">
            Gitea Desktop is a seamless way to contribute to projects on your
            Gitea instance. Sign in below to get started with your existing
            projects.
          </p>

          <div className="welcome-main-buttons">
            <Button type="submit" onClick={this.signInToGitea} autoFocus={true}>
              Sign in to Gitea
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
            Gitea Desktop talks to your Gitea instance and nothing else. It
            sends no usage data anywhere.
          </p>
        </div>
      </section>
    )
  }

  private signInToGitea = (event?: React.MouseEvent<HTMLButtonElement>) => {
    event?.preventDefault()
    this.props.advance(WelcomeStep.SignInToGitea)
  }

  private skip = () => {
    this.props.advance(WelcomeStep.ConfigureGit)
  }
}
