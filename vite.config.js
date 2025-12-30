import { defineConfig } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

export default defineConfig({
  server: {
    host: '0.0.0.0', // Bind to all interfaces
    port: 5174,
    strictPort: true,
    // The "Nuclear" fix for Vite 6 host blocking
    allowedHosts: true, 
    cors: true,
    hmr: {
      // FORCES mobile to use the tunnel for JS instead of looking for 'localhost'
      host: 'indecipherably-trifurcate-rhea.ngrok-free.dev',
      protocol: 'wss',
      clientPort: 443
    }
  },
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