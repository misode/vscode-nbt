import { expect, test } from '@playwright/test'
import { promises as fs } from 'node:fs'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import * as os from 'node:os'
import * as path from 'node:path'
import { PNG } from 'pngjs'
import { NbtCompound, NbtFile, NbtInt, NbtList, NbtString, Structure } from 'deepslate'
import { mat4, vec3 } from 'gl-matrix'
import type { Page } from '@playwright/test'
import type { EditorMessage, NbtEdit } from '../../src/common/types'
import { applyEdit, reverseEdit } from '../../src/common/Operations'
import { createBlankStructure } from '../../src/editor/StructureEditing'
import { setStructureBlock } from '../../src/editor/StructureEditing'
import { ResourceIndex } from '../../src/assets/ResourceIndex'
import { cube, instance, makePng, resources, zip } from '../fixtures'

let root: string
let server: Server
let url: string
const index = new ResourceIndex()
const installedBlocks = ['create:andesite_casing', 'create:shaft', 'mekanism:steel_casing', 'mekanism:supercharged_coil', 'ae2:quartz_block', 'immersiveengineering:storage_steel', 'industrialforegoing:machine_frame_pity', 'bigreactors:reinforced_reactorfuelrod', 'mekanism:basic_induction_cell', 'mekanism:basic_induction_provider']
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
		'assets/demo/blockstates/glass.json': JSON.stringify({ variants: { '': { model: 'demo:block/glass' } } }),
		'assets/demo/models/block/glass.json': JSON.stringify({ ...cube, textures: { all: 'demo:block/glass' } }),
		'assets/demo/textures/block/glass.png': makePng([64, 64, 200, 100]),
		'assets/demo/blockstates/connected.json': JSON.stringify({ variants: { '': { model: 'demo:block/connected' } } }),
		'assets/demo/models/block/connected.json': JSON.stringify({ ...cube, textures: { all: 'demo:block/connected' } }),
		'assets/demo/textures/block/connected.png': makePng([200, 32, 32, 255]),
		'assets/demo/textures/block/connected.png.mcmeta': JSON.stringify({ ctm: { ctm_version: 1, type: 'CTM', textures: ['demo:ctm/connected'], extra: { connect_inside: true } } }),
		'assets/demo/textures/ctm/connected.png': makePng([32, 200, 32, 255]),
		'assets/demo/blockstates/rod.json': JSON.stringify({ variants: { '': { model: 'demo:block/rod' } } }),
		'assets/demo/models/block/rod.json': JSON.stringify({ ...cube, elements: [{ from: [6, 0, 6], to: [10, 16, 10], faces: cube.elements![0].faces }] }),
		'assets/demo/models/block/custom.json': JSON.stringify({ loader: 'forge:obj' }),
		'assets/demo/blockstates/multipart.json': JSON.stringify({ multipart: [{ apply: { model: 'demo:block/pipe' } }, { when: { connected: 'true' }, apply: { model: 'demo:block/pipe', x: 90 } }] }),
	})
	if (process.env.NBT_AE2_JAR) {
		const cable = new NbtCompound().set('cable', new NbtCompound().set('id', new NbtString('ae2:fluix_glass_cable')).set('visual', new NbtCompound().set('connections', new NbtList([new NbtString('south')]))))
		const cable2 = new NbtCompound().set('cable', new NbtCompound().set('id', new NbtString('ae2:blue_smart_cable')).set('visual', new NbtCompound().set('connections', new NbtList([new NbtString('north')])))).set('up', new NbtCompound().set('id', new NbtString('ae2:energy_acceptor')))
		structure.addBlock([4, 0, 0], 'ae2:cable_bus', {}, cable)
		structure.addBlock([4, 0, 1], 'ae2:cable_bus', {}, cable2)
	}
	const installedMods = process.env.NBT_MODS_DIR ? (await fs.readdir(process.env.NBT_MODS_DIR)).filter(name => /^(create-1|Mekanism-|appliedenergistics2-|ImmersiveEngineering-|industrialforegoing-|ExtremeReactors2-).*\.jar$/i.test(name)).map(name => path.join(process.env.NBT_MODS_DIR!, name)) : []
	await index.build(instance(root, [jar, ...installedMods, ...(process.env.NBT_AE2_JAR ? [process.env.NBT_AE2_JAR] : [])]))
	const editor = await fs.readFile(path.resolve(process.env.NBT_EDITOR_BUNDLE ?? 'out/editor.js'))
	const css = await fs.readFile(path.resolve('res/editor.css'))
	server = createServer((req, res) => {
		if (req.url === '/editor.js') { res.setHeader('content-type', 'text/javascript'); res.end(editor); return }
		if (req.url === '/editor.css') { res.setHeader('content-type', 'text/css'); res.end(css); return }
		const model = { ...cube, textures: { all: 'minecraft:block/stone' } }
		// White concrete intentionally has no property-summary entry, matching mcmeta.
		const assets = { blockstates: { stone: { variants: { '': { model: 'minecraft:block/stone' } } }, white_concrete: { variants: { '': { model: 'minecraft:block/stone' } } } }, models: { 'block/stone': model, 'block/block': {}, 'block/cube': model, 'block/cube_all': model, 'block/orientable': { ...cube, elements: [{ ...cube.elements![0], faces: Object.fromEntries(Object.keys(cube.elements![0].faces!).map(face => [face, { texture: `#${face === 'up' ? 'top' : face === 'down' ? 'bottom' : face === 'north' ? 'front' : 'side'}` }])) }] } } }
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
	const blocks = structure.getBlocks().map((b, i) => {
		const tag = new NbtCompound(new Map([['pos', new NbtList(b.pos.map(n => new NbtInt(n)))], ['state', new NbtInt(i)]]))
		if (b.nbt) tag.set('nbt', b.nbt)
		return tag
	})
	return new NbtFile('', new NbtCompound(new Map([['size', new NbtList([5, 2, 3].map(n => new NbtInt(n)))], ['palette', new NbtList(palette)], ['blocks', new NbtList(blocks)]])), 'none', false, undefined).toJson()
}

test('production WebGL viewer renders archive assets, fallback geometry, search and reload', async ({ page }, testInfo) => {
	const errors: string[] = []
	const ae2Loaded = new Set<string>()
	page.on('pageerror', error => errors.push(error.message))
	const content = structureFile()
	await page.exposeFunction('fixtureMessage', async (message: { type: string, body: { ids: string[], models: string[], textures: string[], generation: number } }) => {
		if (message.type === 'ready') await page.evaluate(content => window.postMessage({ type: 'init', body: { type: 'structure', readOnly: true, content } }, '*'), content)
		if (message.type === 'getResources') {
			const body = await index.bundle(message.body.ids, [1, 1, 1], () => false, message.body.models, message.body.textures)
			for (const id of Object.keys(body.models)) if (id.startsWith('nbtviewer:ae2/') || id === 'ae2:part/energy_acceptor') ae2Loaded.add(id)
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
	if (process.env.NBT_AE2_JAR) {
		expect(ae2Loaded.has('nbtviewer:ae2/ae2/glass/transparent/center')).toBe(true)
		expect(ae2Loaded.has('nbtviewer:ae2/ae2/smart/blue/connection')).toBe(true)
		expect(ae2Loaded.has('ae2:part/energy_acceptor')).toBe(true)
		await page.getByPlaceholder('Highlight namespace or block ID').fill('ae2:cable_bus')
		await expect(page.getByPlaceholder('Highlight namespace or block ID')).toHaveAttribute('title', '2 matches')
	}
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

async function editableFixture(page: Page, readOnly = false, size: [number, number, number] = [6, 4, 6], seed?: [number, number, number], initial?: NbtFile) {
	const file = initial ?? createBlankStructure(3465, size)
	if (seed) {
		const { setStructureBlock } = await import('../../src/editor/StructureEditing')
		applyEdit(file, setStructureBlock(file, seed, 'demo:casing', {}))
	}
	const edits: NbtEdit[] = []
	const messages: EditorMessage[] = []
	await page.exposeFunction('fixtureMessage', async (message: EditorMessage) => {
		messages.push(message)
		if (message.type === 'ready') await page.evaluate(body => window.postMessage({ type: 'init', body }, '*'), { type: 'structure', readOnly, content: file.toJson() })
		if (message.type === 'getResources') {
			const body = await index.bundle(message.body.ids, [1, 1, 1], () => false, message.body.models, message.body.textures)
			await page.evaluate(({ body, generation }) => window.postMessage({ type: 'resources', body, generation }, '*'), { body, generation: message.body.generation })
		}
		if (message.type === 'getBlockCatalog') {
			const { query, namespace, offset, generation } = message.body
			const body = index.catalog(query, namespace, offset)
			await page.evaluate(({ body, generation }) => window.postMessage({ type: 'blockCatalog', body, generation }, '*'), { body, generation })
		}
		if (message.type === 'getBlockOptions') {
			const body = await index.blockOptions(message.body.id)
			await page.evaluate(({ body, generation }) => window.postMessage({ type: 'blockOptions', body, generation }, '*'), { body, generation: message.body.generation })
		}
		if (message.type === 'edit') {
			edits.push(message.body)
			applyEdit(file, message.body)
			await page.evaluate(body => window.postMessage({ type: 'update', body }, '*'), message.body)
		}
	})
	await page.addInitScript(() => { (window as unknown as { acquireVsCodeApi: () => unknown }).acquireVsCodeApi = () => ({ postMessage: (message: unknown) => (window as unknown as { fixtureMessage: (m: unknown) => void }).fixtureMessage(message) }) })
	await page.goto(url)
	await expect(page.locator('.resource-status')).toHaveText('Instance resources loaded')
	return { file, edits, messages }
}
function screenPoint(point: [number, number, number], size: [number, number, number]): [number, number] {
	const center = size.map(n => -n / 2) as [number, number, number]
	const distance = Math.hypot(...center) * 1.5
	const view = mat4.create()
	mat4.translate(view, view, [0, 0, -distance]); mat4.rotateX(view, view, 0.6); mat4.rotateY(view, view, 0.4); mat4.translate(view, view, center)
	const clip = vec3.transformMat4(vec3.create(), point, mat4.multiply(mat4.create(), mat4.perspective(mat4.create(), 70 * Math.PI / 180, 1000 / 700, 0.1, 500), view))
	return [(clip[0] + 1) * 500, (1 - clip[1]) * 350]
}

test('installed models from six mods render and can be built in the same structure', async ({ page }, testInfo) => {
	test.skip(!process.env.NBT_MODS_DIR, 'Set NBT_MODS_DIR to a local mods directory; mod assets are not redistributed.')
	const errors: string[] = []
	page.on('pageerror', e => errors.push(e.message))
	page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
	const { file } = await editableFixture(page, false, [12, 3, 4])
	await page.getByRole('button', { name: 'Build', exact: true }).click()
	for (const [x, id] of installedBlocks.entries()) {
		await page.getByPlaceholder('Find a block to place').fill(id)
		await page.locator(`[data-block="${id}"]`).click()
		await expect(page.getByRole('button', { name: 'Set block at coordinates', exact: true })).toBeEnabled()
		await page.getByLabel('Build X', { exact: true }).fill(String(x))
		await page.getByLabel('Build Z', { exact: true }).fill('1')
		await page.getByRole('button', { name: 'Set block at coordinates', exact: true }).click()
		await expect.poll(() => Structure.fromNbt(file.root).getBlock([x, 0, 1])?.state.getName().toString()).toBe(id)
		await expect(page.locator('.resource-status')).toHaveText('Instance resources loaded')
	}
	const reopened = Structure.fromNbt(NbtFile.read(file.write()).root)
	for (const [x, id] of installedBlocks.entries()) expect(reopened.getBlock([x, 0, 1])?.state.getName().toString()).toBe(id)
	await page.getByRole('button', { name: 'Build', exact: true }).click()
	await expect(page.locator('.resource-status')).toHaveText('Instance resources loaded')
	await page.screenshot({ path: testInfo.outputPath('six-mods.png') })
	expect(errors).toEqual([])
})

test('connected texture toggle changes joined faces and keeps edits reversible', async ({ page }, testInfo) => {
	const file = createBlankStructure(3465, [4, 3, 4])
	applyEdit(file, setStructureBlock(file, [1, 0, 1], 'demo:connected', {}))
	applyEdit(file, setStructureBlock(file, [2, 0, 1], 'demo:connected', {}))
	await editableFixture(page, true, [4, 3, 4], undefined, file)
	const toggle = page.getByRole('button', { name: 'Connected textures', exact: true })
	const canvas = page.locator('canvas.structure-3d').first()
	await expect(toggle).toHaveAttribute('aria-pressed', 'true')
	const joined = PNG.sync.read(await canvas.screenshot({ path: testInfo.outputPath('connected-textures.png') }))
	await toggle.click()
	await expect(toggle).toHaveAttribute('aria-pressed', 'false')
	const plain = PNG.sync.read(await canvas.screenshot())
	expect(plain.data.equals(joined.data)).toBe(false)
	await toggle.click()
	expect(PNG.sync.read(await canvas.screenshot()).data.equals(joined.data)).toBe(true)
	expect(file.root.getList('blocks').length).toBe(2)
})

test('glass cannot hide rods behind it and rendering is independent of NBT block order', async ({ page }, testInfo) => {
	const file = createBlankStructure(3465, [4, 3, 4])
	// Put glass first, before the interior geometry, as exported structures can do.
	applyEdit(file, setStructureBlock(file, [1, 0, 2], 'demo:glass', {}))
	applyEdit(file, setStructureBlock(file, [1, 0, 1], 'demo:rod', {}))
	applyEdit(file, setStructureBlock(file, [1, 1, 1], 'demo:rod', {}))
	await editableFixture(page, true, [4, 3, 4], undefined, file)
	const canvas = page.locator('canvas.structure-3d').first()
	const first = PNG.sync.read(await canvas.screenshot({ path: testInfo.outputPath('rods-behind-glass.png') }))
	let green = 0
	for (let i = 0; i < first.data.length; i += 4) if (first.data[i + 1] > 70 && first.data[i + 1] > first.data[i] * 1.5 && first.data[i + 1] > first.data[i + 2] * 1.5) green++
	expect(green).toBeGreaterThan(100)
	const blocks = file.root.getList('blocks')
	file.root.set('blocks', new NbtList([...blocks.getItems()].reverse()))
	await page.reload()
	await expect(page.locator('.resource-status')).toHaveText('Instance resources loaded')
	const reversed = PNG.sync.read(await canvas.screenshot())
	expect(reversed.data.equals(first.data)).toBe(true)
})

test('propertyless vanilla blocks appear in Build and can be placed and saved without a client JAR', async ({ page }) => {
	const { file, messages } = await editableFixture(page)
	await page.getByRole('button', { name: 'Build', exact: true }).click()
	await page.getByPlaceholder('Find a block to place').fill('minecraft:white_concrete')
	await page.locator('[data-block="minecraft:white_concrete"]').click()
	await expect(page.getByRole('button', { name: 'Set block at coordinates', exact: true })).toBeEnabled()
	await page.getByRole('button', { name: 'Set block at coordinates', exact: true }).click()
	await expect.poll(() => Structure.fromNbt(file.root).getBlock([0, 0, 0])?.state.getName().toString()).toBe('minecraft:white_concrete')
	expect(Structure.fromNbt(NbtFile.read(file.write()).root).getBlock([0, 0, 0])?.state.getName().toString()).toBe('minecraft:white_concrete')
	expect(messages.filter(m => m.type === 'getBlockOptions' && m.body.id === 'minecraft:white_concrete')).toHaveLength(0)
})

test('build tools place from the mod list, edit properties, save/reopen, undo and erase', async ({ page }, testInfo) => {
	const { file, edits } = await editableFixture(page)
	await page.getByRole('button', { name: 'Build', exact: true }).click()
	await expect(page.locator('.block-builder')).toBeVisible()
	await page.getByPlaceholder('Find a block to place').fill('demo:pipe')
	await page.locator('[data-block="demo:pipe"]').click()
	await page.getByLabel('Block property axis', { exact: true }).selectOption('x')
	await page.getByLabel('Build X', { exact: true }).fill('2')
	await page.getByLabel('Build Z', { exact: true }).fill('1')
	await page.getByRole('button', { name: 'Set block at coordinates', exact: true }).click()
	await expect.poll(() => file.root.getList('blocks').length).toBe(1)
	await expect(page.locator('.builder-status')).toContainText('Block changed')
	const reopened = NbtFile.read(file.write())
	expect(Structure.fromNbt(reopened.root).getBlock([2, 0, 1])?.state.toString()).toContain('axis=x')
	const undo = reverseEdit(edits[0]); applyEdit(file, undo)
	await page.evaluate(body => window.postMessage({ type: 'update', body }, '*'), undo)
	await expect.poll(() => file.root.getList('blocks').length).toBe(0)
	applyEdit(file, edits[0]); await page.evaluate(body => window.postMessage({ type: 'update', body }, '*'), edits[0])
	await expect(page.locator('.block-name')).toHaveText('demo:pipe')
	await page.getByRole('button', { name: 'Remove at coordinates', exact: true }).click()
	await expect.poll(() => file.root.getList('blocks').length).toBe(0)
	await expect(page.getByRole('button', { name: 'Set block at coordinates', exact: true })).toBeEnabled()
	await page.getByLabel('Build X', { exact: true }).fill('6')
	await page.getByRole('button', { name: 'Set block at coordinates', exact: true }).click()
	await expect(page.locator('.builder-status')).toContainText('outside the structure')
	expect(file.root.getList('blocks').length).toBe(0)
	await page.getByPlaceholder('Find a block to place').fill('demo:casing')
	await page.locator('[data-block="demo:casing"]').click()
	await expect(page.getByRole('button', { name: 'Set block at coordinates', exact: true })).toBeEnabled()
	await page.mouse.click(...screenPoint([1.5, 0, 1.5], [6, 4, 6]))
	await expect.poll(() => Structure.fromNbt(file.root).getBlock([1, 0, 1])?.state.getName().toString()).toBe('demo:casing')
	await expect(page.locator('.resource-status')).toHaveText('Instance resources loaded')
	await page.mouse.click(...screenPoint([1.5, 1, 1.5], [6, 4, 6]))
	await expect.poll(() => Structure.fromNbt(file.root).getBlock([1, 1, 1])?.state.getName().toString()).toBe('demo:casing')
	await expect(page.locator('.resource-status')).toHaveText('Instance resources loaded')
	await page.screenshot({ path: testInfo.outputPath('build-tools.png') })
	await page.getByRole('button', { name: 'Erase', exact: true }).click()
	await page.mouse.click(...screenPoint([1.5, 2, 1.5], [6, 4, 6]))
	await expect.poll(() => file.root.getList('blocks').length).toBe(1)
})

test('camera movement and dragging stop on focus loss, cancellation and leaving the 3D panel', async ({ page }) => {
	await editableFixture(page)
	const canvas = page.locator('canvas.structure-3d').first()
	await canvas.focus()
	await page.keyboard.down('w')
	await page.waitForTimeout(80)
	await page.evaluate(() => window.dispatchEvent(new Event('blur')))
	await page.waitForTimeout(80)
	const before = await page.screenshot()
	await page.waitForTimeout(160)
	expect(PNG.sync.read(await page.screenshot()).data.equals(PNG.sync.read(before).data)).toBe(true)
	await page.keyboard.up('w')
	await canvas.focus(); await page.keyboard.down('w')
	await page.getByPlaceholder('Highlight namespace or block ID').focus()
	await page.waitForTimeout(80)
	const input = await page.screenshot()
	await page.waitForTimeout(160)
	expect(PNG.sync.read(await page.screenshot()).data.equals(PNG.sync.read(input).data)).toBe(true)
	await page.keyboard.up('w')
	await page.mouse.move(450, 300); await page.mouse.down(); await page.mouse.move(480, 320)
	await page.evaluate(() => document.querySelector('canvas.structure-3d')!.dispatchEvent(new PointerEvent('pointercancel')))
	await page.waitForTimeout(80)
	const cancelled = await page.screenshot()
	await page.mouse.move(550, 360); await page.waitForTimeout(80)
	expect(PNG.sync.read(await page.screenshot()).data.equals(PNG.sync.read(cancelled).data)).toBe(true)
	await page.mouse.up()
	await canvas.focus(); await page.keyboard.down('w')
	await page.getByText('Default', { exact: true }).click(); await page.keyboard.up('w')
	await page.getByText('3D', { exact: true }).click()
	await page.waitForTimeout(80)
	const returned = await page.screenshot(); await page.waitForTimeout(160)
	expect(PNG.sync.read(await page.screenshot()).data.equals(PNG.sync.read(returned).data)).toBe(true)
})

test('read-only documents expose the block list but cannot place or remove blocks', async ({ page }) => {
	const { edits } = await editableFixture(page, true)
	await page.getByRole('button', { name: 'Build', exact: true }).click()
	await expect(page.getByRole('button', { name: 'Place', exact: true })).toBeDisabled()
	await expect(page.getByRole('button', { name: 'Set block at coordinates', exact: true })).toBeDisabled()
	await expect(page.locator('.builder-status')).toContainText('read-only')
	expect(edits).toHaveLength(0)
})

test('builder caches properties, skips identical edits and refreshes safely after a pack change while hidden', async ({ page }) => {
	const { file, edits, messages } = await editableFixture(page)
	await page.getByRole('button', { name: 'Build', exact: true }).click()
	await page.getByPlaceholder('Find a block to place').fill('demo:pipe')
	const pipe = page.locator('[data-block="demo:pipe"]')
	await pipe.click()
	await expect(page.getByLabel('Block property axis', { exact: true })).toBeVisible()
	await pipe.click()
	expect(messages.filter(m => m.type === 'getBlockOptions')).toHaveLength(1)
	await page.getByRole('button', { name: 'Set block at coordinates', exact: true }).click()
	await expect.poll(() => file.root.getList('blocks').length).toBe(1)
	await expect(page.locator('.builder-status')).toContainText('Block changed')
	await page.getByRole('button', { name: 'Set block at coordinates', exact: true }).click()
	await expect(page.locator('.builder-status')).toContainText('No changes needed')
	expect(edits).toHaveLength(1)
	await page.getByText('Default', { exact: true }).click()
	await page.evaluate(() => window.postMessage({ type: 'resourcesChanged' }, '*'))
	await page.getByText('3D', { exact: true }).click()
	await expect(pipe).toBeVisible()
	await expect(page.getByRole('button', { name: 'Set block at coordinates', exact: true })).toBeDisabled()
	await pipe.click()
	await expect(page.getByRole('button', { name: 'Set block at coordinates', exact: true })).toBeEnabled()
	expect(messages.filter(m => m.type === 'getBlockOptions')).toHaveLength(2)
})

test('GPU picking erases the actual block at a quantized high coordinate', async ({ page }) => {
	const size: [number, number, number] = [140, 4, 6]
	const { file } = await editableFixture(page, false, size, [129, 0, 1])
	await page.mouse.click(...screenPoint([129.5, 1, 1.5], size))
	await expect(page.locator('.block-pos')).toHaveText('129 0 1')
	await page.getByRole('button', { name: 'Build', exact: true }).click()
	await page.getByRole('button', { name: 'Remove at coordinates', exact: true }).click()
	await expect.poll(() => file.root.getList('blocks').length).toBe(0)
})

