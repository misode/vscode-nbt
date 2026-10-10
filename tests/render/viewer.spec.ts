import { expect, test } from '@playwright/test'
import { promises as fs } from 'node:fs'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import * as os from 'node:os'
import * as path from 'node:path'
import { PNG } from 'pngjs'
import { NbtCompound, NbtFile, NbtInt, NbtList, NbtString, Structure } from 'deepslate'
import { ResourceIndex } from '../../src/assets/ResourceIndex'
import { cube, instance, makePng, resources, zip } from '../fixtures'

let root: string
let server: Server
let url: string
const index = new ResourceIndex()
const structure = new Structure([5, 2, 3])
structure.addBlock([0, 0, 0], 'minecraft:stone')
structure.addBlock([1, 0, 0], 'demo:casing')
structure.addBlock([2, 0, 0], 'demo:pipe', { axis: 'x' })
structure.addBlock([3, 0, 0], 'demo:missing')
structure.addBlock([1, 0, 1], 'demo:slab')
structure.addBlock([2, 0, 1], 'demo:custom')
structure.addBlock([0, 0, 1], 'demo:multipart', { connected: 'true' })

// Fixtures exercise the real production editor and real archive loader. The
// VS Code transport is replaced in the test browser; rendering is never simulated.
test.beforeAll(async () => {
	root = await fs.mkdtemp(path.join(os.tmpdir(), 'nbt-render-'))
	const jar = path.join(root, 'mod.jar')
	await zip(jar, {
		...resources,
		'assets/demo/blockstates/pipe.json': JSON.stringify({ variants: { 'axis=x': { model: 'demo:block/pipe', x: 90, uvlock: true }, 'axis=y': { model: 'demo:block/pipe' } } }),
		'assets/demo/models/block/pipe.json': JSON.stringify({ ...cube, elements: [{ from: [5, 0, 5], to: [11, 16, 11], faces: cube.elements![0].faces }] }),
		'assets/demo/blockstates/slab.json': JSON.stringify({ variants: { '': { model: 'demo:block/slab' } } }),
		'assets/demo/models/block/slab.json': JSON.stringify({ ...cube, elements: [{ from: [0, 0, 0], to: [16, 8, 16], faces: cube.elements![0].faces }] }),
		'assets/demo/blockstates/custom.json': JSON.stringify({ variants: { '': { model: 'demo:block/custom' } } }),
		'assets/demo/models/block/custom.json': JSON.stringify({ loader: 'forge:obj' }),
		'assets/demo/blockstates/multipart.json': JSON.stringify({ multipart: [{ apply: { model: 'demo:block/pipe' } }, { when: { connected: 'true' }, apply: { model: 'demo:block/pipe', x: 90 } }] }),
	})
	await index.build(instance(root, [jar]))
	const editor = await fs.readFile(path.resolve('out/editor.js'))
	const css = await fs.readFile(path.resolve('res/editor.css'))
	server = createServer((req, res) => {
		if (req.url === '/editor.js') { res.setHeader('content-type', 'text/javascript'); res.end(editor); return }
		if (req.url === '/editor.css') { res.setHeader('content-type', 'text/css'); res.end(css); return }
		const model = { ...cube, textures: { all: 'minecraft:block/stone' } }
		const assets = { blockstates: { stone: { variants: { '': { model: 'minecraft:block/stone' } } } }, models: { 'block/stone': model } }
		res.setHeader('content-type', 'text/html; charset=utf-8')
		res.end(`<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' blob: data:; style-src 'self'; script-src 'nonce-test';"><link href="/editor.css" rel="stylesheet"><div class="panel-menu"></div><div class="find-widget"><div class="replace-expand"></div><div class="find-part"><div class="type-select"><select></select></div><input class="name-input"><input class="value-input"><div class="matches"></div><div class="previous-match"></div><div class="next-match"></div><div class="close-widget"></div></div><div class="replace-part"><div class="type-select"><select></select></div><input class="name-input"><input class="value-input"><div class="replace"></div><div class="replace-all"></div></div></div><div class="nbt-editor"></div><div class="file-info"></div><img class="texture-atlas" width="16" height="16" src="data:image/png;base64,${makePng([120, 120, 120, 255]).toString('base64')}"><script nonce="test">const stringifiedAssets=${JSON.stringify(JSON.stringify(assets))};const stringifiedBlocks=${JSON.stringify(JSON.stringify({ stone: [{}, {}] }))};const stringifiedUvmapping=${JSON.stringify(JSON.stringify({ 'block/stone': [0, 0, 16, 16] }))};</script><script nonce="test" src="/editor.js"></script>`)
	})
	await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
	url = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})
test.afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); await fs.rm(root, { recursive: true, force: true }) })

function structureFile() {
	// Use the actual Deepslate NBT classes, retaining properties in the palette.
	const palette = structure.getBlocks().map(b => new NbtCompound(new Map([['Name', new NbtString(b.state.getName().toString())], ['Properties', new NbtCompound(new Map(Object.entries(b.state.getProperties()).map(([k, v]) => [k, new NbtString(v)])))]])))
	const blocks = structure.getBlocks().map((b, i) => new NbtCompound(new Map([['pos', new NbtList(b.pos.map(n => new NbtInt(n)))], ['state', new NbtInt(i)]])))
	return new NbtFile('', new NbtCompound(new Map([['size', new NbtList([5, 2, 3].map(n => new NbtInt(n)))], ['palette', new NbtList(palette)], ['blocks', new NbtList(blocks)]])), 'none', false, undefined).toJson()
}

test('production WebGL viewer renders archive assets, fallback geometry, search and reload', async ({ page }, testInfo) => {
	const errors: string[] = []
	page.on('pageerror', error => errors.push(error.message))
	const content = structureFile()
	await page.exposeFunction('fixtureMessage', async (message: { type: string, body: { ids: string[], models: string[], textures: string[], generation: number } }) => {
		if (message.type === 'ready') await page.evaluate(content => window.postMessage({ type: 'init', body: { type: 'structure', readOnly: true, content } }, '*'), content)
		if (message.type === 'getResources') {
			const body = await index.bundle(message.body.ids, [1, 1, 1], () => false, message.body.models, message.body.textures)
			await page.evaluate(({ body, generation }) => window.postMessage({ type: 'resources', body, generation }, '*'), { body, generation: message.body.generation })
		}
	})
	await page.addInitScript(() => { (window as unknown as { acquireVsCodeApi: () => unknown }).acquireVsCodeApi = () => ({ postMessage: (message: unknown) => (window as unknown as { fixtureMessage: (m: unknown) => void }).fixtureMessage(message) }) })
	await page.goto(url)
	await expect(page.locator('.resource-status')).toContainText('resource warnings', { timeout: 30000 })
	await expect(page.locator('.structure-3d').first()).toBeVisible()
	const canvasPixels = await page.locator('canvas.structure-3d').first().evaluate((el: HTMLCanvasElement) => {
		const gl = el.getContext('webgl')!
		const pixels = new Uint8Array(el.width * el.height * 4)
		gl.readPixels(0, 0, el.width, el.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
		return { error: gl.getError(), width: el.width, height: el.height }
	})
	assertCanvas(canvasPixels)
	const screenshot = await page.screenshot({ path: testInfo.outputPath('modded-view.png') })
	const pixels = PNG.sync.read(screenshot).data
	let green = 0
	let magenta = 0
	for (let i = 0; i < pixels.length; i += 4) {
		if (pixels[i + 1] > 100 && pixels[i + 1] > pixels[i] * 2 && pixels[i + 1] > pixels[i + 2] * 2) green++
		if (pixels[i] > 100 && pixels[i + 2] > 100 && pixels[i + 1] < 20) magenta++
	}
	expect(green).toBeGreaterThan(100)
	expect(magenta).toBeGreaterThan(100)
	await page.mouse.click(545, 285)
	await expect(page.locator('.block-name')).toContainText('demo:missing')
	await expect(page.locator('.model-warning')).toContainText('missing static blockstate')
	await page.getByPlaceholder('Highlight namespace or block ID').fill('demo:pipe')
	await expect(page.getByPlaceholder('Highlight namespace or block ID')).toHaveAttribute('title', '1 matches')
	await page.getByText('Modded assets', { exact: true }).click()
	await expect(page.locator('.resource-status')).toHaveText('Vanilla assets only')
	await page.getByText('Modded assets', { exact: true }).click()
	await expect(page.locator('.resource-status')).toContainText('resource warnings')
	await page.getByText('Reload assets', { exact: true }).click()
	await expect(page.locator('.resource-status')).toContainText('resource warnings')
	await page.evaluate(() => window.postMessage({ type: 'resourcesChanged' }, '*'))
	await expect(page.locator('.resource-status')).toContainText('resource warnings')
	await page.getByText('Default', { exact: true }).click()
	await expect(page.locator('.nbt-editor')).toContainText('palette')
	await page.getByText('3D', { exact: true }).click()
	await expect(page.locator('.structure-3d').first()).toBeVisible()
	expect(errors).toEqual([])
})
function assertCanvas(value: { error: number, width: number, height: number }) { expect(value.error).toBe(0); expect(value.width).toBeGreaterThan(0); expect(value.height).toBeGreaterThan(0) }

