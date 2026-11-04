import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Both the dev server and `vite preview` proxy /api to the ASP.NET Core API, so the browser never needs CORS.
// Everything binds to localhost only.
const proxy = { '/api': 'http://localhost:5062' }

export default defineConfig({
  plugins: [react()],
  server: { host: 'localhost', port: 5174, strictPort: true, proxy },
  preview: { host: 'localhost', port: 5174, strictPort: true, proxy },
})
