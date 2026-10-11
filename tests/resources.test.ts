import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { after, before, test } from 'node:test'
import { discoverInstances, inspectInstance, launcherRoots } from '../src/assets/Instances'
import { ResourceIndex } from '../src/assets/ResourceIndex'
import { LIMITS, resourceId, safeAssetPath } from '../src/assets/Types'
import { chooseVariants, flattenModels, validateBlockstate, validateModel } from '../src/assets/Validation'
import { cube, instance, png, resources, zip } from './fixtures'

let root: string
before(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'nbt-resources-')) })
after(() => fs.rm(root, { recursive: true, force: true }))

test('launcher roots use platform-specific separators and XDG locations', () => {
	for (const platform of ['win32', 'linux', 'darwin'] as const) {
		const roots = launcherRoots({ platform, home: platform === 'win32' ? 'C:\\Users\\Player' : '/home/player', env: {} })
		assert.equal(new Set(roots.map(r => r.launcher)).size, 7)
		assert.ok(roots.some(r => r.directory.includes(platform === 'win32' ? '\\PrismLauncher\\instances' : '/PrismLauncher/instances')))
	}
	assert.ok(launcherRoots({ platform: 'linux', home: '/x', env: { XDG_DATA_HOME: '/data' } }).some(r => r.directory === '/data/PrismLauncher/instances'))
})
test('Prism instance metadata, installed JARs, enabled pack order and custom roots', async () => {
	const base = path.join(root, 'instances', 'Pack')
	const mc = path.join(base, '.minecraft')
	await fs.mkdir(path.join(mc, 'mods'), { recursive: true })
	await fs.mkdir(path.join(mc, 'resourcepacks'), { recursive: true })
	await fs.writeFile(path.join(base, 'mmc-pack.json'), JSON.stringify({ components: [{ uid: 'net.minecraft', version: '1.20.1' }, { uid: 'net.fabricmc.fabric-loader', version: '0.15.0' }] }))
	await zip(path.join(mc, 'mods', 'demo.jar'), resources)
	await fs.writeFile(path.join(mc, 'mods', 'disabled.jar.disabled'), '')
	await zip(path.join(mc, 'resourcepacks', 'enabled.zip'), {})
	await zip(path.join(mc, 'resourcepacks', 'disabled.zip'), {})
	await fs.writeFile(path.join(mc, 'options.txt'), 'resourcePacks:["vanilla","file/enabled.zip"]')
	const result = await inspectInstance(base)
	assert.equal(result?.loader, 'fabric')
	assert.equal(result?.version, '1.20.1')
	assert.equal(result?.mods.length, 1)
	assert.equal(path.basename(result!.resourcePacks[0]), 'enabled.zip')
	const discovered = await discoverInstances({ home: path.join(root, 'empty-home'), env: {}, customPaths: [path.join(root, 'instances')] })
	assert.equal(discovered.length, 1)
	assert.equal(discovered[0].directory, mc)
})
test('indexes compressed JARs and cross-namespace parent dependencies without extraction', async () => {
	const file = path.join(root, 'index', 'demo.jar')
	await zip(file, resources)
	const index = new ResourceIndex()
	await index.build(instance(root, [file]))
	assert.deepEqual(index.stats.namespaces, ['demo', 'other'])
	assert.equal(index.stats.cacheEntries, 0)
	const bundle = await index.bundle(['demo:casing'])
	assert.ok(bundle.blockstates['demo:casing'])
	assert.ok(bundle.models['other:block/base'])
	assert.equal(bundle.textures['demo:block/casing'], png.toString('base64'))
	const before = index.stats.hits
	await index.bundle(['demo:casing'])
	assert.ok(index.stats.hits > before)
	assert.ok(index.stats.cacheBytes <= LIMITS.cacheBytes)
})

test('separate mods share parents and textures, preserve IDs, and accept signed quarter-turns', async () => {
	const a = path.join(root, 'multiple', 'alpha.jar'), b = path.join(root, 'multiple', 'beta.jar')
	await zip(a, {
		'assets/alpha/blockstates/machine.json': JSON.stringify({ variants: { 'facing=up': { model: 'alpha:block/machine', x: -90 }, 'facing=west': { model: 'alpha:block/machine', y: -450 } } }),
		'assets/alpha/models/block/machine.json': JSON.stringify({ parent: 'beta:block/base', textures: { all: 'alpha:block/skin' } }),
		'assets/alpha/textures/block/skin.png': png,
	})
	await zip(b, {
		'assets/beta/blockstates/machine.json': JSON.stringify({ variants: { '': { model: 'beta:block/base' } } }),
		'assets/beta/models/block/base.json': JSON.stringify({ ...cube, textures: { all: 'beta:block/skin' } }),
		'assets/beta/textures/block/skin.png': png,
	})
	const index = new ResourceIndex()
	await index.build(instance(root, [a, b]))
	assert.deepEqual(index.catalog('machine', '', 0).ids, ['alpha:machine', 'beta:machine'])
	assert.deepEqual(index.catalog('', 'beta', 0).ids, ['beta:machine'])
	const bundle = await index.bundle(['alpha:machine', 'beta:machine'])
	assert.deepEqual(bundle.diagnostics, [])
	assert.equal(chooseVariants(bundle.blockstates['alpha:machine'], { facing: 'up' }, 0)[0].x, 270)
	assert.equal(chooseVariants(bundle.blockstates['alpha:machine'], { facing: 'west' }, 0)[0].y, 270)
	const errors: string[] = []
	const flat = flattenModels(bundle.models, (_, message) => errors.push(message))
	assert.deepEqual(errors, [])
	assert.equal(flat['alpha:block/machine'].elements?.[0].faces?.up.texture, 'alpha:block/skin')
	assert.equal(flat['beta:block/base'].elements?.[0].faces?.up.texture, 'beta:block/skin')
	assert.throws(() => validateBlockstate({ variants: { '': { model: 'beta:block/base', y: 45 } } }))
	assert.throws(() => validateBlockstate({ variants: { '': { model: 'beta:block/base', x: Infinity } } }))
	const reads = index.stats.archivesRead
	await index.build(instance(root, [a, b]))
	assert.equal(index.stats.archivesRead, reads)
	assert.equal(index.stats.archivesReused, 2)
})
test('loader discovery reads ZIP metadata, not mod code', async () => {
	for (const [metadata, loader] of [['fabric.mod.json', 'fabric'], ['quilt.mod.json', 'quilt'], ['META-INF/mods.toml', 'forge'], ['META-INF/neoforge.mods.toml', 'neoforge']]) {
		const directory = path.join(root, loader)
		await zip(path.join(directory, 'mods', 'example.jar'), { [metadata]: '{}', 'DO_NOT_EXECUTE.class': 'not executable code' })
		assert.equal((await inspectInstance(directory))?.loader, loader)
	}
})
test('sprite texture objects and missing aliases are handled explicitly', () => {
	const errors: string[] = []
	const models = flattenModels({ 'demo:sprite': { ...cube, textures: { all: { sprite: 'demo:block/casing' } } }, 'demo:missing': { ...cube, textures: {} } }, (_, message) => errors.push(message))
	assert.equal(models['demo:sprite'].elements?.[0].faces?.up.texture, 'demo:block/casing')
	assert.ok(errors.some(s => s.includes('Missing texture alias')))
})
test('last resource pack wins, including directory packs', async () => {
	const directory = path.join(root, 'overrides')
	const mod = path.join(directory, 'mod.jar')
	const low = path.join(directory, 'low.zip')
	const high = path.join(directory, 'high')
	await zip(mod, resources)
	await zip(low, { 'assets/demo/models/block/casing.json': JSON.stringify({ ...cube, textures: { all: 'demo:block/low' } }) })
	await fs.mkdir(path.join(high, 'assets', 'demo', 'models', 'block'), { recursive: true })
	await fs.writeFile(path.join(high, 'assets', 'demo', 'models', 'block', 'casing.json'), JSON.stringify({ ...cube, textures: { all: 'demo:block/high' } }))
	const index = new ResourceIndex()
	await index.build(instance(directory, [mod], [low]), [high])
	assert.equal((await index.bundle(['demo:casing'])).models['demo:block/casing'].textures?.all, 'demo:block/high')
})
test('variant empty keys, properties, weighted determinism and multipart AND/OR', () => {
	assert.equal(chooseVariants(validateBlockstate({ variants: { '': { model: 'demo:block/one' } } }), {}, 123)[0].model, 'demo:block/one')
	const state = validateBlockstate({ variants: { 'facing=north,open=true': [{ model: 'demo:block/a', weight: 1 }, { model: 'demo:block/b', weight: 3 }] } })
	assert.deepEqual(chooseVariants(state, { facing: 'north', open: 'true' }, 44), chooseVariants(state, { facing: 'north', open: 'true' }, 44))
	assert.equal(chooseVariants(state, { facing: 'south' }, 0).length, 0)
	assert.equal(new Set(Array.from({ length: 50 }, (_, i) => chooseVariants(state, { facing: 'north', open: 'true' }, i)[0].model)).size, 2)
	const multipart = validateBlockstate({ multipart: [{ apply: { model: 'demo:block/base' } }, { when: { AND: [{ OR: [{ axis: 'x|z' }, { powered: 'true' }] }, { connected: 'true' }] }, apply: { model: 'demo:block/pipe' } }] })
	assert.equal(chooseVariants(multipart, { axis: 'z', connected: 'true' }, 0).length, 2)
	assert.equal(chooseVariants(multipart, { axis: 'y', connected: 'true' }, 0).length, 1)
})
test('parent inheritance, child aliases and explicit face textures', () => {
	const errors: string[] = []
	const result = flattenModels({ 'demo:parent': cube, 'demo:child': { parent: 'demo:parent', textures: { all: '#side', side: 'other:block/texture' } } }, (_, message) => errors.push(message))
	assert.equal(result['demo:child'].elements?.[0].faces?.up.texture, 'other:block/texture')
	assert.equal(errors.length, 0)
	assert.equal(flattenModels({ 'demo:direct': { ...cube, elements: [{ from: [0, 0, 0], to: [4, 16, 4], faces: { up: { texture: 'other:block/direct' } } }] } }, () => {})['demo:direct'].elements?.[0].faces?.up.texture, 'other:block/direct')
})
test('inheritance and alias cycles, malformed geometry and custom loaders fail safely', () => {
	const errors: string[] = []
	const result = flattenModels({ 'demo:a': { parent: 'demo:b' }, 'demo:b': { parent: 'demo:a' }, 'demo:alias': { ...cube, textures: { all: '#all' } }, 'demo:custom': { loader: 'forge:obj' } }, (id, message) => errors.push(`${id}: ${message}`))
	assert.equal(Object.keys(result).length, 0)
	assert.equal(errors.length, 4)
	assert.throws(() => validateModel({ elements: [{ from: [NaN, 0, 0], to: [16, 16, 16] }] }))
	assert.throws(() => validateModel({ elements: [{ from: [0, 0, 0], to: [16, 16, 16], faces: { up: { texture: '#a', rotation: 12 } } }] }))
	assert.throws(() => validateBlockstate({ multipart: [{ when: { OR: 'bad' }, apply: { model: 'demo:a' } }] }))
})
test('missing and malformed resources produce actionable diagnostics', async () => {
	const jar = path.join(root, 'bad', 'mod.jar')
	await zip(jar, { ...resources, 'assets/demo/blockstates/broken.json': '{oops', 'assets/demo/models/block/casing.json': JSON.stringify({ ...cube, textures: { all: 'demo:block/missing' } }) })
	const index = new ResourceIndex()
	await index.build(instance(root, [jar]))
	const bundle = await index.bundle(['demo:broken', 'demo:unknown', 'demo:casing'])
	assert.ok(bundle.diagnostics.some(d => d.includes('broken')))
	assert.ok(bundle.diagnostics.some(d => d.includes('unknown')))
	assert.ok(bundle.diagnostics.some(d => d.includes('missing texture')))
})
test('resource IDs and ZIP entries reject traversal and oversized decompression', async () => {
	assert.throws(() => resourceId('demo:../file'))
	assert.throws(() => resourceId('C:\\file'))
	assert.equal(safeAssetPath('assets/demo/textures/../../outside.png'), false)
	const jar = path.join(root, 'unsafe', 'mod.jar')
	await zip(jar, { 'assets/demo/models/large.json': Buffer.alloc(LIMITS.resourceBytes + 1), 'assets/demo/models/../../escape.json': '{}' })
	const index = new ResourceIndex()
	await index.build(instance(root, [jar]))
	assert.equal(index.stats.resources, 0)
	assert.ok(index.diagnostics.length)
})
test('cache invalidates on archive and directory resource changes; cancellation is honored', async () => {
	const jar = path.join(root, 'changed', 'mod.jar')
	await zip(jar, resources)
	const index = new ResourceIndex()
	await index.build(instance(root, [jar]))
	assert.equal(await index.changed(), false)
	await zip(jar, { ...resources, 'assets/demo/blockstates/new.json': '{}' })
	assert.equal(await index.changed(), true)
	assert.ok((await index.bundle(['demo:casing'])).diagnostics.some(d => d.includes('Resource changed')))
	await index.build(instance(root, [jar]))
	assert.equal(index.stats.cacheEntries, 0)
	await assert.rejects(() => index.bundle(['demo:casing'], [1, 1, 1], () => true), /Obsolete/)
	index.clear()
	assert.equal(index.stats.resources, 0)
})
test('directory pack changes invalidate cached resources and vanilla texture overrides are selectable', async () => {
	const pack = path.join(root, 'directory-pack')
	const file = path.join(pack, 'assets', 'minecraft', 'textures', 'block', 'stone.png')
	await fs.mkdir(path.dirname(file), { recursive: true })
	await fs.writeFile(file, png)
	const index = new ResourceIndex()
	await index.build(instance(root), [pack])
	const bundle = await index.bundle(['minecraft:stone'], [1, 1, 1], () => false, [], ['minecraft:block/stone'])
	assert.equal(bundle.textures['minecraft:block/stone'], png.toString('base64'))
	await fs.writeFile(file, Buffer.concat([png, Buffer.from('changed')]))
	assert.equal(await index.changed(), true)
})
