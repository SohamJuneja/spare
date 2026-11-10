import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  // Nimiq Pay loads the dev app from the phone over LAN, so bind to all interfaces.
  server: { host: true, port: 5173 },
})
