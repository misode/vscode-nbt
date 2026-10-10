import type { BlockDefinitionProvider, BlockFlagsProvider, BlockModelProvider, BlockPropertiesProvider, StructureProvider, TextureAtlasProvider , Identifier, BlockModel} from 'deepslate'
import { BlockDefinition, TextureAtlas, upperPowerOfTwo } from 'deepslate'
import type { AssetBundle, BlockstateJson, ModelJson } from '../assets/Types'
import { errorText, resourceId, textureReference } from '../assets/Types'
import { flattenModels, modelReferences } from '../assets/Validation'
import type { ModelAdapter } from '../assets/Validation'
import { NON_SELF_CULLING, OPAQUE_BLOCKS, TRANSLUCENT_BLOCKS } from './BlockFlags'
import { ModdedDefinition } from './ModdedDefinition'
import { CachedModel, GeometryCache } from './CachedModel'
import { ae2Variants, isAe2Bus } from '../assets/Ae2'
import type { BlockOptions } from '../assets/Types'

export class ResourceManager implements BlockDefinitionProvider, BlockModelProvider, BlockFlagsProvider, BlockPropertiesProvider, TextureAtlasProvider {
	private blockDefinitions: Record<string, BlockDefinition> = Object.create(null)
	private blockModels: Record<string, BlockModel> = Object.create(null)
	private textureAtlas: TextureAtlas = TextureAtlas.empty()
	private readonly blocks: Map<string, { default: Record<string, string>, properties: Record<string, string[]> }>
	private readonly baseDefinitions: Record<string, BlockstateJson>
	private readonly baseModels: Record<string, ModelJson>
	private readonly baseUV: Record<string, number[]>
	private readonly image: HTMLImageElement
	private position = [0, 0, 0]
	private currentBlock: ReturnType<StructureProvider['getBlock']> = null
	private structure?: StructureProvider
	private modded = false
	private tint: [number, number, number] = [1, 1, 1]
	private readonly geometryCache = new GeometryCache()
	readonly diagnostics = new Set<string>()
	constructor(blocks: Record<string, [Record<string, string[]>, Record<string, string>]>, assets: { blockstates: Record<string, BlockstateJson>, models: Record<string, ModelJson>, textures: Record<string, number[]> }, image: HTMLImageElement, private readonly adapters: readonly ModelAdapter[] = []) {
		this.blocks = new Map(Object.entries(blocks).map(([k, v]) => [resourceId(k), { properties: v[0], default: v[1] }]))
		this.baseDefinitions = Object.fromEntries(Object.entries(assets.blockstates).map(([id, v]) => [resourceId(id), v]))
		this.baseModels = Object.fromEntries(Object.entries(assets.models).map(([id, v]) => [resourceId(id), v]))
		this.baseUV = Object.fromEntries(Object.entries(assets.textures).map(([id, v]) => [resourceId(id), v]))
		this.image = image
		this.reset()
	}
	private readonly report = (message: string) => { if (this.diagnostics.size < 1000) this.diagnostics.add(message) }
	getBlockDefinition(id: Identifier) {
		const name = id.toString()
		if (this.modded && isAe2Bus(name) && this.structure) return new ModdedDefinition({}, () => 0, this.tint, this.report, () => ae2Variants(this.currentBlock, this.structure!, this.report))
		if (!this.blockDefinitions[name] && id.namespace !== 'minecraft') {
			this.report(`${name}: missing static blockstate; showing checkerboard fallback`)
			this.blockDefinitions[name] = this.definition({ variants: { '': { model: 'nbtviewer:fallback' } } })
		}
		return this.blockDefinitions[name]
	}
	getBlockModel(id: Identifier) { return this.blockModels[id.toString()] }
	getTextureUV(id: Identifier) { return this.textureAtlas.getTextureUV(id) }
	getTextureAtlas() { return this.textureAtlas.getTextureAtlas() }
	getPixelSize() { return this.textureAtlas.getPixelSize() }
	getBlockFlags(id: Identifier) {
		const name = id.toString()
		// Static assets do not define solid-face occlusion. Conservative flags avoid
		// incorrectly removing adjacent pipe/cable faces. Alpha blends in the existing renderer.
		return { opaque: id.namespace === 'minecraft' && OPAQUE_BLOCKS.has(name), semi_transparent: TRANSLUCENT_BLOCKS.has(name) || id.namespace !== 'minecraft', self_culling: id.namespace === 'minecraft' && !NON_SELF_CULLING.has(name) }
	}
	getBlockProperties(id: Identifier) { return this.blocks.get(id.toString())?.properties ?? null }
	getDefaultBlockProperties(id: Identifier) { return this.blocks.get(id.toString())?.default ?? null }
	private vanillaBlockIds?: string[]
	availableBlocks(): string[] { return [...(this.vanillaBlockIds ??= [...this.blocks.keys()].sort())] }
	blockOptions(id: string): BlockOptions | undefined {
		const block = this.blocks.get(id)
		return block ? { id, properties: block.properties, defaults: block.default } : undefined
	}
	private definition(value: BlockstateJson): BlockDefinition {
		return new ModdedDefinition(value, () => Math.imul(this.position[0], 73428767) ^ Math.imul(this.position[1], 912931) ^ Math.imul(this.position[2], 438289), this.tint, this.report)
	}
	private load(definitions: Record<string, BlockstateJson>, models: Record<string, ModelJson>): void {
		this.geometryCache.clear()
		this.blockDefinitions = Object.create(null)
		this.blockModels = Object.create(null)
		const used = new Set(Object.values(definitions).flatMap(modelReferences))
		const flattened = flattenModels(models, (id, message) => { if (used.has(id)) this.report(`${id}: ${message}`) }, this.adapters)
		flattened['nbtviewer:fallback'] = fallbackModel()
		for (const [id, model] of Object.entries(flattened)) {
			// Deepslate resolves every face string through its texture dictionary.
			const textures: Record<string, string> = {}
			let index = 0
			const elements = model.elements?.map(e => ({ ...e, faces: Object.fromEntries(Object.entries(e.faces ?? {}).map(([dir, face]) => { const key = `face_${index++}`; textures[key] = face.texture; return [dir, { ...face, texture: `#${key}` }] })) }))
			this.blockModels[id] = new CachedModel(id, textures, elements as ConstructorParameters<typeof CachedModel>[2], this.geometryCache)
		}
		for (const [id, state] of Object.entries(definitions)) {
			// Keep vanilla empty models and built-in special renderers unchanged.
			this.blockDefinitions[id] = id.startsWith('minecraft:') ? BlockDefinition.fromJson(state) : this.definition(state)
		}
	}
	reset(): void {
		this.modded = false
		this.diagnostics.clear()
		this.tint = [1, 1, 1]
		this.load(this.baseDefinitions, this.baseModels)
		const width = upperPowerOfTwo(this.image.width)
		const height = upperPowerOfTwo(this.image.height)
		const canvas = document.createElement('canvas')
		canvas.width = width; canvas.height = height
		const ctx = canvas.getContext('2d')!
		ctx.drawImage(this.image, 0, 0)
		const uv: Record<string, [number, number, number, number]> = {}
		for (const [id, [u, v, du, dv]] of Object.entries(this.baseUV)) uv[id] = [u / width, v / height, (u + du) / width, (v + (du !== dv && id.includes(':block/') ? du : dv)) / height]
		this.textureAtlas = new TextureAtlas(ctx.getImageData(0, 0, width, height), uv)
	}
	dependencies(ids: string[]): { models: string[], textures: string[] } {
		const models = new Set<string>()
		const textures = new Set<string>()
		const visit = (id: string) => {
			if (models.has(id) || models.size >= 8192) return
			models.add(id)
			const model = this.baseModels[id]
			if (!model) return
			for (const value of Object.values(model.textures ?? {})) { const ref = textureReference(value); if (!ref.startsWith('#')) textures.add(resourceId(ref)) }
			if (model.parent) visit(resourceId(model.parent))
		}
		for (const id of ids) if (this.baseDefinitions[id]) modelReferences(this.baseDefinitions[id]).forEach(visit)
		return { models: [...models], textures: [...textures].slice(0, 8192) }
	}
	async apply(bundle: AssetBundle, maxSize: number, cancelled: () => boolean): Promise<void> {
		this.reset()
		this.tint = bundle.tint
		bundle.diagnostics.forEach(this.report)
		const size = Math.min(4096, maxSize)
		if (this.image.width > size || this.image.height + 16 > size) throw new Error('Vanilla atlas exceeds GPU texture budget')
		const canvas = document.createElement('canvas')
		canvas.width = size; canvas.height = size
		const ctx = canvas.getContext('2d')!
		ctx.imageSmoothingEnabled = false
		ctx.drawImage(this.image, 0, 0)
		const uv: Record<string, [number, number, number, number]> = {}
		for (const [id, [u, v, du, dv]] of Object.entries(this.baseUV)) uv[id] = [u / size, v / size, (u + du) / size, (v + (du !== dv && id.includes(':block/') ? du : dv)) / size]
		let x = 16
		let y = this.image.height
		let rowHeight = 16
		ctx.fillStyle = '#000'; ctx.fillRect(0, y, 16, 16)
		ctx.fillStyle = '#ff00ff'; ctx.fillRect(0, y, 8, 8); ctx.fillRect(8, y + 8, 8, 8)
		uv['nbtviewer:missing'] = [0, y / size, 16 / size, (y + 16) / size]
		for (const [id, encoded] of Object.entries(bundle.textures)) {
			if (cancelled()) return
			let bitmap: ImageBitmap | undefined
			try {
				const binary = atob(encoded)
				const bytes = Uint8Array.from(binary, c => c.charCodeAt(0))
				bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
				const w = bitmap.width
				const h = Math.min(bitmap.height, w)
				if (x + w > size) { x = 0; y += rowHeight; rowHeight = 0 }
				if (y + h > size) { this.report(`${id}: texture atlas full; using fallback`); continue }
				ctx.drawImage(bitmap, 0, 0, w, h, x, y, w, h)
				uv[id] = [x / size, y / size, (x + w) / size, (y + h) / size]
				x += w; rowHeight = Math.max(rowHeight, h)
			} catch (e) { this.report(`${id}: ${errorText(e)}`) } finally { bitmap?.close() }
		}
		if (cancelled()) return
		this.modded = true
		const definitions = { ...this.baseDefinitions, ...bundle.blockstates }
		const models = { ...this.baseModels, ...bundle.models }
		// Missing textures point explicitly at the checkerboard cell, not the atlas origin.
		const used = new Set([...Object.values(definitions).flatMap(modelReferences), ...Object.keys(bundle.models).filter(id => id.startsWith('nbtviewer:ae2/'))])
		const flat = flattenModels(models, (id, msg) => { if (used.has(id)) this.report(`${id}: ${msg}`) }, this.adapters)
		for (const [id, model] of Object.entries(flat)) for (const e of model.elements ?? []) for (const face of Object.values(e.faces ?? {})) {
			if (!uv[face.texture]) { this.report(`${id}: missing texture ${face.texture}`); uv[face.texture] = uv['nbtviewer:missing'] }
		}
		this.textureAtlas = new TextureAtlas(ctx.getImageData(0, 0, size, size), uv)
		this.load(definitions, flat)
		for (const id of Object.keys(bundle.blockstates)) this.blockDefinitions[id] = this.definition(bundle.blockstates[id])
	}
	bind(structure: StructureProvider): StructureProvider {
		this.structure = structure
		const resources = this
		return {
			getSize: () => structure.getSize(), getBlock: pos => structure.getBlock(pos),
			getBlocks: () => {
				const blocks = structure.getBlocks()
				const array = blocks.slice()
				array[Symbol.iterator] = function* () { for (let i = 0; i < blocks.length; i++) { resources.position = blocks[i].pos; resources.currentBlock = blocks[i]; yield blocks[i] }; return undefined }
				return array
			},
		}
	}
}

function fallbackModel(): ModelJson {
	return { elements: [{ from: [0, 0, 0], to: [16, 16, 16], faces: Object.fromEntries(['up', 'down', 'north', 'south', 'east', 'west'].map(face => [face, { texture: 'nbtviewer:missing' }])) }] }
}
