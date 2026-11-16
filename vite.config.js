import { defineConfig } from 'vite';

const isContentBuild = process.env.npm_lifecycle_event === 'build'
  && process.argv.includes('--mode')
  && process.argv[process.argv.indexOf('--mode') + 1] === 'content';

export default defineConfig({
  publicDir: 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: !isContentBuild,
    rollupOptions: {
      input: isContentBuild
        ? 'src/content/index.js'
        : 'src/background/index.js',
      output: {
        entryFileNames: isContentBuild ? 'content.js' : 'background.js',
        format: 'iife',
        inlineDynamicImports: true
      }
    }
  }
});
