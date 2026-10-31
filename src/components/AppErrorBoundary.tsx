/**
 * THE LAST SCREEN BEFORE A WHITE ONE.
 *
 * There was no boundary anywhere in the app, so any throw while rendering — a
 * malformed saved job, an object layer meeting geometry it did not expect — took
 * the whole tree down and left a blank page with nothing to tap and nothing to
 * report. On a phone, in front of someone who paid for the app, that is the worst
 * possible failure: not just broken, but mute.
 *
 * This catches render and lifecycle errors for everything below it and says
 * three things: what broke, that the job itself is safe, and the two ways out.
 *
 * Two honest limits, so nobody trusts it further than it goes:
 *  • Event-handler and async errors are not render errors and do not land here.
 *    Those already surface as their own in-place messages.
 *  • The autosave lives in main.tsx, outside the React tree, so it keeps writing
 *    even while this screen is up. That is why "your job is saved" is true.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react'
import styles from './AppErrorBoundary.module.css'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

export default class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // The only console call worth keeping in a shipped build: if a user reports
    // a crash, this is the line that names the component.
    console.error('[BluePrint3D] render crashed', error, info.componentStack)
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className={styles.screen} role="alert">
        <div className={styles.card}>
          <span className={styles.mark} aria-hidden>!</span>
          <h1 className={styles.title}>The workspace hit a snag</h1>
          <p className={styles.body}>
            Something in the drawing view failed to draw. Your job saves as you
            work, so everything up to the last save is still on this device and
            will be here when the app opens again.
          </p>
          <p className={styles.detail}>{error.message || 'The error gave no message.'}</p>
          <div className={styles.actions}>
            <button
              className={styles.primary}
              onClick={() => this.setState({ error: null })}
            >
              Try again
            </button>
            <button
              className={styles.secondary}
              onClick={() => window.location.reload()}
            >
              Reload the app
            </button>
          </div>
          <p className={styles.hint}>
            If it keeps happening, send the line above to support — it names the
            part that broke.
          </p>
        </div>
      </div>
    )
  }
}
