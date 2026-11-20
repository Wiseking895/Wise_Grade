import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { checkDeployableApiUrl, SAME_ORIGIN_SENTINEL } from './src/lib/api-url.ts'

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  // Vite only exposes VITE_* values to the bundle. The same value must exist at
  // build time so the deployed client points at the deployed API, never at the
  // developer's localhost. Process variables win, which is how CI/Vercel
  // environment variables are applied.
  const fileEnv = loadEnv(mode, process.cwd(), 'VITE_')
  const configuredApiUrl = process.env.VITE_API_URL ?? fileEnv.VITE_API_URL

  // Same-origin mode needs the dev server to forward `/api` to the backend, or
  // the browser would request the Vite server itself. Set
  // VITE_API_PROXY_TARGET to override the local backend. Production uses the
  // hosting rewrite in vercel.json instead.
  const proxyTarget =
    process.env.VITE_API_PROXY_TARGET ??
    fileEnv.VITE_API_PROXY_TARGET ??
    (configuredApiUrl?.trim() === SAME_ORIGIN_SENTINEL
      ? 'http://localhost:4000'
      : undefined)

  if (command === 'build') {
    const { error, warning } = checkDeployableApiUrl(configuredApiUrl)

    if (error) {
      throw new Error(`[wise-grade] ${error}`)
    }

    if (warning) {
      console.warn(`[wise-grade] ${warning}`)
    }
  }

  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: 5173,
      ...(proxyTarget
        ? {
            proxy: {
              '/api': {
                target: proxyTarget,
                changeOrigin: false,
              },
            },
          }
        : {}),
    },
  }
})
