import type { NamedNbtTag } from 'deepslate'
import { tagNames } from 'deepslate'
import { NbtPath } from '../common/NbtPath'
import type { SearchQuery } from '../common/Operations'
import { getNode, replaceNode, searchNodes } from '../common/Operations'
import { Snbt } from '../common/Snbt'
import type { NbtEditOp, NbtFile } from '../common/types'
import type { EditHandler, EditorPanel, SearchResult, VSCode } from './Editor'
import { locale } from './Locale'

export type SelectedTag = {
	path: NbtPath,
	type: string,
	data: () => any,
	el: Element,
}

export type EditingTag = Omit<SelectedTag, 'path'> & { path: NbtPath | null }

type PathToElements = {
	element?: Element,
	childs?: {
		[key in string | number]: PathToElements
	},
}

export class TreeEditor implements EditorPanel {
	static readonly EXPANDABLE_TYPES = new Set(['compound', 'list', 'byteArray', 'intArray', 'longArray'])

	static readonly PARSERS: Record<string, (value: string) => any> = {
		string: v => v,
		byte: v => parseInt(v),
		short: v => parseInt(v),
		int: v => parseInt(v),
		float: v => parseFloat(v),
		double: v => parseFloat(v),
		long: v => Snbt.parseLong(v),
	}

	static readonly SERIALIZERS: Record<string, (value: any) => string> = {
		string: v => v,
		byte: v => `${v}`,
		short: v => `${v}`,
		int: v => `${v}`,
		float: v => `${v}`,
		double: v => `${v}`,
		long: v => Snbt.stringifyLong(v),
	}

	static readonly DEFAULTS: Record<string, () => any> = {
		string: () => '',
		byte: () => 0,
		short: () => 0,
		int: () => 0,
		float: () => 0,
		double: () => 0,
		long: () => [0, 0],
		list: () => ({ type: 'end', value: [] }),
		compound: () => ({}),
		byteArray: () => [],
		intArray: () => [],
		longArray: () => [],
	}

	protected expanded: Set<string>
	protected content: HTMLDivElement
	protected data: NamedNbtTag

	protected pathToElement: PathToElements
	protected highlighted: null | NbtPath
	protected selected: null | SelectedTag
	protected editing: null | EditingTag

	constructor(protected root: Element, protected vscode: VSCode, protected editHandler: EditHandler, protected readOnly: boolean) {
		this.expanded = new Set()
		this.expand(new NbtPath())

		this.content = document.createElement('div')
		this.content.className = 'nbt-content'
		this.data = { name: '', value: {} }
		this.pathToElement = {childs: {}}
		this.highlighted = null
		this.selected = null
		this.editing = null
	}

	reveal() {
		this.root.append(this.content)
		if (this.selected) {
			this.select(this.selected)
		}
		document.addEventListener('keydown', this.onKey)
	}

	hide() {
		document.removeEventListener('keydown', this.onKey)
	}

	onInit(file: NbtFile) {
		if (file.region !== false) return
		this.data = file.data
		const rootKeys = Object.keys(this.data.value)
		if (rootKeys.length === 1) {
			this.expand(new NbtPath([rootKeys[0]]))
		}
		this.select(null)
		this.editing = null
		this.redraw()
	}

	onUpdate(file: NbtFile) {
		this.onInit(file)
	}

	onSearch(query: SearchQuery | null): SearchResult[] {
		if (query === null) {
			const prevHighlight = this.highlighted
			this.highlighted = null
			this.hidePath(prevHighlight)
			return []
		}
		const searchResults = searchNodes(this.data, query)
		return searchResults.map(path => ({
			path,
			show: () => this.showPath(path),
			replace: (query) => replaceNode(this.data, path, query),
		}))
	}

	private async showPath(path: NbtPath) {
		if (this.highlighted?.equals(path)) {
			return
		}
		const redrawStart = path.pop().subPaths()
			.find(p => !this.expanded.has(p.toString()))
		const prevHighlight = this.highlighted
		this.highlighted = path
		if (redrawStart) {
			const { type, value } = getNode(this.data, redrawStart)
			const el = this.getPathElement(redrawStart)
			if (el) {
				await this.openBody(redrawStart, type, value, el)
			}
		}
		this.hidePath(prevHighlight)
		const resultEl = this.getPathElement(path)
		if (resultEl) {
			resultEl.classList.add('highlighted')
			const bounds = resultEl.getBoundingClientRect()
			if (bounds.bottom > window.innerHeight || bounds.top < 0) {
				resultEl.scrollIntoView({ block: 'center' })
			}
		}
	}

	private hidePath(prevHighlight: NbtPath | null) {
		this.root.querySelectorAll('.nbt-tag.highlighted')
			.forEach(e => e.classList.remove('highlighted'))
		const pathToClose = prevHighlight?.subPaths()
			.find(p => !this.isExpanded(p))
		if (pathToClose) {
			const el = this.getPathElement(pathToClose)
			if (el && el.classList.contains('collapse')) {
				this.closeBody(pathToClose, el!)
			}
		}
	}

	menu() {
		if (this.readOnly) return []

		const actionButton = (action: string, fn: (...args: any[]) => void) => {
			const el = document.createElement('div')
			el.className = `btn btn-${action}-tag disabled`
			el.textContent = locale(`${action}Tag`)
			el.addEventListener('click', () => {
				if (!this.selected) return
				this.selected.el.scrollIntoView({ block: 'center' })
				fn.bind(this)(this.selected.path, this.selected.type, this.selected.data(), this.selected.el)
			})
			return el
		}

		const editTag = actionButton('edit', this.clickTag)
		const removeTag = actionButton('remove', this.removeTag)
		const addTag = actionButton('add', this.addTag)
		const renameTag = actionButton('rename', this.renameTag)
		return [removeTag, editTag, addTag, renameTag]
	}

	protected onKey = (evt: KeyboardEvent) => {
		const s = this.selected
		if (evt.key === 'Delete' && s) {
			this.removeTag(s.path, s.type, s.data(), s.el)
		} else if (evt.key === 'F2' && s) {
			this.renameTag(s.path, s.type, s.data(), s.el)
		} else if (evt.key === 'Escape') {
			if (this.editing === null) {
				this.select(null)
			} else {
				this.clearEditing()
			}
		}
	}

	protected redraw() {
		this.pathToElement = { childs: {} }
		const root = this.drawTag(new NbtPath(), 'compound', this.data.value)
		this.content.innerHTML = ''
		this.content.append(root)
	}

	protected isExpanded(path: NbtPath) {
		const p = path.toString()
		return this.expanded.has(p) || this.highlighted?.pop().startsWith(path)
	}

	protected collapse(path: NbtPath) {
		const p = path.toString()
		this.expanded.delete(p)
	}

	protected expand(path: NbtPath) {
		path.subPaths().forEach(p => {
			this.expanded.add(p.toString())
		})
	}

	protected select(selected: SelectedTag | null) {
		if (this.readOnly) return

		this.selected = selected
		this.root.querySelectorAll('.nbt-tag.selected').forEach(e => e.classList.remove('selected'))
		if (selected) {
			this.expand(selected.path.pop())
			this.root.querySelectorAll('.nbt-tag.highlighted').forEach(e => e.classList.remove('highlighted'))
			selected.el.classList.add('selected')
		}

		const btnEditTag = document.querySelector('.btn-edit-tag') as HTMLElement
		btnEditTag?.classList.toggle('disabled', !selected || this.canExpand(selected.type))
		const btnAddTag = document.querySelector('.btn-add-tag') as HTMLElement
		btnAddTag?.classList.toggle('disabled', !selected || !this.canExpand(selected.type))
		const parentType = selected ? getNode(this.data, selected.path.pop()).type : null
		const btnRenameTag = document.querySelector('.btn-rename-tag') as HTMLElement
		btnRenameTag?.classList.toggle('disabled', parentType !== 'compound')
		const btnRemoveTag = document.querySelector('.btn-remove-tag') as HTMLElement
		btnRemoveTag?.classList.toggle('disabled', !this.selected || this.selected.path.length() === 0)
	}

	protected setPathElement(path: NbtPath, el: Element) {
		let node = this.pathToElement
		for (const e of path.arr) {
			if (!node.childs) node.childs = {}
			if (!node.childs[e]) node.childs[e] = {}
			node = node.childs[e]
		}
		node.element = el
	}

	protected getPathElement(path: NbtPath) {
		let node = this.pathToElement
		for (const e of path.arr) {
			if (!node.childs || !node.childs[e]) return undefined
			node = node.childs[e]
		}
		return node.element
	}

	protected drawTag(path: NbtPath, type: string, data: any) {
		const expanded = this.canExpand(type) && this.isExpanded(path)
		const el = document.createElement('div')
		const head = document.createElement('div')
		this.setPathElement(path, head)
		head.classList.add('nbt-tag')
		if (this.highlighted?.equals(path)) {
			head.classList.add('highlighted')
		}
		if (this.canExpand(type)) {
			head.classList.add('collapse')
			head.append(this.drawCollapse(path, () => this.clickTag(path, type, data, head)))
		}
		head.append(this.drawIcon(type))
		if (typeof path.last() === 'string') {
			head.append(this.drawKey(`${path.last()}: `))
		}
		head.append(this.drawTagHeader(path, type, data))
		head.addEventListener('click', () => {
			if (head === this.selected?.el) return
			this.clearEditing()
			this.select({path, type, data: () => data, el: head })
		})
		head.addEventListener('dblclick', () => {
			this.clickTag(path, type, data, head)
		})
		el.append(head)

		const body = expanded
			? this.drawTagBody(path, type, data)
			: document.createElement('div')
		body.classList.add('nbt-body')
		el.append(body)

		return el
	}

	protected canExpand(type: string) {
		return TreeEditor.EXPANDABLE_TYPES.has(type)
	}

	protected drawTagHeader(path: NbtPath, type: string, data: any): HTMLElement {
		try {
			if (type === 'compound') {
				return this.drawEntries(Object.keys(data))
			} else if (type === 'list') {
				return this.drawEntries(data.value)
			} else if (type.endsWith('Array')) {
				return this.drawEntries(data)
			} else {
				return this.drawPrimitiveTag(type, data)
			}
		} catch (e) {
			this.vscode.postMessage({ type: 'error', body: e.message })
			return this.drawError(e.message)
		}
	}

	protected drawTagBody(path: NbtPath, type: string, data: any): HTMLElement {
		try {
			switch(type) {
				case 'compound': return this.drawCompound(path, data)
				case 'list': return this.drawList(path, data)
				case 'byteArray': return this.drawArray(path, data, 'byte')
				case 'intArray': return this.drawArray(path, data, 'int')
				case 'longArray': return this.drawArray(path, data, 'long')
				default: return document.createElement('div')
			}
		} catch (e) {
			this.vscode.postMessage({ type: 'error', body: e.message })
			return this.drawError(e.message)
		}
	}

	protected drawError(message: string) {
		const el = document.createElement('span')
		el.classList.add('error')
		el.textContent = `Error "${message}"`
		return el
	}

	protected drawIcon(type: string) {
		const el = document.createElement('span')
		el.setAttribute('data-icon', type)
		return el
	}

	protected drawKey(key: string) {
		const el = document.createElement('span')
		el.classList.add('nbt-key')
		el.textContent = key
		return el
	}

	protected drawCollapse(path: NbtPath, handler: () => void) {
		const el = document.createElement('span')
		el.classList.add('nbt-collapse')
		el.textContent = this.isExpanded(path) ? '-' : '+'
		el.addEventListener('click', () => handler())
		return el
	}

	protected drawEntries(entries: any[]) {
		const el = document.createElement('span')
		el.classList.add('nbt-entries')
		el.textContent = `${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}`
		return el
	}

	protected drawCompound(path: NbtPath, data: any) {
		const el = document.createElement('div')
		Object.keys(data).sort().forEach(k => {
			const child = this.drawTag(path.push(k), data[k].type, data[k].value)
			el.append(child)
		})
		return el
	}

	protected drawList(path: NbtPath, data: any) {
		const el = document.createElement('div')
		data.value.forEach((v, i) => {
			const child = this.drawTag(path.push(i), data.type, v)
			el.append(child)
		})
		return el
	}

	protected drawArray(path: NbtPath, data: any, type: string) {
		const el = document.createElement('div')
		data.forEach((v, i) => {
			const child = this.drawTag(path.push(i), type, v)
			el.append(child)
		})
		return el
	}

	protected drawPrimitiveTag(type: string, data: any) {
		const el = document.createElement('span')
		el.classList.add('nbt-value')
		el.textContent = TreeEditor.SERIALIZERS[type](data)
		return el
	}

	protected clickTag(path: NbtPath, type: string, data: any, el: Element) {
		if (this.canExpand(type)) {
			this.clickExpandableTag(path, type, data, el)
		} else {
			this.clickPrimitiveTag(path, type, data, el)
		}
	}

	protected clickExpandableTag(path: NbtPath, type: string, data: any, el: Element) {
		if (this.expanded.has(path.toString())) {
			this.collapse(path)
			this.closeBody(path, el)
		} else {
			this.expand(path)
			this.openBody(path, type, data, el)
		}
	}

	protected closeBody(path: NbtPath, el: Element) {
		el.nextElementSibling!.innerHTML = ''
		el.querySelector('.nbt-collapse')!.textContent = '+'
	}

	protected async openBody(path: NbtPath, type: string, data: any, el: Element) {
		el.querySelector('.nbt-collapse')!.textContent = '-'
		const body = el.nextElementSibling!
		await new Promise((res) => setTimeout(res))
		body.innerHTML = ''
		body.append(this.drawTagBody(path, type, data))
	}

	protected clickPrimitiveTag(path: NbtPath, type: string, data: any, el: Element) {
		if (this.readOnly) return

		el.querySelector('span.nbt-value')?.remove()
		const value = TreeEditor.SERIALIZERS[type](data)

		const valueEl = document.createElement('input')
		el.append(valueEl)
		valueEl.classList.add('nbt-value')
		valueEl.value = value
		valueEl.focus()
		valueEl.setSelectionRange(value.length, value.length)
		valueEl.scrollLeft = valueEl.scrollWidth

		const confirmButton = document.createElement('button')
		el.append(confirmButton)
		confirmButton.classList.add('nbt-confirm')
		confirmButton.textContent = locale('confirm')
		const makeEdit = () => {
			const newData = TreeEditor.PARSERS[type](valueEl.value)
			if (JSON.stringify(data) !== JSON.stringify(newData)) {
				this.editHandler({ ops: [
					{ type: 'set', path: path.arr, old: data, new: newData },
				] })
			}
		}
		confirmButton.addEventListener('click', makeEdit)
		valueEl.addEventListener('keyup', evt => {
			if (evt.key === 'Enter') {
				makeEdit()
			}
		})
		this.setEditing(path, type, data, el)
	}

	protected removeTag(path: NbtPath, type: string, data: any, el: Element) {
		if (this.readOnly) return

		this.editHandler({ ops: [
			{ type: 'remove', path: path.arr, value: data, valueType: type },
		] })
	}

	protected addTag(path: NbtPath, type: string, data: any, el: Element) {
		if (this.readOnly) return

		const body = el.nextElementSibling!
		const root = document.createElement('div')
		body.prepend(root)
		const nbtTag = document.createElement('div')
		nbtTag.classList.add('nbt-tag')
		root.append(nbtTag)

		const typeRoot = document.createElement('div')
		nbtTag.append(typeRoot)

		const keyInput = document.createElement('input')
		if (type === 'compound') {
			keyInput.classList.add('nbt-key')
			keyInput.placeholder = locale('name')
			nbtTag.append(keyInput)
		}

		const valueInput = document.createElement('input')
		valueInput.classList.add('nbt-value')
		valueInput.placeholder = locale('value')
		nbtTag.append(valueInput)

		const typeSelect = document.createElement('select')
		if (type === 'compound' || data?.value?.length === 0) {
			typeRoot.classList.add('type-select')
			typeRoot.setAttribute('data-icon', 'byte')
			typeRoot.append(typeSelect)

			typeSelect.addEventListener('change', () => {
				typeRoot.setAttribute('data-icon', typeSelect.value)
			})
			tagNames.filter(t => t !== 'end').forEach(t => {
				const option = document.createElement('option')
				option.value = t
				option.textContent = t.charAt(0).toUpperCase() + t.slice(1).split(/(?=[A-Z])/).join(' ')
				typeSelect.append(option)
			})

			typeSelect.focus()
			typeSelect.addEventListener('change', () => {
				valueInput.classList.toggle('hidden', this.canExpand(typeSelect.value))
				nbtTag.querySelector('input')?.focus()
			})
		} else {
			const keyType = (type === 'list') ? data.type : type.replace(/Array$/, '')
			typeRoot.setAttribute('data-icon', keyType)
			valueInput.focus()
		}

		const confirmButton = document.createElement('button')
		nbtTag.append(confirmButton)
		confirmButton.classList.add('nbt-confirm')
		confirmButton.textContent = locale('confirm')
		const makeEdit = () => {
			const valueType = (type === 'compound' || data?.value?.length === 0)
				? typeSelect.value
				: (type === 'list') ? data.type : type.replace(/Array$/, '')
			const last = type === 'compound' ? keyInput.value : 0
			let newData = TreeEditor.DEFAULTS[valueType]()
			if (!this.canExpand(valueType)) {
				try {
					newData = TreeEditor.PARSERS[valueType](valueInput.value)
				} catch(e) {}
			}

			const edit: NbtEditOp = (data?.value?.length === 0)
				? { type: 'set', path: path.arr, new: { type: valueType, value: [newData] }, old: data }
				: { type: 'add', path: path.push(last).arr, value: newData, valueType }

			this.expand(path)
			this.editHandler({ ops: [edit] })
		}
		confirmButton.addEventListener('click', makeEdit)
		valueInput.addEventListener('keyup', evt => {
			if (evt.key === 'Enter') {
				makeEdit()
			}
		})
		this.setEditing(null, type, data, nbtTag)
	}

	protected renameTag(path: NbtPath, type: string, data: any, el: Element) {
		if (this.readOnly) return

		el.querySelector('span.nbt-key')?.remove()
		const valueEl = el.querySelector('.nbt-value, .nbt-entries')
		const key = path.last() as string

		const keyEl = document.createElement('input')
		el.insertBefore(keyEl, valueEl)
		keyEl.classList.add('nbt-value')
		keyEl.value = key
		keyEl.focus()
		keyEl.setSelectionRange(key.length, key.length)
		keyEl.scrollLeft = keyEl.scrollWidth

		const confirmButton = document.createElement('button')
		el.insertBefore(confirmButton, valueEl)
		confirmButton.classList.add('nbt-confirm')
		confirmButton.textContent = locale('confirm')
		const makeEdit = () => {
			const newKey = keyEl.value
			if (key !== newKey) {
				this.editHandler({ ops: [
					{ type: 'move', path: path.arr, target: path.pop().push(newKey).arr },
				] })
			}
			this.clearEditing()
		}
		confirmButton.addEventListener('click', makeEdit)
		keyEl.addEventListener('keyup', evt => {
			if (evt.key === 'Enter') {
				makeEdit()
			}
		})
		this.setEditing(path, type, data, el)
	}

	protected clearEditing() {
		if (this.editing && this.editing.el.parentElement) {
			if (this.editing.path === null) {
				this.editing.el.parentElement.remove()
			} else {
				const tag = this.drawTag(this.editing.path, this.editing.type, this.editing.data())
				this.editing.el.parentElement.replaceWith(tag)
				if (this.selected?.el === this.editing.el) {
					this.selected.el = tag.firstElementChild!
					this.selected.el.classList.add('selected')
				}
			}
		}
		this.editing = null
	}

	protected setEditing(path: NbtPath | null, type: string, data: any, el: Element) {
		this.clearEditing()
		this.editing = { path, type, data: () => data, el }
	}
}
