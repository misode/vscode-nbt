import { TextureAtlas, BlockDefinition, BlockDefinitionProvider, BlockModel, BlockModelProvider, BlockFlagsProvider, BlockPropertiesProvider } from '@webmc/render'
import { isOpaque } from './OpaqueHelper'

export class ResourceManager implements BlockDefinitionProvider, BlockModelProvider, BlockFlagsProvider, BlockPropertiesProvider {
  private blockDefinitions: { [id: string]: BlockDefinition }
  private blockModels: { [id: string]: BlockModel }
  private textureAtlas: TextureAtlas
  private blocks: Record<string, {
    default: Record<string, string>,
    properties: Record<string, string[]>
  }>

  constructor(blocks: any, assets: any, textureAtlas: HTMLImageElement) {
    this.blocks = blocks
    this.blockDefinitions = {}
    this.blockModels = {}
    this.textureAtlas = TextureAtlas.empty()
    this.loadBlockDefinitions(assets.blockstates)
    this.loadBlockModels(assets.models)
    this.loadBlockAtlas(textureAtlas, assets.textures)
  }

  public getBlockDefinition(id: string) {
    return this.blockDefinitions[id]
  }

  public getBlockModel(id: string) {
    return this.blockModels[id]
  }

  public getTextureUV(id: string) {
    return this.textureAtlas.getTextureUV(id)
  }

  public getTextureAtlas() {
    return this.textureAtlas.getTextureAtlas()
  }

  public getBlockFlags(id: string) {
    return {
      opaque: isOpaque(id)
    }
  }

  public getBlockProperties(id: string) {
    return this.blocks[id]?.properties ?? null
  }

  public getDefaultBlockProperties(id: string) {
    return this.blocks[id]?.default ?? null
  }

  public loadBlockDefinitions(definitions: any) {
    Object.keys(definitions).forEach(id => {
      this.blockDefinitions['minecraft:' + id] = BlockDefinition.fromJson(id, definitions[id])
    })
  }

  public loadBlockModels(models: any) {
    Object.keys(models).forEach(id => {
      this.blockModels['minecraft:' + id] = BlockModel.fromJson(id, models[id])
    })
    Object.values(this.blockModels).forEach(m => m.flatten(this))
  }

  public loadBlockAtlas(image: HTMLImageElement, textures: any) {
    const atlasCanvas = document.createElement('canvas')
    atlasCanvas.width = image.width
    atlasCanvas.height = image.height
    const atlasCtx = atlasCanvas.getContext('2d')!
    atlasCtx.drawImage(image, 0, 0)
    const atlasData = atlasCtx.getImageData(0, 0, atlasCanvas.width, atlasCanvas.height)
    const part = 16 / atlasData.width
    const idMap = {}
    Object.keys(textures).forEach(t => {
      const [u, v] = textures[t]
      idMap['minecraft:' + t] = [u, v, u + part, v + part]
    })
    this.textureAtlas = new TextureAtlas(atlasData, idMap)
  }
}
