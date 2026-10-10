import { defineConfig } from '@playwright/test'
export default defineConfig({
	testDir: './tests/render',
	workers: 1,
	use: { channel: process.env.NBT_BROWSER_CHANNEL ?? (process.platform === 'win32' ? 'msedge' : 'chromium'), headless: true, viewport: { width: 1000, height: 700 }, launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } },
})
