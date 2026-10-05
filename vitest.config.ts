// vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		include: ['./src/Tests/**/*.ts'],
		fileParallelism: true,

		// Database.ts opens its connection while the module is evaluating, which under ESM
		// happens before any test body runs -- setting this inside a test would land too
		// late. Putting it here also means a new test file cannot reach the real database
		// by forgetting some setup step. Each test file gets its own worker, so each gets
		// its own independent in-memory database.
		// ATTACHMENT_DIR gets the same treatment for the same reason: CRUD/Attachments.ts resolves
		// its root while the module evaluates, and no test run should be able to reach the real
		// store -- or leave files in it -- by forgetting a setup step.
		env: { DB_FILE: ':memory:', ATTACHMENT_DIR: './.attachments-test' }
	}
})