import type { BlockPos, NbtFile } from 'deepslate'
import type { BlockOptions } from '../assets/Types'
import type { ViewMessage } from '../common/types'
import type { EditHandler, VSCode } from './Editor'
import { canBuildStructure, removeStructureBlock, setStructureBlock } from './StructureEditing'

type Mode = 'Select' | 'Place' | 'Replace' | 'Erase'
export class BlockBuilder {
	private readonly panel = document.createElement('section')
	private readonly search = document.createElement('input')
	private readonly namespace = document.createElement('select')
	private readonly list = document.createElement('div')
	private readonly propertyPanel = document.createElement('div')
	private readonly label = document.createElement('div')
	private readonly status = document.createElement('div')
	private readonly navigation = document.createElement('div')
	private readonly modes = new Map<Mode, HTMLButtonElement>()
	private readonly coordinates: HTMLInputElement[] = []
	private readonly actions: HTMLButtonElement[] = []
	private brush?: string
	private properties: Record<string, string> = {}
	private mode: Mode = 'Select'
	private visible = false
	private active = false
	private readonly optionCache = new Map<string, BlockOptions>()
	private catalogGeneration = 0
	private optionsGeneration = 0
	private offset = 0
	private hostTotal = 0
	private localMatches: string[] = []
	private debounce?: ReturnType<typeof setTimeout>
	private pending = false
	private optionsLoading = false
	constructor(private readonly vscode: VSCode, private readonly file: () => NbtFile, private readonly edit: EditHandler, private readonly readOnly: boolean, private readonly vanillaIds: () => string[], private readonly vanillaOptions: (id: string) => BlockOptions | undefined, private readonly select: (pos: BlockPos | null) => void) {
		this.panel.className = 'block-builder'
		this.panel.setAttribute('aria-label', 'Build structure')
		const heading = document.createElement('div')
		heading.className = 'builder-heading'
		heading.textContent = 'Build structure'
		const close = this.button('Close', () => this.toggle())
		heading.append(close)
		this.panel.append(heading)
		const toolbar = document.createElement('div')
		toolbar.className = 'builder-modes'
		for (const mode of ['Select', 'Place', 'Replace', 'Erase'] as const) {
			const button = this.button(mode, () => this.setMode(mode))
			button.dataset.mode = mode
			this.modes.set(mode, button)
			toolbar.append(button)
		}
		this.panel.append(toolbar)
		this.namespace.setAttribute('aria-label', 'Block namespace')
		this.namespace.append(new Option('All mods and vanilla', ''))
		this.namespace.addEventListener('change', () => this.requestCatalog(0))
		this.search.placeholder = 'Find a block to place'
		this.search.setAttribute('aria-label', this.search.placeholder)
		this.search.addEventListener('input', () => {
			this.catalogGeneration++
			if (this.debounce) clearTimeout(this.debounce)
			this.debounce = setTimeout(() => this.requestCatalog(0), 150)
		})
		this.list.className = 'builder-block-list'
		this.list.setAttribute('role', 'list')
		this.label.className = 'builder-brush'
		this.label.textContent = 'Choose a block from the list'
		this.propertyPanel.className = 'builder-properties'
		this.panel.append(this.namespace, this.search, this.list, this.navigation, this.label, this.propertyPanel)
		const coordinates = document.createElement('div')
		coordinates.className = 'builder-coordinates'
		for (const axis of ['X', 'Y', 'Z']) {
			const label = document.createElement('label')
			label.textContent = axis
			const input = document.createElement('input')
			input.type = 'number'; input.step = '1'; input.min = '0'; input.value = '0'
			input.setAttribute('aria-label', `Build ${axis}`)
			this.coordinates.push(input)
			label.append(input); coordinates.append(label)
		}
		const set = this.button('Set block at coordinates', () => this.commit(false, this.readPosition()))
		const remove = this.button('Remove at coordinates', () => this.commit(true, this.readPosition()))
		this.actions.push(set, remove)
		this.status.className = 'builder-status'
		this.status.setAttribute('role', 'status')
		const help = document.createElement('p')
		help.className = 'builder-help'
		help.textContent = 'Place: click a block face or the floor. Replace/Erase: click a block. Drag to rotate; right drag to pan. Click the scene to use W A S D, Space and Shift. Save with Ctrl+S; undo with Ctrl+Z.'
		this.panel.append(coordinates, set, remove, this.status, help)
		this.updateControls()
	}
	private button(label: string, action: () => void): HTMLButtonElement {
		const button = document.createElement('button')
		button.type = 'button'; button.textContent = label
		button.addEventListener('click', action)
		return button
	}
	private editable(): boolean { return !this.readOnly && !!this.file() && canBuildStructure(this.file()) }
	toggle(): void {
		this.visible = !this.visible
		this.panel.hidden = !this.visible
		if (this.visible) { this.layout(); this.updateControls(); this.requestCatalog(0) }
		else this.setMode('Select')
	}
	reveal(root: Element): void { this.active = true; root.append(this.panel); this.panel.hidden = !this.visible; this.layout(); this.updateControls(); if (this.visible) this.requestCatalog(this.offset) }
	layout(): void {
		const top = (document.querySelector('.panel-menu')?.getBoundingClientRect().bottom ?? 32) + 10
		this.panel.style.top = `${top}px`
		this.panel.style.maxHeight = `calc(100vh - ${top + 12}px)`
	}
	hide(): void { this.active = false; this.setMode('Select'); this.catalogGeneration++; if (this.debounce) clearTimeout(this.debounce) }
	onUpdate(): void { if (this.pending) this.status.textContent = 'Block changed. Save with Ctrl+S.'; this.pending = false; this.updateControls() }
	private setMode(mode: Mode): void { this.mode = mode; this.updateControls() }
	private updateControls(): void {
		const editable = this.editable()
		for (const [mode, button] of this.modes) {
			button.classList.toggle('active', mode === this.mode)
			button.setAttribute('aria-pressed', String(mode === this.mode))
			button.disabled = mode !== 'Select' && (!editable || this.pending)
		}
		this.actions.forEach((button, i) => button.disabled = !editable || this.pending || i === 0 && (!this.brush || this.optionsLoading))
		if (!editable && this.visible) this.status.textContent = this.readOnly ? 'This file is read-only.' : 'Build tools edit Java structure NBT files. Use New NBT structure to start a new build; schematic and chunk files keep their existing viewers.'
	}
	private readPosition(): BlockPos { return this.coordinates.map(input => input.value === '' ? NaN : Number(input.value)) as BlockPos }
	private target(pos: BlockPos): void { this.coordinates.forEach((input, i) => input.value = String(pos[i])) }
	click(pos: BlockPos | null, normal?: BlockPos, ground?: BlockPos): void {
		if (pos) this.target(pos)
		if (!this.visible || this.mode === 'Select') return
		if (this.mode === 'Erase') { if (pos) this.commit(true, pos); return }
		if (this.mode === 'Replace') { if (pos) this.commit(false, pos); return }
		const target = pos && normal ? pos.map((n, i) => n + normal[i]) as BlockPos : ground
		if (target) this.commit(false, target)
	}
	private commit(remove: boolean, position: BlockPos): void {
		if (!this.editable() || this.pending) return
		if (!remove && !this.brush) { this.status.textContent = 'Choose a block first.'; return }
		if (!remove && this.optionsLoading) { this.status.textContent = 'Wait for the block properties to load.'; return }
		try {
			const edit = remove ? removeStructureBlock(this.file(), position) : setStructureBlock(this.file(), position, this.brush!, this.properties)
			if (!edit) { this.status.textContent = 'There is no block at this position.'; return }
			if (edit.type === 'composite' && edit.edits.length === 0) { this.status.textContent = 'This block already matches. No changes needed.'; return }
			this.pending = true
			this.target(position)
			this.select(remove ? null : position)
			this.status.textContent = remove ? 'Removing block…' : 'Placing block…'
			this.updateControls()
			this.edit(edit)
		} catch (error) { this.pending = false; this.status.textContent = error instanceof Error ? error.message : String(error); this.updateControls() }
	}
	private requestCatalog(offset: number): void {
		if (!this.visible || !this.active) return
		this.offset = offset
		const query = this.search.value.trim().toLowerCase().slice(0, 128)
		const namespace = this.namespace.value
		this.localMatches = this.vanillaIds().filter(id => (!namespace || id.startsWith(`${namespace}:`)) && id.includes(query))
		this.status.textContent = 'Loading block list…'
		this.vscode.postMessage({ type: 'getBlockCatalog', body: { query, namespace, offset, generation: ++this.catalogGeneration } })
	}
	onMessage(message: ViewMessage): void {
		if (message.type === 'resourcesChanged') {
			this.optionCache.clear(); this.optionsGeneration++; this.brush = undefined; this.properties = {}; this.optionsLoading = false
			this.label.textContent = 'Choose a block from the current pack'; this.propertyPanel.replaceChildren(); this.setMode('Select')
			if (this.visible) this.requestCatalog(0)
			return
		}
		if (message.type === 'editError') { this.pending = false; this.status.textContent = message.body; this.updateControls(); return }
		if (message.type === 'blockCatalog' && message.generation === this.catalogGeneration) {
			this.hostTotal = message.body?.total ?? 0
			const namespaces = [...new Set(['minecraft', ...(message.body?.namespaces ?? [])])].sort()
			const selected = this.namespace.value
			this.namespace.replaceChildren(new Option('All mods and vanilla', ''), ...namespaces.map(id => new Option(id, id)))
			this.namespace.value = selected
			const ids = [...new Set([...(message.body?.ids ?? []), ...this.localMatches.slice(this.offset, this.offset + 100)])].sort()
			this.list.replaceChildren(...ids.map(id => {
				const button = this.button(id, () => this.choose(id))
				button.dataset.block = id; button.setAttribute('role', 'listitem')
				button.classList.toggle('active', id === this.brush)
				return button
			}))
			this.navigation.replaceChildren()
			if (this.offset > 0) this.navigation.append(this.button('Previous blocks', () => this.requestCatalog(Math.max(0, this.offset - 100))))
			if (this.offset + 100 < this.hostTotal || this.offset + 100 < this.localMatches.length) this.navigation.append(this.button('Next blocks', () => this.requestCatalog(this.offset + 100)))
			this.status.textContent = message.error ? `Mod list: ${message.error}. Vanilla blocks remain available.` : ids.length ? 'Choose a block, then place it in the scene or at coordinates.' : 'No matching blocks in the selected assets.'
			this.updateControls()
		}
		if (message.type === 'blockOptions' && message.generation === this.optionsGeneration) {
			if (message.body && message.body.id === this.brush) {
				if (this.optionCache.size >= 64) this.optionCache.delete(this.optionCache.keys().next().value!)
				this.optionCache.set(message.body.id, message.body)
				this.showProperties(message.body)
			}
			else { this.properties = {}; this.propertyPanel.replaceChildren(); this.status.textContent = `Block properties: ${message.error ?? 'Unavailable'}. Choose another block.` }
		}
	}
	private choose(id: string): void {
		this.brush = id; this.properties = {}
		this.optionsLoading = true
		this.label.textContent = id
		this.list.querySelectorAll<HTMLButtonElement>('button').forEach(button => button.classList.toggle('active', button.dataset.block === id))
		this.setMode('Place')
		this.propertyPanel.replaceChildren()
		this.optionsGeneration++
		const local = this.optionCache.get(id) ?? this.vanillaOptions(id)
		if (local) this.showProperties(local)
		else this.vscode.postMessage({ type: 'getBlockOptions', body: { id, generation: this.optionsGeneration } })
	}
	private showProperties(options: BlockOptions): void {
		if (options.id !== this.brush) return
		this.optionsLoading = false
		this.properties = { ...options.defaults }
		this.propertyPanel.replaceChildren()
		for (const [key, values] of Object.entries(options.properties)) {
			if (!values.length) continue
			const label = document.createElement('label')
			label.textContent = key
			const select = document.createElement('select')
			select.setAttribute('aria-label', `Block property ${key}`)
			select.append(...values.map(value => new Option(value, value)))
			select.value = this.properties[key] ?? values[0]
			this.properties[key] = select.value
			select.addEventListener('change', () => this.properties[key] = select.value)
			label.append(select); this.propertyPanel.append(label)
		}
		this.updateControls()
	}
}
