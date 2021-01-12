import { Structure } from "@webmc/core";
import { StructureRenderer } from "@webmc/render";
import { EditorPanel, locale } from "./Editor";
import { ResourceManager } from "./ResourceManager";
import { mat4 } from "gl-matrix"

declare const stringifiedAssets: string

export class StructureEditor implements EditorPanel {
  private canvas: HTMLCanvasElement
  private resources: ResourceManager
  private structure: Structure
  private renderer: StructureRenderer

  private xRotation: number
  private yRotation: number
  private viewDist: number

  private gridActive: boolean

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
    this.structure = new Structure([0, 0, 0])
    this.renderer = new StructureRenderer(gl, this.resources, this.resources, blockAtlas, this.structure)

    this.xRotation = 0.8
    this.yRotation = 0.5
    this.viewDist = 4.0

    this.gridActive = true

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
      
      const size = this.structure.getSize()
      const viewMatrix = mat4.create();
      mat4.translate(viewMatrix, viewMatrix, [0, 0, -this.viewDist]);
      mat4.rotate(viewMatrix, viewMatrix, this.xRotation, [1, 0, 0]);
      mat4.rotate(viewMatrix, viewMatrix, this.yRotation, [0, 1, 0]);
      mat4.translate(viewMatrix, viewMatrix, [-size[0] / 2, -size[1] / 2, -size[2] / 2]);

      if (this.gridActive) {
        this.renderer.drawGrid(viewMatrix);
      }

      this.renderer.drawStructure(viewMatrix);
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

  update(data: any) {
    this.structure = Structure.fromNbt(data.data)
    this.renderer.setStructure(this.structure)
    this.render()
  }

  menu() {
    const gridToggle = document.createElement('div')
    gridToggle.classList.add('btn')
    gridToggle.textContent = locale('grid')
    gridToggle.classList.toggle('active', this.gridActive)
    gridToggle.addEventListener('click', () => {
      this.gridActive = !this.gridActive
      gridToggle.classList.toggle('active', this.gridActive)
      this.render()
    })

    return [gridToggle]
  }
}
