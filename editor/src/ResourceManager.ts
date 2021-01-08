import { BlockAtlas, BlockDefinition, BlockDefinitionProvider, BlockModel, BlockModelProvider } from '@webmc/render'

export class ResourceManager implements BlockDefinitionProvider, BlockModelProvider {
  private blockDefinitions: { [id: string]: BlockDefinition }
  private blockModels: { [id: string]: BlockModel }
  private blockAtlas: BlockAtlas

  constructor() {
    this.blockDefinitions = {}
    this.blockModels = {}
    this.blockAtlas = BlockAtlas.empty()
  }

  public getBlockDefinition(id: string) {
    return this.blockDefinitions[id]
  }

  public getBlockModel(id: string) {
    return this.blockModels[id]
  }

  public getTextureUV(id: string) {
    return this.blockAtlas.getUV(id)
  }

  public getBlockAtlas() {
    return this.blockAtlas
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
    const atlasCtx = atlasCanvas.getContext('2d')
    atlasCtx.drawImage(image, 0, 0)
    const atlasData = atlasCtx.getImageData(0, 0, atlasCanvas.width, atlasCanvas.height)
    const idMap = {}
    Object.keys(textures).forEach(t => {
      idMap['minecraft:' + t] = textures[t]
    })
    this.blockAtlas = new BlockAtlas(atlasData, idMap)
  }
}
