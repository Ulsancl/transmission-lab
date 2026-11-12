import { defineConfig } from 'vite';

export default defineConfig({
  // Electron profile caches can be exclusively locked on Windows and are never source files.
  server: { watch: { ignored: ['**/.security-stage-*', '**/.security-stage-*/**', '**/output/**', '**/release/**', '**/dist/**'] } },
  // All content is bundled locally for the offline desktop application.
  build: { emptyOutDir: false },
});
