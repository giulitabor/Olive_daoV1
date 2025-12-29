import { defineConfig } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

export default defineConfig({
  server: {
    host: true, // Allows access via local network IP
    allowedHosts: [
      'indecipherably-trifurcate-rhea.ngrok-free.dev',
      '.ngrok-free.app',
      '.ngrok-free.dev'
    ]
  }, // <--- This comma was missing
  plugins: [
    nodePolyfills({
      globals: {
        Buffer: true, 
        global: true,
        process: true,
      },
    }),
  ],
  optimizeDeps: {
    esbuildOptions: {
      define: {
        global: 'globalThis',
      },
    },
  },
});