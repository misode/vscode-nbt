import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isSelfCullingCube } from '../src/editor/SelfCulling'
import { flattenModels } from '../src/assets/Validation'
import { cube } from './fixtures'

test('inherited complete cubes self-cull for every weighted and rotated variant', () => {
	const models = flattenModels({ 'demo:base': cube, 'demo:glass': { parent: 'demo:base' } }, () => {})
	assert.equal(isSelfCullingCube({ variants: { '': [{ model: 'demo:glass' }, { model: 'demo:base', y: 90 }] } }, models), true)
})

test('partial, dynamic, mixed and non-cullable geometry never gains ID-wide self-culling', () => {
	const partial = { ...cube, elements: [{ ...cube.elements![0], from: [4, 0, 4] as [number, number, number] }] }
	const rotated = { ...cube, elements: [{ ...cube.elements![0], rotation: { origin: [8, 8, 8] as [number, number, number], axis: 'y' as const, angle: 45 } }] }
	const uncullable = { ...cube, elements: [{ ...cube.elements![0], faces: { ...cube.elements![0].faces, north: { texture: '#all' } } }] }
	const models = { cube, partial, rotated, uncullable, overlay: { ...cube, elements: [...cube.elements!, ...cube.elements!] }, custom: { ...cube, loader: 'demo:dynamic' } }
	for (const model of ['partial', 'rotated', 'uncullable', 'overlay', 'custom', 'missing']) {
		assert.equal(isSelfCullingCube({ variants: { '': { model } } }, models), false, model)
		assert.equal(isSelfCullingCube({ variants: { 'a=false': { model: 'cube' }, 'a=true': { model } } }, models), false, `mixed ${model}`)
	}
	assert.equal(isSelfCullingCube({ multipart: [{ apply: { model: 'cube' } }] }, models), false)
	assert.equal(isSelfCullingCube({ variants: {} }, models), false)
})
