import type { BlockDefinitionProvider, BlockFlagsProvider, BlockModelProvider, BlockPropertiesProvider, TextureAtlasProvider } from 'deepslate'
import { BlockDefinition, BlockModel, Identifier, TextureAtlas, upperPowerOfTwo } from 'deepslate'
import { OPAQUE_BLOCKS } from './OpaqueHelper'

export class ResourceManager implements BlockDefinitionProvider, BlockModelProvider, BlockFlagsProvider, BlockPropertiesProvider, TextureAtlasProvider {
	private blockDefinitions: { [id: string]: BlockDefinition }
	private blockModels: { [id: string]: BlockModel }
	private textureAtlas: TextureAtlas
	private readonly blocks: Map<string, {
		default: Record<string, string>,
		properties: Record<string, string[]>,
	}>

	constructor(blocks: any, assets: any, textureAtlas: HTMLImageElement) {
		this.blocks = new Map(Object.entries(blocks)
			.map(([k, v]: [string, any]) => [
				Identifier.create(k).toString(),
				{ properties: v[0], default: v[1] },
			]))
		this.blockDefinitions = {}
		this.blockModels = {}
		this.textureAtlas = TextureAtlas.empty()
		this.loadBlockDefinitions(assets.blockstates)
		this.loadBlockModels(assets.models)
		this.loadBlockAtlas(textureAtlas, assets.textures)
	}

	public getBlockDefinition(id: Identifier) {
		return this.blockDefinitions[id.toString()]
	}

	public getBlockModel(id: Identifier) {
		return this.blockModels[id.toString()]
	}

	public getTextureUV(id: Identifier) {
		return this.textureAtlas.getTextureUV(id)
	}

	public getTextureAtlas() {
		return this.textureAtlas.getTextureAtlas()
	}

	public getBlockFlags(id: Identifier) {
		return {
			opaque: OPAQUE_BLOCKS.has(id.toString()),
		}
	}

	public getBlockProperties(id: Identifier) {
		return this.blocks[id.toString()]?.properties ?? null
	}

	public getDefaultBlockProperties(id: Identifier) {
		return this.blocks.get(id.toString())?.default ?? null
	}

	public loadBlockDefinitions(definitions: any) {
		Object.keys(definitions).forEach(id => {
			this.blockDefinitions[Identifier.create(id).toString()] = BlockDefinition.fromJson(id, definitions[id])
		})
	}

	public loadBlockModels(models: any) {
		Object.keys(models).forEach(id => {
			this.blockModels[Identifier.create(id).toString()] = BlockModel.fromJson(id, models[id])
		})
		Object.values(this.blockModels).forEach(m => m.flatten(this))
	}

	public loadBlockAtlas(image: HTMLImageElement, textures: any) {
		const atlasCanvas = document.createElement('canvas')
		const w = upperPowerOfTwo(image.width)
		const h = upperPowerOfTwo(image.height)
		atlasCanvas.width = w
		atlasCanvas.height = h
		const atlasCtx = atlasCanvas.getContext('2d')!
		atlasCtx.drawImage(image, 0, 0)
		const atlasData = atlasCtx.getImageData(0, 0, w, h)
		const idMap = {}
		Object.keys(textures).forEach(id => {
			const [u, v, du, dv] = textures[id]
			const dv2 = (du !== dv && id.startsWith('block/')) ? du : dv
			idMap[Identifier.create(id).toString()] = [u / w, v / h, (u + du) / w, (v + dv2) / h]
		})
		this.textureAtlas = new TextureAtlas(atlasData, idMap)
	}
}
