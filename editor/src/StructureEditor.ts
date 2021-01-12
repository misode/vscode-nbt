import { Structure } from "@webmc/core";
import { StructureRenderer } from "@webmc/render";
import { EditorPanel } from "./Editor";
import { ResourceManager } from "./ResourceManager";

declare const stringifiedAssets: string

export class StructureEditor implements EditorPanel {
  private canvas: HTMLCanvasElement
  private resources: ResourceManager
  private renderer: StructureRenderer

  private xRotation: number
  private yRotation: number
  private viewDist: number

  constructor(private root: Element, ) {
    const assets = JSON.parse(stringifiedAssets)
    this.resources = new ResourceManager()
    const img = (document.querySelector('.block-atlas') as HTMLImageElement)
    this.resources.loadBlockDefinitions(assets.blockstates)
    this.resources.loadBlockModels(assets.models)
    this.resources.loadBlockAtlas(img, assets.textures)
    const blockAtlas = this.resources.getBlockAtlas()

    this.canvas = document.createElement('canvas')
    this.canvas.className = 'structure-3d'
    const gl = this.canvas.getContext('webgl');
    const structure = new Structure([0, 0, 0])
    this.renderer = new StructureRenderer(gl, this.resources, this.resources, blockAtlas, structure)

    this.xRotation = 0.8
    this.yRotation = 0.5
    this.viewDist = 4.0

    let dragPos: [number, number] | null = null
    this.canvas.addEventListener('mousedown', evt => {
      dragPos = [evt.clientX, evt.clientY]
    })
    this.canvas.addEventListener('mousemove', evt => {
      if (dragPos) {
        this.yRotation += (evt.clientX - dragPos[0]) / 100
        this.xRotation += (evt.clientY - dragPos[1]) / 100
        dragPos = [evt.clientX, evt.clientY]
        this.render();
      }
    })
    this.canvas.addEventListener('mouseup', () => {
      dragPos = null
    })
    this.canvas.addEventListener('wheel', evt => {
      this.viewDist += evt.deltaY / 100
      this.render();
    })

    window.addEventListener('resize', () => {
      if (this.resize()) this.render()
    })

    this.render();
  }

  render() {
    requestAnimationFrame(() => {
      this.resize()
      this.yRotation = this.yRotation % (Math.PI * 2)
      this.xRotation = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.xRotation))
      this.viewDist = Math.max(1, Math.min(30, this.viewDist))
      this.renderer.drawStructure(this.xRotation, this.yRotation, this.viewDist);
    })
  }

  resize() {
    const displayWidth = this.canvas.clientWidth;
    const displayHeight = this.canvas.clientHeight;
    if (this.canvas.width !== displayWidth || this.canvas.height !== displayHeight) {
      this.canvas.width = displayWidth;
      this.canvas.height = displayHeight;
      this.renderer.setViewport(0, 0, this.canvas.width, this.canvas.height)
      return true
    }
    return false
  }

  reveal() {
    this.root.append(this.canvas)
  }

  async update(data: any) {
    const structure = await Structure.fromNbt(data.data)
    this.renderer.setStructure(structure)
    this.render()
  }
}
