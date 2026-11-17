// Vercel serverless entry point for the Gradely API.
//
// This file deliberately contains no application logic and does not import
// TypeScript sources directly. `npm run build` compiles `src/` to `dist/`, and
// this handler reuses that exact build, so production and local development run
// identical code. No `app.listen()` and no interval scheduler run here.
import { createServerlessHandler } from '../dist/serverless.js'

export default createServerlessHandler()
