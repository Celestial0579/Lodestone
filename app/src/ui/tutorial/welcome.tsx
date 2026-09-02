import * as React from 'react'

import { encodePathAsUrl } from '../../lib/path'

const CodeImage = encodePathAsUrl(__dirname, 'static/code.svg')
const TeamDiscussionImage = encodePathAsUrl(
  __dirname,
  'static/gitea-for-teams.svg'
)
const CloudServerImage = encodePathAsUrl(
  __dirname,
  'static/gitea-for-business.svg'
)

export class TutorialWelcome extends React.Component {
  public render() {
    return (
      <div id="tutorial-welcome">
        <div className="header">
          <h1>Welcome to Lodestone</h1>
          <p>
            Use this tutorial to get comfortable with Git, your Git host and
            Lodestone.
          </p>
        </div>
        <ul className="definitions">
          <li>
            <img src={CodeImage} alt="Html syntax icon" />
            <p>
              <strong>Git</strong> is the version control system.
            </p>
          </li>
          <li>
            <img
              src={TeamDiscussionImage}
              alt="People with discussion bubbles overhead"
            />
            <p>
              <strong>Your Git host</strong> — Gitea, Forgejo, GitHub or another
              — is where you store your code and collaborate with others.
            </p>
          </li>
          <li>
            <img src={CloudServerImage} alt="Server stack with cloud" />
            <p>
              <strong>Lodestone</strong> helps you work with it locally.
            </p>
          </li>
        </ul>
      </div>
    )
  }
}
