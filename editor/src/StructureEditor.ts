import { BlockPos, Structure } from "@webmc/core";
import { getListTag } from "@webmc/nbt";
import { StructureRenderer } from "@webmc/render";
import { NbtEdit, NbtFile } from "../../src/types";
import { EditorPanel, locale, VsCode } from "./Editor";
import { ResourceManager } from "./ResourceManager";
import { mat4, vec2, vec3 } from "gl-matrix"
import { clamp, clampVec3, negVec3 } from "./Util";
import { TreeEditor } from "./TreeEditor";

declare const stringifiedAssets: string

export class StructureEditor implements EditorPanel {
  private canvas: HTMLCanvasElement
  private resources: ResourceManager
  private structure: Structure
  private renderer: StructureRenderer
  private canvas2: HTMLCanvasElement
  private gl2: WebGLRenderingContext
  private renderer2: StructureRenderer

  private cPos: vec3
  private cRot: vec2
  private cDist: number

  private gridActive: boolean
  private selectedBlock: BlockPos | null

  constructor(private root: Element, private vscode: VsCode) {
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

    this.canvas2 = document.createElement('canvas')
    this.canvas2.className = 'structure-3d click-detection'
    this.gl2 = this.canvas2.getContext('webgl')
    this.renderer2 = new StructureRenderer(this.gl2, this.resources, this.resources, blockAtlas, this.structure)

    this.cPos = vec3.create()
    this.cRot = vec2.fromValues(0.4, 0.6)
    this.cDist = 10

    this.gridActive = true
    this.selectedBlock = null

    let dragTime: number
    let dragPos: [number, number] | null = null
    let dragButton: number
    this.canvas.addEventListener('mousedown', evt => {
      dragTime = Date.now()
      dragPos = [evt.clientX, evt.clientY]
      dragButton = evt.button
    })
    this.canvas.addEventListener('mousemove', evt => {
      if (dragPos) {
        const dx = (evt.clientX - dragPos[0]) / 100
        const dy = (evt.clientY - dragPos[1]) / 100
        if (dragButton === 0) {
          vec2.add(this.cRot, this.cRot, [dx, dy])
          this.cRot[0] = this.cRot[0] % (Math.PI * 2)
          this.cRot[1] = clamp(this.cRot[1], -Math.PI / 2, Math.PI / 2)
        } else if (dragButton === 2) {
          vec3.rotateY(this.cPos, this.cPos, [0, 0, 0], this.cRot[0])
          vec3.rotateX(this.cPos, this.cPos, [0, 0, 0], this.cRot[1])
          const d = vec3.fromValues(dx, -dy, 0)
          vec3.scale(d, d, 0.25 * this.cDist)
          vec3.add(this.cPos, this.cPos, d)
          vec3.rotateX(this.cPos, this.cPos, [0, 0, 0], -this.cRot[1])
          vec3.rotateY(this.cPos, this.cPos, [0, 0, 0], -this.cRot[0])
          clampVec3(this.cPos, negVec3(this.structure.getSize()), [0, 0, 0])
        } else {
          return
        }
        dragPos = [evt.clientX, evt.clientY]
        this.render();
      }
    })
    this.canvas.addEventListener('mouseup', evt => {
      dragPos = null
      if (Date.now() - dragTime < 200) {
        if (dragButton === 0) {
          this.selectBlock(evt.clientX, evt.clientY)
        }
      }
    })
    this.canvas.addEventListener('wheel', evt => {
      this.cDist += evt.deltaY / 100
      this.cDist = Math.max(1, Math.min(100, this.cDist))
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

      const viewMatrix = this.getViewMatrix()

      if (this.gridActive) {
        this.renderer.drawGrid(viewMatrix);
      }

      this.renderer.drawStructure(viewMatrix);

      if (this.selectedBlock) {
        this.renderer.drawOutline(viewMatrix, this.selectedBlock)
      }
    })
  }

  resize() {
    const displayWidth2 = this.canvas2.clientWidth;
    const displayHeight2 = this.canvas2.clientHeight;
    if (this.canvas2.width !== displayWidth2 || this.canvas2.height !== displayHeight2) {
      this.canvas2.width = displayWidth2;
      this.canvas2.height = displayHeight2;
      this.renderer2.setViewport(0, 0, this.canvas2.width, this.canvas2.height)
    }

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
    this.root.append(this.canvas2)
    this.showSidePanel()
  }

  onInit(file: NbtFile) {
    if (file.region !== false) return
    this.structure = Structure.fromNbt(file.data)
    this.renderer.setStructure(this.structure)
    this.renderer2.setStructure(this.structure)

    vec3.copy(this.cPos, this.structure.getSize())
    vec3.scale(this.cPos, this.cPos, -0.5)
    this.cDist = vec3.dist([0, 0, 0], this.cPos) * 1.5
    this.render()
  }

  onUpdate(file: NbtFile, edit: NbtEdit) {
    if (file.region !== false) return
    if (edit.ops.length === 1 && edit.ops[0].path.length >= 1
        && edit.ops[0].path[0] === 'size') {
      this.structure['size'] = getListTag(file.data.value, 'size', 'int', 3)
      this.renderer['gridBuffers'] = this.renderer['getGridBuffers']()
      this.showSidePanel()
      this.render()
    } else {
      this.onInit(file)
    }
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

  private getViewMatrix() {
    const viewMatrix = mat4.create();
    mat4.translate(viewMatrix, viewMatrix, [0, 0, -this.cDist])
    mat4.rotateX(viewMatrix, viewMatrix, this.cRot[1])
    mat4.rotateY(viewMatrix, viewMatrix, this.cRot[0])
    mat4.translate(viewMatrix, viewMatrix, this.cPos);
    return viewMatrix
  }

  private selectBlock(x: number, y: number) {
    const viewMatrix = this.getViewMatrix()
    this.renderer2.drawColoredStructure(viewMatrix)
    const color = new Uint8Array(4)
    this.gl2.readPixels(x, this.canvas2.height - y, 1, 1, this.gl2.RGBA, this.gl2.UNSIGNED_BYTE, color)
    const oldSelectedBlock = this.selectedBlock ? [...this.selectedBlock] : null
    if (color[3] === 255) {
      this.selectedBlock = [color[0], color[1], color[2]]
    } else {
      this.selectedBlock = null
    }
    if (JSON.stringify(oldSelectedBlock) !== JSON.stringify(this.selectedBlock)) {
      this.showSidePanel()
      this.render()
    }
  }

  private showSidePanel() {
    this.root.querySelector('.side-panel')?.remove()
    const block = this.selectedBlock ? this.structure.getBlock(this.selectedBlock) : null
    

    const sidePanel = document.createElement('div')
    sidePanel.classList.add('side-panel')
    this.root.append(sidePanel)
    if (block) {
      const properties = block.state.getProperties()
      sidePanel.innerHTML = `
        <div class="block-name">${block.state.getName()}</div>
        ${Object.keys(properties).length === 0 ? '' : `
          <div class="block-props">
          ${Object.entries(properties).map(([k, v]) => `
            <span class="prop-key">${k}</span>
            <span class="prop-value">${v}</span>
          `).join('')}
          </div>
        `}
      `
      if (block.nbt) {
        const nbtTree = document.createElement('div')
        sidePanel.append(nbtTree)
        const tree = new TreeEditor(nbtTree, this.vscode)
        tree.onInit({ region: false, gzipped: false, data: { name: '', value: block.nbt } })
        tree.reveal()
      }
    } else {
      sidePanel.innerHTML = `
        <div class="structure-size">
          <label>Size</label><input type="number"><input type="number"><input type="number">
        </div>
      `
      sidePanel.querySelectorAll('.structure-size input').forEach((el, i) => {
        const original = this.structure.getSize()[i]
        ;(el as HTMLInputElement).value = original.toString()
        el.addEventListener('change', () => {
          this.vscode.postMessage({ type: 'edit', body: {
            ops: [{
              type: 'set',
              path: ['size', i],
              old: original,
              new: parseInt((el as HTMLInputElement).value)
            }]
          } })
        })
      })
    }
  }
}
