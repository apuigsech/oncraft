import { defineVitestConfig } from '@nuxt/test-utils/config'

export default defineVitestConfig({
  test: {
    environment: 'happy-dom',
    include: ['app/**/__tests__/**/*.test.ts'],
    globals: true,
  },
})
