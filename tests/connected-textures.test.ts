import assert from 'node:assert/strict'
import { test } from 'node:test'
import { promises as fs } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { BlockModel, Cull, Structure } from 'deepslate'
import { mat4 } from 'gl-matrix'
import { connectedTexture } from '../src/assets/ConnectedTextures'
import { connectTextures } from '../src/editor/ConnectedTextures'
import { ResourceIndex } from '../src/assets/ResourceIndex'
import { cube, instance, png, zip } from './fixtures'

const rule = connectedTexture({ ctm: { ctm_version: 1, type: 'CTM', textures: ['demo:ctm/sheet'], extra: { ignore_states: true, connect_inside: true } } })!
const base: [number, number, number, number] = [0, 0, 0.25, 0.25]
const sheet: [number, number, number, number] = [0.5, 0.5, 1, 1]
const atlas = { getTextureUV: () => base }
const sprites = new Map([[base.join(','), { rule, base, sheet }]])

test('CTM subdivides all six cube faces, retains winding and uses neighbor-dependent corners without mutating shared geometry', () => {
	const source = BlockModel.fromJson(cube).getMesh(atlas, Cull.none()).transform(mat4.fromScaling(mat4.create(), [1 / 16, 1 / 16, 1 / 16]))
	const structure = new Structure([3, 3, 3]); structure.addBlock([1, 1, 1], 'demo:glass')
	const isolated = connectTextures(source, [1, 1, 1], structure.getBlock([1, 1, 1])!, structure, sprites)
	assert.equal(isolated.quads.length, 24)
	for (const [i, quad] of isolated.quads.entries()) {
		assert.deepEqual(quad.normal().components(), source.quads[Math.floor(i / 4)].normal().components())
		for (const vertex of quad.vertices()) {
			assert.ok(vertex.texture!.every(v => v >= 0 && v <= 0.25))
			assert.ok(vertex.pos.components().every(v => v >= 0 && v <= 1))
		}
	}
	structure.addBlock([2, 1, 1], 'demo:glass')
	const joined = connectTextures(source, [1, 1, 1], structure.getBlock([1, 1, 1])!, structure, sprites)
	assert.ok(joined.quads.some(q => q.v1.texture![0] >= 0.5))
	assert.ok(joined.quads.some(q => q.v1.texture![0] < 0.25))
	assert.equal(source.quads.length, 6)
	for (const quad of source.quads) assert.deepEqual(quad.v1.textureLimit, base)
})

test('CTM connection groups can span different block IDs and unrelated blocks retain outer edges', () => {
	const source = BlockModel.fromJson(cube).getMesh(atlas, Cull.none()).transform(mat4.fromScaling(mat4.create(), [1 / 16, 1 / 16, 1 / 16]))
	const structure = new Structure([3, 3, 3]); structure.addBlock([1, 1, 1], 'demo:casing'); structure.addBlock([2, 1, 1], 'demo:valve', { active: 'true' })
	const own = connectTextures(source, [1, 1, 1], structure.getBlock([1, 1, 1])!, structure, sprites)
	assert.ok(own.quads.every(q => q.v1.texture![0] < 0.5))
	const grouped = new Map([[base.join(','), { rule: { ...rule, connectTo: [{ block: 'demo:valve', properties: { active: 'true' } }] }, base, sheet }]])
	const joined = connectTextures(source, [1, 1, 1], structure.getBlock([1, 1, 1])!, structure, grouped)
	assert.ok(joined.quads.some(q => q.v1.texture![0] >= 0.5))
})

test('CTM metadata and its referenced sheet load from separate JARs with normal pack priority and malformed metadata falls back', async () => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nbt-ctm-'))
	try {
		const a = path.join(root, 'a.jar'), b = path.join(root, 'b.jar')
		await zip(a, {
			'assets/demo/blockstates/glass.json': JSON.stringify({ variants: { '': { model: 'demo:block/glass' } } }),
			'assets/demo/models/block/glass.json': JSON.stringify(cube),
			'assets/demo/textures/block/casing.png': png,
			'assets/demo/textures/block/casing.png.mcmeta': JSON.stringify({ ctm: { ctm_version: 1, type: 'CTM', textures: ['other:ctm/sheet'] } }),
		})
		await zip(b, { 'assets/other/textures/ctm/sheet.png': png })
		const index = new ResourceIndex(); await index.build(instance(root, [a, b]))
		const bundle = await index.bundle(['demo:glass'])
		assert.equal(bundle.connectedTextures?.['demo:block/casing'].texture, 'other:ctm/sheet')
		assert.equal(bundle.textures['other:ctm/sheet'], png.toString('base64'))
		assert.deepEqual(bundle.diagnostics, [])
		assert.throws(() => connectedTexture({ ctm: { ctm_version: 1, type: 'CTM', textures: ['../bad'] } }))
		assert.throws(() => connectedTexture({ ctm: { ctm_version: 1, type: 'ctm:optifine_full' } }))
		assert.equal(connectedTexture({ animation: { frametime: 2 } }), undefined)
	} finally { await fs.rm(root, { recursive: true, force: true }) }
})
