import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BlockModel, Cull, Identifier, Mesh, Structure } from 'deepslate'
import { mat4 } from 'gl-matrix'
import { flattenModels } from '../src/assets/Validation'
import { ModdedDefinition, lockUV } from '../src/editor/ModdedDefinition'
import { CachedModel, GeometryCache } from '../src/editor/CachedModel'
import { cube } from './fixtures'

const atlas = { getTextureUV: () => [0, 0, 1, 1] as [number, number, number, number], getTextureAtlas: () => { throw new Error('Not used by geometry generation') } }
function blockModel() { const model = flattenModels({ 'demo:model': cube }, () => {})['demo:model']; return BlockModel.fromJson({ textures: { all: 'demo:block/casing' }, elements: model.elements?.map(e => ({ ...e, faces: Object.fromEntries(Object.entries(e.faces ?? {}).map(([dir, face]) => [dir, { ...face, texture: '#all' }])) })) }) }

test('models generate six textured faces and honor cull faces', () => {
	const model = blockModel()
	assert.equal(model.getMesh(atlas, Cull.none()).quads.length, 6)
	assert.equal(model.getMesh(atlas, { up: true }).quads.length, 5)
})
test('NBT properties select non-cubic geometry and rotate it in the existing mesh pipeline', () => {
	const pipe = BlockModel.fromJson({ textures: { all: 'demo:block/pipe' }, elements: [{ from: [4, 0, 4], to: [12, 16, 12], faces: { north: { texture: '#all', uv: [0, 0, 8, 16], rotation: 90 } } }] })
	const definition = new ModdedDefinition({ variants: { 'axis=x': { model: 'demo:pipe', x: 90 }, 'axis=y': { model: 'demo:pipe' } } }, () => 0, [0.2, 0.4, 0.6], () => {})
	const models = { getBlockModel: () => pipe }
	const straight = definition.getMesh(Identifier.parse('demo:pipe'), { axis: 'y' }, atlas, models, Cull.none())
	const rotated = definition.getMesh(Identifier.parse('demo:pipe'), { axis: 'x' }, atlas, models, Cull.none())
	assert.equal(straight.quads.length, 1)
	assert.notDeepEqual(straight.quads[0].v1.pos.components(), rotated.quads[0].v1.pos.components())
	assert.equal(Math.max(...straight.quads[0].vertices().map(v => v.pos.y)), 1)
})
test('UV lock changes face coordinates under block rotation and zero rotation preserves them', () => {
	const model = blockModel()
	const mesh = model.getMesh(atlas, Cull.none())
	const original = mesh.quads.map(q => q.vertices().map(v => v.texture))
	lockUV(mesh, mat4.create())
	assert.deepEqual(mesh.quads.map(q => q.vertices().map(v => v.texture)), original)
	lockUV(mesh, mat4.fromYRotation(mat4.create(), -Math.PI / 2))
	assert.notDeepEqual(mesh.quads.map(q => q.vertices().map(v => v.texture)), original)
})
test('multipart merges geometry, missing models use a unit-size fallback', () => {
	const model = blockModel()
	const provider = { getBlockModel: (id: Identifier) => id.path === 'missing' ? undefined : model }
	const definition = new ModdedDefinition({ multipart: [{ apply: { model: 'demo:a' } }, { when: { north: 'true' }, apply: { model: 'demo:b', y: 90 } }] }, () => 0, [1, 1, 1], () => {})
	assert.equal(definition.getMesh(Identifier.parse('demo:cable'), { north: 'true' }, atlas, provider, Cull.none()).quads.length, 12)
	const fallback = new ModdedDefinition({ variants: { '': { model: 'demo:missing' } } }, () => 0, [1, 1, 1], () => {})
	const mesh = fallback.getMesh(Identifier.parse('demo:missing'), {}, atlas, provider, Cull.none())
	assert.equal(mesh.quads.length, 6)
	assert.equal(Math.max(...mesh.quads.flatMap(q => q.vertices().map(v => v.pos.x))), 1)
})
test('weighted mesh selection is repeatable across position seeds and fallback tint reaches faces', () => {
	let seed = 12
	const tinted = BlockModel.fromJson({ textures: { all: 'demo:block/texture' }, elements: [{ from: [0, 0, 0], to: [16, 8, 16], faces: { up: { texture: '#all', tintindex: 0 } } }] })
	const model = blockModel()
	const models = { getBlockModel: (id: Identifier) => id.path === 'slab' ? tinted : model }
	const definition = new ModdedDefinition({ variants: { '': [{ model: 'demo:slab' }, { model: 'demo:cube' }] } }, () => seed, [0.2, 0.5, 0.7], () => {})
	const count = () => definition.getMesh(Identifier.parse('demo:weighted'), {}, atlas, models, Cull.none()).quads.length
	assert.equal(count(), count())
	const choices = new Set<number>()
	for (seed = 0; seed < 50; seed++) choices.add(count())
	assert.equal(choices.size, 2)
	const tintDefinition = new ModdedDefinition({ variants: { '': { model: 'demo:slab' } } }, () => 0, [0.2, 0.5, 0.7], () => {})
	assert.deepEqual(tintDefinition.getMesh(Identifier.parse('demo:slab'), {}, atlas, models, {}).quads[0].v1.color, [0.2, 0.5, 0.7])
})
test('cached meshes remain independent after a caller transforms geometry', () => {
	const model = new CachedModel('demo:cached', { all: 'demo:block/casing' }, cube.elements as ConstructorParameters<typeof CachedModel>[2], new GeometryCache())
	const first = model.getMesh(atlas, {})
	const original = first.quads[0].v1.pos.components()
	first.transform(mat4.fromTranslation(mat4.create(), [100, 0, 0]))
	const second = model.getMesh(atlas, {})
	assert.deepEqual(second.quads[0].v1.pos.components(), original)
})
test('22.5-degree rescale uses the angle cosine rather than the 45-degree scale', () => {
	const element = { from: [0, 0, 0], to: [16, 16, 16], rotation: { origin: [8, 8, 8], axis: 'y', angle: 22.5, rescale: true }, faces: { up: { texture: '#all' } } }
	const model = new CachedModel('demo:rotated', { all: 'demo:block/casing' }, [element] as ConstructorParameters<typeof CachedModel>[2], new GeometryCache())
	const mesh = model.getMesh(atlas, {})
	const maxX = Math.max(...mesh.quads[0].vertices().map(v => v.pos.x))
	assert.ok(Math.abs(maxX - (16 + 8 * Math.tan(Math.PI / 8))) < 0.0001)
})
