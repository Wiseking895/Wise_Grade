import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'
import { API_CONFIGURATION_ERROR } from './lib/api'

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('Root element not found')
}

const root = createRoot(rootElement)

if (API_CONFIGURATION_ERROR) {
  // A deployed bundle without a real API origin cannot work. Showing the exact
  // problem is better than an application whose every request fails silently.
  root.render(
    <StrictMode>
      <main className="flex min-h-screen items-center justify-center bg-gradely-light p-6">
        <div
          role="alert"
          className="w-full max-w-xl rounded-2xl border border-red-200 bg-white p-8 shadow-sm"
        >
          <h1 className="text-xl font-semibold text-gradely-navy">
            Wise Grade is not configured
          </h1>
          <p className="mt-3 text-sm text-gradely-text">
            This build cannot reach the Wise Grade API because its address is
            missing or invalid.
          </p>
          <p className="mt-3 rounded-lg bg-gradely-light p-3 font-mono text-xs text-gradely-muted">
            {API_CONFIGURATION_ERROR}
          </p>
          <p className="mt-4 text-sm text-gradely-muted">
            An administrator must set <code>VITE_API_URL</code> in the frontend
            hosting environment and redeploy the site.
          </p>
        </div>
      </main>
    </StrictMode>,
  )
} else {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
