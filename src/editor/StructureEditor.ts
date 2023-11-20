import type { StructureProvider } from 'deepslate'
import { BlockPos, NbtFile, NbtInt, NbtType, Structure, StructureRenderer } from 'deepslate'
import { mat4, vec2, vec3 } from 'gl-matrix'
import { mapEdit } from '../common/Operations'
import type { NbtEdit } from '../common/types'
import type { EditHandler, EditorPanel, VSCode } from './Editor'
import { locale } from './Locale'
import { ResourceManager } from './ResourceManager'
import { litematicToStructure, schematicToStructure, spongeToStructure } from './Schematics'
import { TreeEditor } from './TreeEditor'
import { clamp, clampVec3, negVec3 } from './Util'

declare const stringifiedAssets: string
declare const stringifiedBlocks: string
declare const stringifiedUvmapping: string

export class StructureEditor implements EditorPanel {
	private readonly resources: ResourceManager
	protected file: NbtFile
	protected structure: StructureProvider
	private readonly warning: HTMLDivElement
	private readonly canvas: HTMLCanvasElement
	private readonly canvas2: HTMLCanvasElement
	private readonly gl2: WebGLRenderingContext
	protected readonly renderer: StructureRenderer
	protected readonly renderer2: StructureRenderer

	private renderRequested = false

	private movement = [0, 0, 0, 0, 0, 0]
	private readonly movementKeys = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft']

	protected readonly cPos: vec3
	protected cRot: vec2
	protected cDist: number

	protected gridActive: boolean
	protected invisibleBlocksActive: boolean
	protected selectedBlock: BlockPos | null

	constructor(protected readonly root: Element, protected readonly vscode: VSCode, protected readonly editHandler: EditHandler, protected readonly readOnly: boolean) {
		const assets = JSON.parse(stringifiedAssets)
		const uvMapping = JSON.parse(stringifiedUvmapping)
		const blocks = JSON.parse(stringifiedBlocks)
		const img = (document.querySelector('.texture-atlas') as HTMLImageElement)
		this.resources = new ResourceManager(blocks, { ...assets, textures: uvMapping }, img)

		this.canvas = document.createElement('canvas')
		this.canvas.className = 'structure-3d'
		const gl = this.canvas.getContext('webgl')!
		this.structure = new Structure([0, 0, 0])
		this.renderer = new StructureRenderer(gl, this.structure, this.resources)

		this.canvas2 = document.createElement('canvas')
		this.canvas2.className = 'structure-3d click-detection'
		this.gl2 = this.canvas2.getContext('webgl')!
		this.renderer2 = new StructureRenderer(this.gl2, this.structure, this.resources)

		this.warning = document.createElement('div')
		this.warning.className = 'nbt-warning'
		const warningMsg = document.createElement('span')
		warningMsg.textContent = 'Trying to render a very large structure'
		this.warning.append(warningMsg)
		const warningButton = document.createElement('div')
		warningButton.className = 'btn active'
		warningButton.textContent = 'Continue'
		warningButton.addEventListener('click', () => {
			this.warning.classList.remove('active')
			this.root.innerHTML = '<div class="spinner"></div>'
			setTimeout(() => {
				this.buildStructure()
				this.reveal()
				this.render()
			})
		})
		this.warning.append(warningButton)

		this.cPos = vec3.create()
		this.cRot = vec2.fromValues(0.4, 0.6)
		this.cDist = 10

		this.gridActive = true
		this.invisibleBlocksActive = false
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
				} else if (dragButton === 2 || dragButton === 1) {
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
				this.render()
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
			this.render()
		})

		window.addEventListener('resize', () => {
			if (this.resize()) this.render()
		})

		this.render()
	}

	render() {
		if (this.renderRequested) {
			return
		}
		const requestTime = performance.now()
		this.renderRequested = true
		requestAnimationFrame((time) => {
			const delta = Math.max(0, time - requestTime)
			this.renderRequested = false
			this.resize()

			if (this.movement.some(m => m)) {
				vec3.rotateY(this.cPos, this.cPos, [0, 0, 0], this.cRot[0])
				const [w, a, s, d, space, shift] = this.movement
				const move = vec3.fromValues(a - d, shift - space, w - s)
				vec3.scaleAndAdd(this.cPos, this.cPos, move, delta * 0.02)
				vec3.rotateY(this.cPos, this.cPos, [0, 0, 0], -this.cRot[0])
				this.render()
			}

			const viewMatrix = this.getViewMatrix()

			if (this.gridActive) {
				this.renderer.drawGrid(viewMatrix)
			}

			if (this.invisibleBlocksActive) {
				this.renderer.drawInvisibleBlocks(viewMatrix)
			}

			this.renderer.drawStructure(viewMatrix)

			if (this.selectedBlock) {
				this.renderer.drawOutline(viewMatrix, this.selectedBlock)
			}
		})
	}

	resize() {
		const displayWidth2 = this.canvas2.clientWidth
		const displayHeight2 = this.canvas2.clientHeight
		if (this.canvas2.width !== displayWidth2 || this.canvas2.height !== displayHeight2) {
			this.canvas2.width = displayWidth2
			this.canvas2.height = displayHeight2
			this.renderer2.setViewport(0, 0, this.canvas2.width, this.canvas2.height)
		}

		const displayWidth = this.canvas.clientWidth
		const displayHeight = this.canvas.clientHeight
		if (this.canvas.width !== displayWidth || this.canvas.height !== displayHeight) {
			this.canvas.width = displayWidth
			this.canvas.height = displayHeight
			this.renderer.setViewport(0, 0, this.canvas.width, this.canvas.height)
			return true
		}
		return false
	}

	reveal() {
		this.root.append(this.warning)
		this.root.append(this.canvas)
		this.root.append(this.canvas2)
		this.showSidePanel()
		document.addEventListener('keydown', this.onKeyDown)
		document.addEventListener('keyup', this.onKeyUp)
	}

	hide() {
		document.removeEventListener('keydown', this.onKeyDown)
		document.removeEventListener('keyup', this.onKeyUp)
	}

	onInit(file: NbtFile) {
		this.updateStructure(file)
		vec3.copy(this.cPos, this.structure.getSize())
		vec3.scale(this.cPos, this.cPos, -0.5)
		this.cDist = vec3.dist([0, 0, 0], this.cPos) * 1.5
		this.render()
	}

	onUpdate(file: NbtFile, edit: NbtEdit) {
		this.updateStructure(file)
		this.showSidePanel()
		this.render()
	}

	private readonly onKeyDown = (evt: KeyboardEvent) => {
		const index = this.movementKeys.indexOf(evt.code)
		if (index !== -1) {
			this.movement[index] = 1
			this.render()
		}
	}

	private readonly onKeyUp = (evt: KeyboardEvent) => {
		const index = this.movementKeys.indexOf(evt.code)
		if (index !== -1) {
			this.movement[index] = 0
		}
	}

	protected updateStructure(file: NbtFile) {
		this.file = file
		this.structure = this.loadStructure()

		const [x, y, z] = this.structure.getSize()
		if (x * y * z > 48 * 48 * 48) {
			this.warning.classList.add('active')
			return
		}

		this.buildStructure()
	}

	protected loadStructure() {
		if (this.file.root.get('BlockData')?.isByteArray() && this.file.root.hasCompound('Palette')) {
			return spongeToStructure(this.file.root)
		}
		if (this.file.root.hasCompound('Regions')) {
			return litematicToStructure(this.file.root)
		}
		if (this.file.root.get('Blocks')?.isByteArray() && this.file.root.get('Data')?.isByteArray()) {
			return schematicToStructure(this.file.root)
		}
		return Structure.fromNbt(this.file.root)
	}

	private buildStructure() {
		const [x, y, z] = this.structure.getSize()
		const skipInvisibleBlocks = x * y * z > 48 * 48 * 48
		this.renderer.useInvisibleBlocks = !skipInvisibleBlocks
		this.renderer2.useInvisibleBlocks = !skipInvisibleBlocks
		this.renderer.setStructure(this.structure)
		this.renderer2.setStructure(this.structure)
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

		const invisibleBlocksToggle = document.createElement('div')
		invisibleBlocksToggle.classList.add('btn')
		invisibleBlocksToggle.textContent = locale('invisibleBlocks')
		invisibleBlocksToggle.classList.toggle('active', this.invisibleBlocksActive)
		invisibleBlocksToggle.addEventListener('click', () => {
			this.invisibleBlocksActive = !this.invisibleBlocksActive
			invisibleBlocksToggle.classList.toggle('active', this.invisibleBlocksActive)
			this.render()
		})

		return [gridToggle, invisibleBlocksToggle]
	}

	private getViewMatrix() {
		const viewMatrix = mat4.create()
		mat4.translate(viewMatrix, viewMatrix, [0, 0, -this.cDist])
		mat4.rotateX(viewMatrix, viewMatrix, this.cRot[1])
		mat4.rotateY(viewMatrix, viewMatrix, this.cRot[0])
		mat4.translate(viewMatrix, viewMatrix, this.cPos)
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

	protected showSidePanel() {
		this.root.querySelector('.side-panel')?.remove()
		const block = this.selectedBlock ? this.structure.getBlock(this.selectedBlock) : null

		const sidePanel = document.createElement('div')
		sidePanel.classList.add('side-panel')
		this.root.append(sidePanel)
		if (block) {
			const properties = block.state.getProperties()
			sidePanel.innerHTML = `
				<div class="block-name">${block.state.getName()}</div>
				<div class="block-pos">${block.pos.join(' ')}</div>
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
				const blockIndex = this.file.root.getList('blocks', NbtType.Compound).getItems()
					.findIndex(t => BlockPos.equals(BlockPos.fromNbt(t.getList('pos')), block.pos))
				const tree = new TreeEditor(nbtTree, this.vscode, edit => {
					this.editHandler(mapEdit(edit, e => {
						return { ...e, path: ['blocks', blockIndex, 'nbt', ...e.path] }
					}))
				}, this.readOnly)
				tree.onInit(new NbtFile('', block.nbt, 'none', this.file.littleEndian, undefined))
				tree.reveal()
			}
		} else {
			sidePanel.innerHTML = `
				<div class="structure-size">
					<label>Size</label><input type="number"><input type="number"><input type="number">
				</div>
			`
			sidePanel.querySelectorAll('.structure-size input').forEach((el, i) => {
				const original = this.structure.getSize()[i];
				(el as HTMLInputElement).value = original.toString()
				if (this.readOnly) return

				el.addEventListener('change', () => {
					this.editHandler({
						type: 'set',
						path: ['size', i],
						old: new NbtInt(original).toJsonWithId(),
						new: new NbtInt(parseInt((el as HTMLInputElement).value)).toJsonWithId(),
					})
				})
			})
		}
	}
}
