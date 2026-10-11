import type { BlockstateJson, Condition, ModelJson, ModelVariant, VariantEntry } from './Types'
import { LIMITS, resourceId, textureReference } from './Types'

function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value) }
function vector(value: unknown, length: number): boolean { return Array.isArray(value) && value.length === length && value.every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 4096) }
export function validateBlockstate(value: unknown): BlockstateJson {
	if (!object(value)) throw new Error('Blockstate must be an object')
	const entry = (v: unknown): void => {
		if (Array.isArray(v)) { if (!v.length || v.length > 256) throw new Error('Invalid variant count'); v.forEach(entry); return }
		if (!object(v) || typeof v.model !== 'string') throw new Error('Invalid model variant')
		resourceId(v.model)
		for (const axis of ['x', 'y'] as const) if (v[axis] !== undefined) {
			const angle = v[axis]
			if (typeof angle !== 'number' || !Number.isSafeInteger(angle) || angle % 90 !== 0) throw new Error('Invalid blockstate rotation')
			v[axis] = ((angle % 360) + 360) % 360
		}
		if (v.weight !== undefined && (typeof v.weight !== 'number' || !Number.isInteger(v.weight) || v.weight < 1 || v.weight > 1000000)) throw new Error('Invalid variant weight')
	}
	const condition = (c: unknown, depth: number): void => {
		if (depth > 32 || !object(c) || Object.keys(c).length > 128) throw new Error('Invalid multipart condition')
		for (const [key, v] of Object.entries(c)) {
			if (key === 'OR' || key === 'AND') { if (!Array.isArray(v) || v.length > 128) throw new Error('Invalid logical condition'); v.forEach(child => condition(child, depth + 1)) } else if (typeof v !== 'string') throw new Error('Invalid property condition')
		}
	}
	if (value.variants !== undefined) {
		if (!object(value.variants) || Object.keys(value.variants).length > 4096) throw new Error('Invalid variants')
		Object.values(value.variants).forEach(entry)
	}
	if (value.multipart !== undefined) {
		if (!Array.isArray(value.multipart) || value.multipart.length > 1024) throw new Error('Invalid multipart')
		value.multipart.forEach(p => { if (!object(p)) throw new Error('Invalid multipart part'); entry(p.apply); if (p.when) condition(p.when, 0) })
	}
	if (value.variants === undefined && value.multipart === undefined) throw new Error('No variants or multipart definition')
	return value as unknown as BlockstateJson
}

export function validateModel(value: unknown): ModelJson {
	if (!object(value)) throw new Error('Model must be an object')
	if (value.parent !== undefined) { if (typeof value.parent !== 'string') throw new Error('Invalid parent'); resourceId(value.parent) }
	if (value.loader !== undefined && typeof value.loader !== 'string') throw new Error('Invalid custom loader')
	if (value.textures !== undefined) {
		if (!object(value.textures) || Object.keys(value.textures).length > 1024) throw new Error('Invalid textures')
		for (const v of Object.values(value.textures)) { const ref = typeof v === 'string' ? v : object(v) && typeof v.sprite === 'string' ? v.sprite : undefined; if (!ref) throw new Error('Invalid texture reference'); if (!ref.startsWith('#')) resourceId(ref) }
	}
	if (value.elements !== undefined) {
		if (!Array.isArray(value.elements) || value.elements.length > 4096) throw new Error('Too many model elements')
		for (const e of value.elements) {
			if (!object(e) || !vector(e.from, 3) || !vector(e.to, 3)) throw new Error('Invalid element bounds')
			if (e.rotation !== undefined) {
				const r = e.rotation
				if (!object(r) || !vector(r.origin, 3) || !['x', 'y', 'z'].includes(r.axis as string) || ![-45, -22.5, 0, 22.5, 45].includes(r.angle as number)) throw new Error('Invalid element rotation')
			}
			if (e.faces !== undefined) {
				if (!object(e.faces)) throw new Error('Invalid faces')
				for (const [direction, face] of Object.entries(e.faces)) {
					if (!['up', 'down', 'north', 'south', 'east', 'west'].includes(direction) || !object(face) || typeof face.texture !== 'string') throw new Error('Invalid face')
					if (!face.texture.startsWith('#')) resourceId(face.texture)
					if (face.uv !== undefined && !vector(face.uv, 4)) throw new Error('Invalid UV')
					if (face.rotation !== undefined && ![0, 90, 180, 270].includes(face.rotation as number)) throw new Error('Invalid UV rotation')
					if (face.cullface !== undefined && !['up', 'down', 'north', 'south', 'east', 'west'].includes(face.cullface as string)) throw new Error('Invalid cull face')
					if (face.tintindex !== undefined && (typeof face.tintindex !== 'number' || !Number.isInteger(face.tintindex))) throw new Error('Invalid tint index')
				}
			}
		}
	}
	return value as ModelJson
}

export function modelReferences(state: BlockstateJson): string[] {
	const entries: VariantEntry[] = [...Object.values(state.variants ?? {}), ...(state.multipart ?? []).map(p => p.apply)]
	return [...new Set(entries.flatMap(e => Array.isArray(e) ? e : [e]).map(v => resourceId(v.model)))]
}
export function matchesCondition(condition: Condition, props: Record<string, string>): boolean {
	return Object.entries(condition).every(([key, value]) => key === 'OR' && Array.isArray(value) ? value.some(c => matchesCondition(c, props)) : key === 'AND' && Array.isArray(value) ? value.every(c => matchesCondition(c, props)) : typeof value === 'string' && value.split('|').includes(props[key]))
}
export function chooseVariants(state: BlockstateJson, props: Record<string, string>, seed: number): ModelVariant[] {
	const pick = (entry: VariantEntry, index: number) => {
		if (!Array.isArray(entry)) return entry
		const total = entry.reduce((n, v) => n + (v.weight ?? 1), 0)
		let value = (Math.imul(seed ^ index, 1664525) + 1013904223 >>> 0) % total
		for (const v of entry) { value -= v.weight ?? 1; if (value < 0) return v }
		return entry[0]
	}
	if (state.variants) {
		const match = Object.keys(state.variants).find(key => key === '' || key.split(',').every(pair => { const [k, v] = pair.split('='); return v?.split('|').includes(props[k]) }))
		return match === undefined ? [] : [pick(state.variants[match], 0)]
	}
	return (state.multipart ?? []).filter(p => !p.when || matchesCondition(p.when, props)).map((p, i) => pick(p.apply, i))
}

export interface ModelAdapter { readonly id: string, supports(model: ModelJson): boolean, convert(model: ModelJson): ModelJson }
export function flattenModels(models: Record<string, ModelJson>, report: (id: string, message: string) => void, adapters: readonly ModelAdapter[] = []): Record<string, ModelJson> {
	const output: Record<string, ModelJson> = Object.create(null) as Record<string, ModelJson>
	const inherited: Record<string, ModelJson> = Object.create(null) as Record<string, ModelJson>
	const inherit = (id: string, stack: string[]): ModelJson => {
		if (inherited[id]) return inherited[id]
		if (stack.includes(id) || stack.length >= LIMITS.depth) throw new Error('Model inheritance cycle/depth limit')
		let model = validateModel(models[id])
		if (model.loader) { const adapter = adapters.find(a => a.supports(model)); if (!adapter) throw new Error(`Unsupported custom loader ${model.loader}`); model = validateModel(adapter.convert(model)) }
		const parent = model.parent && !['minecraft:builtin/generated', 'minecraft:builtin/entity'].includes(resourceId(model.parent)) ? inherit(resourceId(model.parent), [...stack, id]) : undefined
		return inherited[id] = { textures: { ...parent?.textures, ...model.textures }, elements: model.elements ?? parent?.elements, ambientocclusion: model.ambientocclusion ?? parent?.ambientocclusion }
	}
	const resolve = (id: string): ModelJson => {
		const model = inherit(id, [])
		const textures = Object.fromEntries(Object.entries(model.textures ?? {}).map(([key, value]) => [key, textureReference(value)]))
		const texture = (ref: string): string => {
			const seen = new Set<string>()
			while (ref.startsWith('#')) { if (seen.has(ref) || seen.size >= LIMITS.depth) throw new Error('Texture alias cycle/depth limit'); seen.add(ref); const next = textures[ref.slice(1)]; if (!next) throw new Error(`Missing texture alias ${ref}`); ref = next }
			return resourceId(ref)
		}
		const elements = model.elements?.map(e => ({ ...e, faces: Object.fromEntries(Object.entries(e.faces ?? {}).map(([face, v]) => [face, { ...v, texture: texture(v.texture) }])) }))
		return output[id] = { textures, elements, ambientocclusion: model.ambientocclusion }
	}
	for (const id of Object.keys(models)) { try { resolve(id) } catch (e) { report(id, e instanceof Error ? e.message : String(e)) } }
	return output
}
