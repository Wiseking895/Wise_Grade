import { Component, type ReactNode } from 'react'
import AuthRecoveryScreen from './AuthRecoveryScreen'
import { recordRecoveryAttempt } from '../lib/recovery'

interface Props {
  children: ReactNode
}

interface State {
  failed: boolean
}

/**
 * Last-resort React error boundary.
 *
 * It never displays a stack trace, component name or raw error. A render crash
 * is counted as one failed load attempt, and the shared recovery screen offers
 * only an explicit reload, so a crash loop stops after three attempts.
 */
export default class AppErrorBoundary extends Component<Props, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  componentDidCatch(error: Error): void {
    // Log only the message for local diagnostics. No stack or user data is
    // rendered to the browser.
    console.error('[gradely] render error:', error.message)
    recordRecoveryAttempt()
  }

  render() {
    if (this.state.failed) {
      return (
        <AuthRecoveryScreen message="Wise Grade could not display this page. Reload the page to try again. Nothing you saved has been changed." />
      )
    }

    return this.props.children
  }
}
