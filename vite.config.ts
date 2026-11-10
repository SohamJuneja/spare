import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  // Nimiq Pay loads the dev app from the phone over LAN, so bind to all interfaces.
  // Vite prints the LAN "Network:" URL to open in Nimiq Pay > Mini Apps.
  server: { host: '0.0.0.0', port: 5173, strictPort: true },
})
