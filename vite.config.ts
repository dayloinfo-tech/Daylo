import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },
    build: {
      rollupOptions: {
        input: {
          main: path.resolve(import.meta.dirname, 'index.html'),
          login: path.resolve(import.meta.dirname, 'login.html'),
          signup: path.resolve(import.meta.dirname, 'signup.html'),
          dashboard: path.resolve(import.meta.dirname, 'dashboard.html'),
          upgrade: path.resolve(import.meta.dirname, 'upgrade.html'),
          contact: path.resolve(import.meta.dirname, 'contact.html'),
          admin: path.resolve(import.meta.dirname, 'admin.html'),
        },
        output: {
          // Keep the public Firebase web config in its own predictably named
          // chunk so netlify.toml can exclude just that file from secret scanning.
          codeSplitting: {
            groups: [{name: 'firebase-config', test: /firebase-applet-config\.json/}],
          },
        },
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});

