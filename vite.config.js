import { defineConfig } from 'vite';

const policy = "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; worker-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-src 'none'; form-action 'none'";
const generated = ['**/.security-stage-*/**', '**/.security-write-*/**', '**/output/**', '**/release/**', '**/dist/**'];

export default defineConfig(({ command, isPreview }) => ({
  define: { __TRANSMISSION_TEST_HOOKS__: command === 'serve' && !isPreview },
  server: {
    watch: { ignored: [...generated, '**/.security-stage-*'] },
    fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', ...generated] },
  },
  plugins: [{
    name: 'production-content-security-policy',
    apply: 'build',
    transformIndexHtml() {
      return [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: policy }, injectTo: 'head-prepend' }];
    },
  }],
  build: { emptyOutDir: false },
}));
