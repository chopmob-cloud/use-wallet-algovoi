import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'algovoi',
    dir: './src',
    watch: false,
    globals: true,
    environment: 'jsdom'
  }
})
