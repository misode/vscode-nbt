import assert from 'node:assert/strict'
import { test } from 'node:test'
import { promises as fs } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { NbtTag, Structure } from 'deepslate'
import type { NbtCompound } from 'deepslate'
import { ae2ModelRequests, ae2Template, ae2Variants } from '../src/assets/Ae2'
import { ResourceIndex } from '../src/assets/ResourceIndex'
import { cube, instance, png, zip } from './fixtures'

const nbt = (text: string) => NbtTag.fromString(text) as NbtCompound
test('AE2 saved cable connections select coloured cores, branches and rotated straight models', () => {
	const structure = new Structure([3, 3, 3])
	structure.addBlock([1, 1, 1], 'ae2:cable_bus', {}, nbt('{cable:{id:"ae2:blue_smart_cable",visual:{connections:["north","south"]}}}'))
	assert.deepEqual(ae2Variants(structure.getBlock([1, 1, 1]), structure), [{ model: 'nbtviewer:ae2/ae2/smart/blue/straight' }])
	structure.addBlock([0, 0, 0], 'ae2:cable_bus', {}, nbt('{cable:{id:"ae2:fluix_glass_cable",visual:{connections:["east","up"]}}}'))
	const branches = ae2Variants(structure.getBlock([0, 0, 0]), structure)!
	assert.equal(branches.length, 3)
	assert.equal(branches[0].model, 'nbtviewer:ae2/ae2/glass/transparent/center')
	assert.equal(branches[1].x, 270)
	assert.equal(branches[2].y, 90)
	assert.ok(ae2ModelRequests(structure).includes(branches[0].model))
})
test('AE2 world saves infer compatible cable neighbours and diagnose unsupported data', () => {
	const structure = new Structure([3, 1, 1])
	structure.addBlock([0, 0, 0], 'ae2:cable_bus', {}, nbt('{cable:{id:"ae2:red_covered_dense_cable"}}'))
	structure.addBlock([1, 0, 0], 'ae2:cable_bus', {}, nbt('{cable:{id:"ae2:fluix_glass_cable"}}'))
	structure.addBlock([2, 0, 0], 'ae2:cable_bus', {}, nbt('{cable:{id:"unknown:custom"}}'))
	const warnings: string[] = []
	const variants = ae2Variants(structure.getBlock([0, 0, 0]), structure, s => warnings.push(s))!
	assert.equal(variants[0].model, 'nbtviewer:ae2/ae2/dense_covered/red/center')
	assert.equal(variants.length, 2)
	assert.ok(warnings.some(s => s.includes('inferred')))
	assert.equal(ae2Variants(structure.getBlock([2, 0, 0]), structure)![0].model, 'nbtviewer:fallback')
	assert.equal(ae2Template('nbtviewer:ae2/ae2/glass/../../center'), undefined)
})
test('AE2 attached parts use side rotations and saved powered models, even without a cable', () => {
	const structure = new Structure([1, 1, 1])
	structure.addBlock([0, 0, 0], 'ae2:cable_bus', {}, nbt('{east:{id:"ae2:import_bus",visual:{powered:1b,missingChannel:0b}},up:{id:"ae2:energy_acceptor"}}'))
	const models = ae2Variants(structure.getBlock([0, 0, 0]), structure)!
	assert.ok(models.some(v => v.model === 'ae2:part/import_bus_has_channel' && v.y === 90))
	assert.ok(models.some(v => v.model === 'ae2:part/energy_acceptor' && v.x === 270))
	assert.ok(!models.some(v => v.model === 'nbtviewer:fallback'))
})
test('AE2 runtime templates load real archive geometry and colour textures; unchanged rescans reuse metadata and payloads', async () => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nbt-ae2-'))
	try {
		const jar = path.join(root, 'ae2.jar')
		await zip(jar, {
			'assets/ae2/models/part/cable/glass/center.json': JSON.stringify({ ...cube, textures: { all: '#base', base: 'ae2:part/cable/glass/transparent' } }),
			'assets/ae2/textures/part/cable/core/glass/blue.png': png,
			'assets/ae2/guide/test.json': '{}',
		})
		const index = new ResourceIndex()
		const pack = instance(root, [jar])
		await index.build(pack)
		const model = 'nbtviewer:ae2/ae2/glass/blue/center'
		const bundle = await index.bundle([], [1, 1, 1], () => false, [model])
		assert.ok(bundle.models[model].elements?.length)
		assert.equal(bundle.models[model].textures?.base, 'ae2:part/cable/core/glass/blue')
		assert.ok(bundle.textures['ae2:part/cable/core/glass/blue'])
		assert.deepEqual(bundle.diagnostics, [])
		await index.build(pack)
		await index.bundle([], [1, 1, 1], () => false, [model])
		assert.equal(index.stats.archivesRead, 1)
		assert.equal(index.stats.archivesReused, 1)
		assert.ok(index.stats.hits >= 2)
		assert.deepEqual(index.diagnostics, [])
		index.clear()
		assert.equal(index.stats.cacheEntries, 0)
	} finally { await fs.rm(root, { recursive: true, force: true }) }
})
