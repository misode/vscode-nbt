import assert from 'node:assert/strict'
import { test } from 'node:test'
import { promises as fs } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { NbtCompound, NbtFile, NbtInt, NbtString, Structure } from 'deepslate'
import { applyEdit, reverseEdit } from '../src/common/Operations'
import { blockOptions } from '../src/assets/BlockOptions'
import { ResourceIndex } from '../src/assets/ResourceIndex'
import { canBuildStructure, createBlankStructure, intersectBox, removeStructureBlock, resolveColorPick, setStructureBlock } from '../src/editor/StructureEditing'
import { cube, instance, png, zip } from './fixtures'

test('a new blank structure accepts placements, saves gzip NBT, and reverses the whole first placement', () => {
	const file = createBlankStructure(3465, [4, 3, 4])
	const original = file.toJson()
	const edit = setStructureBlock(file, [1, 0, 2], 'demo:pipe', { axis: 'x' })
	assert.deepEqual(file.toJson(), original, 'building an edit must not mutate the open file')
	applyEdit(file, edit)
	const saved = NbtFile.read(file.write())
	assert.equal(saved.compression, 'gzip')
	assert.equal(saved.root.getNumber('DataVersion'), 3465)
	const structure = Structure.fromNbt(saved.root)
	assert.equal(structure.getBlock([1, 0, 2])?.state.getName().toString(), 'demo:pipe')
	assert.equal(structure.getBlock([1, 0, 2])?.state.getProperty('axis'), 'x')
	applyEdit(file, reverseEdit(edit))
	assert.deepEqual(file.toJson(), original)
	applyEdit(file, edit)
	assert.equal(file.root.getList('blocks').length, 1)
})
test('palette entries are reused and replacement/removal preserve reversible block entity data', () => {
	const file = createBlankStructure(3465)
	applyEdit(file, setStructureBlock(file, [0, 0, 0], 'demo:machine', { facing: 'north' }))
	applyEdit(file, setStructureBlock(file, [1, 0, 0], 'demo:machine', { facing: 'north' }))
	assert.equal(file.root.getList('palette').length, 1)
	file.root.getList('blocks').getCompound(0).set('nbt', new NbtCompound().set('contents', new NbtString('Keep me')))
	const rotated = setStructureBlock(file, [0, 0, 0], 'demo:machine', { facing: 'east' })
	applyEdit(file, rotated)
	assert.equal(file.root.getList('blocks').getCompound(0).getCompound('nbt').getString('contents'), 'Keep me')
	const replace = setStructureBlock(file, [0, 0, 0], 'minecraft:stone', {})
	applyEdit(file, replace)
	assert.equal(file.root.getList('blocks').length, 2)
	assert.equal(file.root.getList('blocks').getCompound(0).has('nbt'), false)
	applyEdit(file, reverseEdit(replace))
	assert.equal(file.root.getList('blocks').getCompound(0).getCompound('nbt').getString('contents'), 'Keep me')
	const remove = removeStructureBlock(file, [0, 0, 0])!
	applyEdit(file, remove)
	assert.equal(file.root.getList('blocks').length, 1)
	applyEdit(file, reverseEdit(remove))
	assert.equal(file.root.getList('blocks').getCompound(0).getCompound('nbt').getString('contents'), 'Keep me')
	assert.equal(removeStructureBlock(file, [10, 0, 10]), undefined)
})
test('AE2 cable brushes create cable-bus NBT and preserve attachments when recolouring', () => {
	const file = createBlankStructure(3465)
	applyEdit(file, setStructureBlock(file, [0, 0, 0], 'ae2:fluix_glass_cable', {}))
	let block = file.root.getList('blocks').getCompound(0)
	assert.equal(file.root.getList('palette').getCompound(0).getString('Name'), 'ae2:cable_bus')
	assert.equal(block.getCompound('nbt').getCompound('cable').getString('id'), 'ae2:fluix_glass_cable')
	block.getCompound('nbt').set('up', new NbtCompound().set('id', new NbtString('ae2:energy_acceptor')))
	block.getCompound('nbt').getCompound('cable').set('custom', new NbtString('Preserve cable configuration'))
	applyEdit(file, setStructureBlock(file, [0, 0, 0], 'ae2:blue_smart_cable', {}))
	block = file.root.getList('blocks').getCompound(0)
	assert.equal(block.getCompound('nbt').getCompound('up').getString('id'), 'ae2:energy_acceptor')
	assert.equal(block.getCompound('nbt').getCompound('cable').getString('id'), 'ae2:blue_smart_cable')
	assert.equal(block.getCompound('nbt').getCompound('cable').getString('custom'), 'Preserve cable configuration')
	assert.deepEqual(setStructureBlock(file, [0, 0, 0], 'ae2:blue_smart_cable', {}), { type: 'composite', edits: [] })
})
test('unsupported formats, unsafe IDs, invalid properties and out-of-bounds positions cannot change a structure', () => {
	const file = createBlankStructure(3465, [2, 2, 2])
	const before = file.toJson()
	for (const pos of [[-1, 0, 0], [2, 0, 0], [0.5, 0, 0], [NaN, 0, 0]] as [number, number, number][]) assert.throws(() => setStructureBlock(file, pos, 'demo:block', {}))
	assert.throws(() => setStructureBlock(file, [0, 0, 0], 'demo:../block', {}))
	assert.throws(() => setStructureBlock(file, [0, 0, 0], 'demo:block', { axis: 'bad value' }))
	assert.deepEqual(file.toJson(), before)
	file.root.set('palettes', new NbtInt(1))
	assert.equal(canBuildStructure(file), false)
	assert.throws(() => setStructureBlock(file, [0, 0, 0], 'demo:block', {}))
})
test('block options derive variant and multipart property choices without running mod code', () => {
	const options = blockOptions('demo:block', { variants: { 'axis=z,facing=north': { model: 'demo:model' }, 'axis=x,facing=east': { model: 'demo:model' } } })
	assert.deepEqual(options.properties.axis, ['z', 'x'])
	assert.equal(options.defaults.axis, 'z')
	assert.equal(options.defaults.facing, 'north')
	const multipart = blockOptions('demo:pipe', { multipart: [{ when: { OR: [{ north: 'true|false' }, { south: 'true' }] }, apply: { model: 'demo:model' } }] })
	assert.deepEqual(multipart.properties.north, ['true', 'false'])
})
test('catalog pagination, namespaces and AE2 brushes use the selected archive and refresh on reload', async () => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nbt-catalog-'))
	try {
		const jar = path.join(root, 'mod.jar')
		const entries: Record<string, string | Buffer> = Object.fromEntries(Array.from({ length: 205 }, (_, i) => [`assets/demo/blockstates/block_${String(i).padStart(3, '0')}.json`, JSON.stringify({ variants: { 'axis=x': { model: 'demo:model' } } })]))
		entries['assets/ae2/blockstates/cable_bus.json'] = '{"variants":{"":{"model":"ae2:block/cable_bus"}}}'
		entries['assets/ae2/models/part/cable/glass/center.json'] = JSON.stringify(cube)
		entries['assets/ae2/textures/part/cable/glass/transparent.png'] = png
		await zip(jar, entries)
		const index = new ResourceIndex()
		await index.build(instance(root, [jar]))
		assert.equal(index.catalog('', 'demo', 0).ids.length, 100)
		assert.equal(index.catalog('', 'demo', 200).ids.length, 5)
		assert.equal(index.catalog('', 'demo', 0).total, 205)
		assert.deepEqual(index.catalog('', '', 0).namespaces, ['ae2', 'demo'])
		const page = index.catalog('BLOCK_', 'demo', 0)
		page.ids.length = 0; page.namespaces.push('mutated')
		assert.equal(index.catalog('block_', 'demo', 100).ids.length, 100)
		assert.deepEqual(index.catalog('block_', 'demo', 0).namespaces, ['ae2', 'demo'])
		assert.ok(index.catalog('glass_cable', '', 0).ids.includes('ae2:fluix_glass_cable'))
		assert.equal((await index.blockOptions('demo:block_001')).defaults.axis, 'x')
		await assert.rejects(() => index.blockOptions('missing:unknown'))
		await zip(jar, { 'assets/demo/blockstates/new.json': '{"variants":{"":{"model":"demo:model"}}}' })
		await index.build(instance(root, [jar]))
		assert.deepEqual(index.catalog('', '', 0).ids, ['demo:new'])
	} finally { await fs.rm(root, { recursive: true, force: true }) }
})
test('ray/voxel face intersection returns the correct adjacent direction and misses empty space', () => {
	assert.deepEqual(intersectBox([0.5, 4, 0.5], [0, -1, 0], [0, 0, 0], [1, 1, 1])?.normal, [0, 1, 0])
	assert.deepEqual(intersectBox([-4, 0.5, 0.5], [1, 0, 0], [0, 0, 0], [1, 1, 1])?.normal, [-1, 0, 0])
	assert.deepEqual(intersectBox([0.5, 0.5, 4], [0, 0, -1], [0, 0, 0], [1, 1, 1])?.normal, [0, 0, 1])
	assert.equal(intersectBox([2, 4, 0.5], [0, -1, 0], [0, 0, 0], [1, 1, 1]), undefined)
})

test('color picking resolves quantization collisions and coordinates beyond the 8-bit range', () => {
	const structure = new Structure([300, 2, 2])
	for (const x of [127, 128, 129, 256, 270]) structure.addBlock([x, 0, 0], 'minecraft:stone')
	const color = (x: number) => [Math.round(Math.min(1, x / 256) * 255), 0, 0]
	assert.deepEqual(resolveColorPick(structure, color(127), [127.5, 2, 0.5], [0, -1, 0]), [127, 0, 0])
	assert.deepEqual(resolveColorPick(structure, color(129), [129.5, 2, 0.5], [0, -1, 0]), [129, 0, 0])
	assert.deepEqual(resolveColorPick(structure, color(270), [270.5, 2, 0.5], [0, -1, 0]), [270, 0, 0])
	assert.equal(resolveColorPick(structure, color(128), [128.5, 2, 1.5], [0, -1, 0]), null)
})
