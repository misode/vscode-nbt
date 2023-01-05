import type { NbtCompound, NbtList } from 'deepslate'
import { NbtFile, NbtTag, NbtType } from 'deepslate'
import { NbtPath } from '../common/NbtPath'
import type { SearchQuery } from '../common/Operations'
import { getNode, parsePrimitive, replaceNode, searchNodes, serializePrimitive } from '../common/Operations'
import type { NbtEdit } from '../common/types'
import type { EditHandler, EditorPanel, SearchResult, VSCode } from './Editor'
import { TYPES } from './Editor'
import { locale } from './Locale'

export type SelectedTag = {
	path: NbtPath,
	tag: NbtTag,
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
	static readonly EXPANDABLE_TYPES = new Set([NbtType.Compound, NbtType.List, NbtType.ByteArray, NbtType.IntArray, NbtType.LongArray])

	protected expanded: Set<string>
	protected content: HTMLDivElement
	protected file: NbtFile
	protected prefix: NbtPath

	protected pathToElement: PathToElements
	protected highlighted: null | NbtPath
	protected selected: null | SelectedTag
	protected editing: null | EditingTag

	constructor(protected root: Element, protected vscode: VSCode, protected editHandler: EditHandler, protected readOnly: boolean) {
		this.expanded = new Set()
		this.content = document.createElement('div')
		this.content.className = 'nbt-content'
		this.file = NbtFile.create()
		this.prefix = new NbtPath()
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

	onInit(file: NbtFile, prefix?: NbtPath) {
		if (prefix) {
			this.prefix = prefix
		}
		this.file = file
		this.expand(this.prefix)
		const rootKeys = [...this.file.root.keys()]
		if (rootKeys.length === 1) {
			this.expand(this.prefix.push(rootKeys[0]))
		}
		this.select(null)
		this.editing = null
		this.redraw()
	}

	onUpdate(data: NbtFile) {
		this.onInit(data)
	}

	onSearch(query: SearchQuery | null): SearchResult[] {
		if (query === null) {
			const prevHighlight = this.highlighted
			this.highlighted = null
			this.hidePath(prevHighlight)
			return []
		}
		const searchResults = searchNodes(this.file.root, query)
		return searchResults.map(path => ({
			path,
			show: () => this.showPath(path),
			replace: (query) => replaceNode(this.file.root, path, query),
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
			const tag = getNode(this.file.root, redrawStart)
			const el = this.getPathElement(redrawStart)
			if (el) {
				await this.openBody(redrawStart, tag, el)
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
				fn.bind(this)(this.selected.path, this.selected.tag, this.selected.el)
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
		if (evt.key == 'a' && s) {
			this.addTag(s.path, s.tag, s.el)
		} else if (evt.key === 'Delete' && s) {
			this.removeTag(s.path, s.tag, s.el)
		} else if (evt.key === 'F2' && s) {
			this.renameTag(s.path, s.tag, s.el)
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
		const root = this.drawTag(this.prefix, this.file.root)
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
		btnEditTag?.classList.toggle('disabled', !selected || this.canExpand(selected.tag))
		const btnAddTag = document.querySelector('.btn-add-tag') as HTMLElement
		btnAddTag?.classList.toggle('disabled', !selected || !this.canExpand(selected.tag))
		const parent = selected ? getNode(this.file.root, selected.path.pop()) : null
		const btnRenameTag = document.querySelector('.btn-rename-tag') as HTMLElement
		btnRenameTag?.classList.toggle('disabled', !parent?.isCompound())
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

	protected drawTag(path: NbtPath, tag: NbtTag) {
		const expanded = this.canExpand(tag) && this.isExpanded(path)
		const el = document.createElement('div')
		const head = document.createElement('div')
		this.setPathElement(path, head)
		head.classList.add('nbt-tag')
		if (this.highlighted?.equals(path)) {
			head.classList.add('highlighted')
		}
		if (this.canExpand(tag)) {
			head.classList.add('collapse')
			head.append(this.drawCollapse(path, () => this.clickTag(path, tag, head)))
		}
		head.append(this.drawIcon(tag))
		if (typeof path.last() === 'string') {
			head.append(this.drawKey(`${path.last()}: `))
		}
		head.append(this.drawTagHeader(tag))
		head.addEventListener('click', () => {
			if (head === this.selected?.el) return
			this.clearEditing()
			this.select({path, tag, el: head })
		})
		head.addEventListener('dblclick', () => {
			this.clickTag(path, tag, head)
		})
		el.append(head)

		const body = expanded
			? this.drawTagBody(path, tag)
			: document.createElement('div')
		body.classList.add('nbt-body')
		el.append(body)

		return el
	}

	protected canExpand(tag: NbtTag | number) {
		return TreeEditor.EXPANDABLE_TYPES.has(typeof tag === 'number' ? tag : tag.getId())
	}

	protected drawTagHeader(tag: NbtTag): HTMLElement {
		try {
			if (tag.isCompound()) {
				return this.drawEntries(tag.size)
			} else if (tag.isList()) {
				return this.drawEntries(tag.length)
			} else if (tag.isArray()) {
				return this.drawEntries(tag.length)
			} else {
				return this.drawPrimitiveTag(tag)
			}
		} catch (e) {
			this.vscode.postMessage({ type: 'error', body: e.message })
			return this.drawError(e.message)
		}
	}

	protected drawTagBody(path: NbtPath, tag: NbtTag): HTMLElement {
		try {
			switch(tag.getId()) {
				case NbtType.Compound: return this.drawCompound(path, tag as NbtCompound)
				case NbtType.List: return this.drawList(path, tag as NbtList)
				case NbtType.ByteArray: return this.drawArray(path, tag)
				case NbtType.IntArray: return this.drawArray(path, tag)
				case NbtType.LongArray: return this.drawArray(path, tag)
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

	protected drawIcon(tag: NbtTag) {
		const el = document.createElement('span')
		el.setAttribute('data-icon', NbtType[tag.getId()])
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

	protected drawEntries(length: number) {
		const el = document.createElement('span')
		el.classList.add('nbt-entries')
		el.textContent = `${length} entr${length === 1 ? 'y' : 'ies'}`
		return el
	}

	protected drawCompound(path: NbtPath, tag: NbtCompound) {
		const el = document.createElement('div');
		[...tag.keys()].sort().forEach(key => {
			const child = this.drawTag(path.push(key), tag.get(key)!)
			el.append(child)
		})
		return el
	}

	protected drawList(path: NbtPath, tag: NbtList) {
		const el = document.createElement('div')
		tag.forEach((v, i) => {
			const child = this.drawTag(path.push(i), v)
			el.append(child)
		})
		return el
	}

	protected drawArray(path: NbtPath, tag: NbtTag) {
		if (!tag.isArray()) {
			throw new Error(`Trying to draw an array, but got a ${NbtType[tag.getId()]}`)
		}
		const el = document.createElement('div')
		tag.forEach((v, i) => {
			const child = this.drawTag(path.push(i), v)
			el.append(child)
		})
		return el
	}

	protected drawPrimitiveTag(tag: NbtTag) {
		const el = document.createElement('span')
		el.classList.add('nbt-value')
		el.textContent = serializePrimitive(tag)
		return el
	}

	protected clickTag(path: NbtPath, tag: NbtTag, el: Element) {
		if (this.canExpand(tag)) {
			this.clickExpandableTag(path, tag, el)
		} else {
			this.clickPrimitiveTag(path, tag, el)
		}
	}

	protected clickExpandableTag(path: NbtPath, tag: NbtTag, el: Element) {
		if (this.expanded.has(path.toString())) {
			this.collapse(path)
			this.closeBody(path, el)
		} else {
			this.expand(path)
			this.openBody(path, tag, el)
		}
	}

	protected closeBody(path: NbtPath, el: Element) {
		el.nextElementSibling!.innerHTML = ''
		el.querySelector('.nbt-collapse')!.textContent = '+'
	}

	protected async openBody(path: NbtPath, tag: NbtTag, el: Element) {
		el.querySelector('.nbt-collapse')!.textContent = '-'
		const body = el.nextElementSibling!
		await new Promise((res) => setTimeout(res))
		body.innerHTML = ''
		body.append(this.drawTagBody(path, tag))
	}

	protected clickPrimitiveTag(path: NbtPath, tag: NbtTag, el: Element) {
		if (this.readOnly) return

		el.querySelector('span.nbt-value')?.remove()
		const value = serializePrimitive(tag)

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
			const newTag = parsePrimitive(tag.getId(), valueEl.value).toJsonWithId()
			const oldTag = tag.toJsonWithId()
			if (JSON.stringify(oldTag) !== JSON.stringify(newTag)) {
				this.editHandler({ type: 'set', path: path.arr, old: oldTag, new: newTag })
			}
		}
		confirmButton.addEventListener('click', makeEdit)
		valueEl.addEventListener('keyup', evt => {
			if (evt.key === 'Enter') {
				makeEdit()
			}
		})
		this.setEditing(path, tag, el)
	}

	protected removeTag(path: NbtPath, tag: NbtTag, el: Element) {
		if (this.readOnly) return

		this.editHandler({ type: 'remove', path: path.arr, value: tag.toJsonWithId() })
	}

	protected addTag(path: NbtPath, tag: NbtTag, el: Element) {
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
		if (tag.isCompound()) {
			keyInput.classList.add('nbt-key')
			keyInput.placeholder = locale('name')
			nbtTag.append(keyInput)
		}

		const valueInput = document.createElement('input')
		valueInput.classList.add('nbt-value')
		valueInput.placeholder = locale('value')
		nbtTag.append(valueInput)

		const typeSelect = document.createElement('select')
		if (tag.isCompound() || (tag.isList() && tag.length === 0)) {
			typeRoot.classList.add('type-select')
			typeRoot.setAttribute('data-icon', 'Byte')
			typeRoot.append(typeSelect)

			TYPES.filter(t => t !== 'End').forEach(t => {
				const option = document.createElement('option')
				option.value = t
				option.textContent = t.charAt(0).toUpperCase() + t.slice(1).split(/(?=[A-Z])/).join(' ')
				typeSelect.append(option)
			})

			const onChangeType = () => {
				typeRoot.setAttribute('data-icon', typeSelect.value)
				const typeSelectId = NbtType[typeSelect.value] as number
				valueInput.classList.toggle('hidden', this.canExpand(typeSelectId))
			}

			typeSelect.focus()
			typeSelect.addEventListener('change', onChangeType)
			const hotKeys = {
				c: NbtType.Compound,
				l: NbtType.List,
				s: NbtType.String,
				b: NbtType.Byte,
				t: NbtType.Short,
				i: NbtType.Int,
				g: NbtType.Long,
				f: NbtType.Float,
				d: NbtType.Double,
			}
			typeSelect.addEventListener('keydown', evt => {
				if (hotKeys[evt.key]) {
					typeSelect.value = NbtType[hotKeys[evt.key]]
					onChangeType()
					evt.preventDefault()
					nbtTag.querySelector('input')?.focus()
				}
			})
		} else if (tag.isListOrArray()) {
			const keyType = tag.getType()
			typeRoot.setAttribute('data-icon', NbtType[keyType])
			valueInput.focus()
		}

		const confirmButton = document.createElement('button')
		nbtTag.append(confirmButton)
		confirmButton.classList.add('nbt-confirm')
		confirmButton.textContent = locale('confirm')
		const makeEdit = () => {
			const valueType = (tag.isCompound() || (tag.isList() && tag.length === 0))
				? NbtType[typeSelect.value] as number
				: (tag.isListOrArray() ? tag.getType() : NbtType.End)
			const last = tag.isCompound() ? keyInput.value : 0
			let newTag = NbtTag.create(valueType)
			if (!this.canExpand(valueType)) {
				try {
					newTag = parsePrimitive(valueType, valueInput.value)
				} catch(e) {}
			}

			const edit: NbtEdit = { type: 'add', path: path.push(last).arr, value: newTag.toJsonWithId() }

			this.expand(path)
			this.editHandler(edit)
		}
		confirmButton.addEventListener('click', makeEdit)
		valueInput.addEventListener('keyup', evt => {
			if (evt.key === 'Enter') {
				makeEdit()
			}
		})
		this.setEditing(null, tag, nbtTag)
	}

	protected renameTag(path: NbtPath, tag: NbtTag, el: Element) {
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
				this.editHandler({ type: 'move', source: path.arr, path: path.pop().push(newKey).arr })
			}
			this.clearEditing()
		}
		confirmButton.addEventListener('click', makeEdit)
		keyEl.addEventListener('keyup', evt => {
			if (evt.key === 'Enter') {
				makeEdit()
			}
		})
		this.setEditing(path, tag, el)
	}

	protected clearEditing() {
		if (this.editing && this.editing.el.parentElement) {
			if (this.editing.path === null) {
				this.editing.el.parentElement.remove()
			} else {
				const tag = this.drawTag(this.editing.path, this.editing.tag)
				this.editing.el.parentElement.replaceWith(tag)
				if (this.selected?.el === this.editing.el) {
					this.selected.el = tag.firstElementChild!
					this.selected.el.classList.add('selected')
				}
			}
		}
		this.editing = null
	}

	protected setEditing(path: NbtPath | null, tag: NbtTag, el: Element) {
		this.clearEditing()
		this.editing = { path, tag, el }
	}
}
