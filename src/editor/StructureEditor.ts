import type { StructureProvider } from 'deepslate'
import { BlockPos, NbtFile, NbtInt, NbtType, Structure } from 'deepslate'
import { mat4, vec2, vec3 } from 'gl-matrix'
import { mapEdit } from '../common/Operations'
import type { NbtEdit, ViewMessage } from '../common/types'
import type { EditHandler, EditorPanel, VSCode } from './Editor'
import { locale } from './Locale'
import { ResourceManager } from './ResourceManager'
import { ae2ModelRequests } from '../assets/Ae2'
import { ReloadableRenderer } from './ReloadableRenderer'
import { litematicToStructure, schematicToStructure, spongeToStructure } from './Schematics'
import { TreeEditor } from './TreeEditor'
import { clamp, clampVec3, negVec3 } from './Util'
import { BlockBuilder } from './BlockBuilder'
import { intersectBox } from './StructureEditing'

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
	protected readonly renderer: ReloadableRenderer
	protected readonly renderer2: ReloadableRenderer
	private modded = true
	private resourceGeneration = 0
	private readonly resourceStatus = document.createElement('div')
	private readonly maxAtlasSize: number
	private highlighted: BlockPos[] = []
	private readonly builder: BlockBuilder
	private readonly cancelDrag = () => {}

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
		this.builder = new BlockBuilder(this.vscode, () => this.file, this.editHandler, readOnly, () => this.resources.availableBlocks(), id => this.resources.blockOptions(id), pos => { this.selectedBlock = pos; this.showSidePanel(); this.render() })

		this.canvas = document.createElement('canvas')
		this.canvas.className = 'structure-3d'
		this.canvas.tabIndex = 0
		this.canvas.setAttribute('aria-label', 'Structure scene. Drag to rotate; right drag to pan. Click here before using W A S D, Space and Shift.')
		const gl = this.canvas.getContext('webgl')!
		this.structure = new Structure([0, 0, 0])
		this.maxAtlasSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number
		this.renderer = new ReloadableRenderer(gl, this.structure, this.resources)

		this.canvas2 = document.createElement('canvas')
		this.canvas2.className = 'structure-3d click-detection'
		this.gl2 = this.canvas2.getContext('webgl')!
		this.renderer2 = new ReloadableRenderer(this.gl2, this.structure, this.resources)
		this.resourceStatus.className = 'resource-status'

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

		let dragPos: [number, number] | null = null
		let dragStart: [number, number] | null = null
		let dragged = false
		let dragButton: number
		this.cancelDrag = () => { dragPos = null; dragStart = null }
		this.canvas.addEventListener('contextmenu', evt => evt.preventDefault())
		this.canvas.addEventListener('pointerdown', evt => {
			if (![0, 1, 2].includes(evt.button)) return
			this.canvas.focus({ preventScroll: true })
			this.canvas.setPointerCapture(evt.pointerId)
			dragPos = [evt.clientX, evt.clientY]
			dragStart = [...dragPos]
			dragged = false
			dragButton = evt.button
			evt.preventDefault()
		})
		this.canvas.addEventListener('pointermove', evt => {
			if (!evt.buttons) { this.cancelDrag(); return }
			if (dragPos) {
				if (dragStart && Math.hypot(evt.clientX - dragStart[0], evt.clientY - dragStart[1]) > 4) dragged = true
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
		this.canvas.addEventListener('pointerup', evt => {
			const rect = this.canvas.getBoundingClientRect()
			const click = dragPos && !dragged && dragButton === 0 && evt.clientX >= rect.left && evt.clientX < rect.right && evt.clientY >= rect.top && evt.clientY < rect.bottom
			this.cancelDrag()
			if (this.canvas.hasPointerCapture(evt.pointerId)) this.canvas.releasePointerCapture(evt.pointerId)
			if (click) this.selectBlock(evt.clientX, evt.clientY)
		})
		this.canvas.addEventListener('pointercancel', this.resetInput)
		this.canvas.addEventListener('lostpointercapture', () => this.cancelDrag())
		this.canvas.addEventListener('blur', this.resetInput)
		window.addEventListener('blur', this.resetInput)
		document.addEventListener('visibilitychange', this.resetInput)
		this.canvas.addEventListener('wheel', evt => {
			this.cDist += evt.deltaY / 100
			this.cDist = Math.max(1, Math.min(100, this.cDist))
			this.render()
		})

		window.addEventListener('resize', () => {
			if (!this.file || !this.canvas.isConnected) return
			this.builder.layout()
			this.showSidePanel()
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
			const delta = Math.min(50, Math.max(0, time - requestTime))
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
			for (const pos of this.highlighted) this.renderer.drawOutline(viewMatrix, pos)
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
		this.root.append(this.resourceStatus)
		this.builder.reveal(this.root)
		this.showSidePanel()
		document.addEventListener('keydown', this.onKeyDown)
		document.addEventListener('keyup', this.onKeyUp)
	}

	hide() {
		this.resetInput()
		this.builder.hide()
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
		this.builder.onUpdate()
		this.render()
	}

	private readonly onKeyDown = (evt: KeyboardEvent) => {
		if (evt.target !== this.canvas || evt.ctrlKey || evt.metaKey || evt.altKey) return
		const index = this.movementKeys.indexOf(evt.code)
		if (index !== -1) {
			this.movement[index] = 1
			evt.preventDefault()
			this.render()
		}
	}
	private readonly resetInput = () => { this.movement.fill(0); this.cancelDrag() }

	private readonly onKeyUp = (evt: KeyboardEvent) => {
		const index = this.movementKeys.indexOf(evt.code)
		if (index !== -1) {
			this.movement[index] = 0
		}
	}

	protected updateStructure(file: NbtFile) {
		this.file = file
		this.structure = this.loadStructure()
		const isLarge = this.isLarge()
		const toggle = document.querySelector('.invisible-blocks-toggle')
		toggle?.classList.toggle('unavailable', isLarge)
		toggle?.setAttribute('title', isLarge ? locale('invisibleBlocksUnavailable') : '')

		if (isLarge) {
			this.warning.classList.add('active')
			this.requestResources()
			return
		}

		this.buildStructure()
		this.requestResources()
	}

	protected isLarge() {
		const [x, y, z] = this.structure.getSize()
		return x * y * z > 48 * 48 * 48
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
		const isLarge = this.isLarge()
		this.renderer.useInvisibleBlocks = !isLarge
		this.renderer2.useInvisibleBlocks = !isLarge
		const bound = this.resources.bind(this.structure)
		this.renderer.setStructure(bound)
		this.renderer2.setStructure(bound)
	}

	private requestResources(): void {
		if (!this.modded) return
		const ids = [...new Set(this.structure.getBlocks().map(b => b.state.getName().toString()))]
		if (ids.length > 8192) { this.resourceStatus.textContent = 'Asset limit exceeded: showing vanilla/fallback models'; return }
		const dependencies = this.resources.dependencies(ids)
		dependencies.models = [...new Set([...dependencies.models, ...ae2ModelRequests(this.structure)])]
		this.resourceStatus.textContent = 'Loading instance models and textures…'
		this.vscode.postMessage({ type: 'getResources', body: { ids, ...dependencies, generation: ++this.resourceGeneration } })
	}

	onMessage(message: ViewMessage): void {
		this.builder.onMessage(message)
		if (message.type === 'resourcesChanged') { if (this.file) this.requestResources(); return }
		if (message.type !== 'resources' || message.generation !== this.resourceGeneration || !this.modded) return
		if (message.error || !message.body) { this.resourceStatus.textContent = `Resources: ${message.error ?? 'No response'}`; return }
		const generation = message.generation
		void (async () => {
			try {
				await this.resources.apply(message.body!, this.maxAtlasSize, () => generation !== this.resourceGeneration || !this.modded)
				if (generation !== this.resourceGeneration || !this.modded) return
				this.refreshResources()
				const diagnostics = [...this.resources.diagnostics]
				this.resourceStatus.textContent = diagnostics.length ? `${diagnostics.length} resource warnings — Show Resource Diagnostics for details` : 'Instance resources loaded'
				this.resourceStatus.title = diagnostics.slice(0, 15).join('\n')
				this.vscode.postMessage({ type: 'resourceDiagnostics', body: diagnostics })
			} catch (e) { this.resourceStatus.textContent = `Resource error: ${e instanceof Error ? e.message : String(e)}` }
		})()
	}

	private refreshResources(): void {
		this.renderer.refreshAtlas(this.resources.getTextureAtlas())
		this.renderer2.refreshAtlas(this.resources.getTextureAtlas())
		if (!this.isLarge() || !this.warning.classList.contains('active')) this.buildStructure()
		this.showSidePanel()
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

		const invisibleBlocksToggle = document.createElement('div')
		invisibleBlocksToggle.classList.add('btn', 'invisible-blocks-toggle')
		invisibleBlocksToggle.textContent = locale('invisibleBlocks')
		invisibleBlocksToggle.classList.toggle('active', this.invisibleBlocksActive)
		invisibleBlocksToggle.addEventListener('click', () => {
			if (!this.renderer.useInvisibleBlocks) return
			this.invisibleBlocksActive = !this.invisibleBlocksActive
			invisibleBlocksToggle.classList.toggle('active', this.invisibleBlocksActive)
			this.render()
		})

		const moddedToggle = document.createElement('div')
		moddedToggle.className = this.modded ? 'btn active' : 'btn'
		moddedToggle.textContent = 'Modded assets'
		moddedToggle.addEventListener('click', () => {
			this.modded = !this.modded
			moddedToggle.classList.toggle('active', this.modded)
			this.resourceGeneration++
			if (this.modded) this.requestResources()
			else { this.resources.reset(); this.refreshResources(); this.resourceStatus.textContent = 'Vanilla assets only' }
		})
		const reload = document.createElement('div')
		reload.className = 'btn'
		reload.textContent = 'Reload assets'
		reload.addEventListener('click', () => this.requestResources())
		const search = document.createElement('input')
		search.className = 'block-search'
		search.placeholder = 'Highlight namespace or block ID'
		search.setAttribute('aria-label', search.placeholder)
		search.addEventListener('input', () => {
			const query = search.value.trim().toLowerCase()
			this.highlighted = query ? this.structure.getBlocks().filter(b => b.state.getName().toString().includes(query)).slice(0, 200).map(b => b.pos) : []
			search.title = this.highlighted.length === 200 ? 'Showing the first 200 matches' : `${this.highlighted.length} matches`
			this.render()
		})
		const build = document.createElement('button')
		build.className = 'btn'
		build.textContent = 'Build'
		build.addEventListener('click', () => this.builder.toggle())
		const create = document.createElement('button')
		create.className = 'btn'
		create.textContent = 'New NBT structure'
		create.addEventListener('click', () => this.vscode.postMessage({ type: 'newStructure', body: { dataVersion: this.file.root.getNumber('DataVersion') } }))
		return [gridToggle, invisibleBlocksToggle, moddedToggle, reload, build, create, search]
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
		this.resize()
		const rect = this.canvas.getBoundingClientRect()
		const viewMatrix = this.getViewMatrix()
		this.renderer2.drawColoredStructure(viewMatrix)
		const color = new Uint8Array(4)
		this.gl2.readPixels(Math.floor((x - rect.left) / rect.width * this.canvas2.width), this.canvas2.height - 1 - Math.floor((y - rect.top) / rect.height * this.canvas2.height), 1, 1, this.gl2.RGBA, this.gl2.UNSIGNED_BYTE, color)
		const oldSelectedBlock = this.selectedBlock ? [...this.selectedBlock] : null
		if (color[3] === 255) {
			this.selectedBlock = [color[0], color[1], color[2]]
		} else {
			this.selectedBlock = null
		}
		const projection = mat4.perspective(mat4.create(), 70 * Math.PI / 180, rect.width / rect.height, 0.1, 500)
		const inverse = mat4.invert(mat4.create(), mat4.multiply(mat4.create(), projection, viewMatrix))
		if (inverse) {
			const nx = (x - rect.left) / rect.width * 2 - 1
			const ny = 1 - (y - rect.top) / rect.height * 2
			const origin = vec3.transformMat4(vec3.create(), [nx, ny, -1], inverse)
			const end = vec3.transformMat4(vec3.create(), [nx, ny, 1], inverse)
			const direction = vec3.normalize(vec3.create(), vec3.sub(vec3.create(), end, origin))
			const hit = this.selectedBlock && intersectBox([...origin], [...direction], this.selectedBlock, this.selectedBlock.map(n => n + 1))
			let ground: BlockPos | undefined
			if (!this.selectedBlock && Math.abs(direction[1]) > 1e-8) {
				const distance = -origin[1] / direction[1]
				if (distance >= 0) ground = [Math.floor(origin[0] + direction[0] * distance), 0, Math.floor(origin[2] + direction[2] * distance)]
			}
			this.builder.click(this.selectedBlock, hit?.normal, ground)
		}
		if (JSON.stringify(oldSelectedBlock) !== JSON.stringify(this.selectedBlock)) {
			this.showSidePanel()
			this.render()
		}
	}

	protected showSidePanel() {
		this.root.querySelector('.side-panel')?.remove()
		const block = this.selectedBlock ? this.structure.getBlock(this.selectedBlock) : null

		const readOnly = this.readOnly || !this.file.root.hasList('size', NbtType.Int, 3)

		const sidePanel = document.createElement('div')
		sidePanel.classList.add('side-panel')
		const menu = document.querySelector('.panel-menu')?.getBoundingClientRect()
		if (menu) sidePanel.style.top = `${menu.bottom + 8}px`
		this.root.append(sidePanel)
		if (block) {
			const properties = block.state.getProperties()
			sidePanel.innerHTML = `
				<div class="block-name">${escapeHtml(block.state.getName().toString())}</div>
				<div class="block-pos">${block.pos.join(' ')}</div>
				${Object.keys(properties).length === 0 ? '' : `
					<div class="block-props">
					${Object.entries(properties).map(([k, v]) => `
						<span class="prop-key">${escapeHtml(k)}</span>
						<span class="prop-value">${escapeHtml(v)}</span>
					`).join('')}
					</div>
				`}
			`
			const warnings = [...this.resources.diagnostics].filter(message => message.includes(block.state.getName().toString()))
			if (warnings.length) { const warning = document.createElement('div'); warning.className = 'model-warning'; warning.textContent = warnings.join('\n'); sidePanel.append(warning) }
			if (block.nbt) {
				const nbtTree = document.createElement('div')
				sidePanel.append(nbtTree)
				const blockIndex = this.file.root.getList('blocks', NbtType.Compound).getItems()
					.findIndex(t => BlockPos.equals(BlockPos.fromNbt(t.getList('pos')), block.pos))
				const tree = new TreeEditor(nbtTree, this.vscode, edit => {
					this.editHandler(mapEdit(edit, e => {
						return { ...e, path: ['blocks', blockIndex, 'nbt', ...e.path] }
					}))
				}, readOnly)
				tree.onInit(new NbtFile('', block.nbt, 'none', this.file.littleEndian, undefined))
				tree.reveal()
			}
		} else {
			sidePanel.innerHTML = `
				<div class="structure-size">
					<label>Size</label>
					<input type="number" ${readOnly ? 'readonly' : ''}>
					<input type="number" ${readOnly ? 'readonly' : ''}>
					<input type="number" ${readOnly ? 'readonly' : ''}>
				</div>
			`
			sidePanel.querySelectorAll('.structure-size input').forEach((el, i) => {
				const original = this.structure.getSize()[i];
				(el as HTMLInputElement).value = original.toString()
				if (readOnly) return

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

function escapeHtml(value: string): string { return value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!)) }
