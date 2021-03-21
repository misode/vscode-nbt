import { tagNames } from "@webmc/nbt";
import { applyEdit, SearchQuery } from "../../src/common/Operations";
import { NbtFile, NbtEdit, EditorMessage, ViewMessage } from "../../src/common/types"
import { MapEditor } from './MapEditor';
import { RegionEditor } from "./RegionEditor";
import { SnbtEditor } from "./SnbtEditor";
import { StructureEditor } from "./StructureEditor";
import { TreeEditor } from "./TreeEditor";

export type VSCode = {
	postMessage(message: EditorMessage): void
}

declare function acquireVsCodeApi(): VSCode
const vscode = acquireVsCodeApi();

const root = document.querySelector('.nbt-editor')!

const LOCALES = {
	'copy': 'Copy',
	'name': 'Name',
	'value': 'Value',
	'confirm': 'Confirm',
	'addTag': 'Add Tag',
	'editTag': 'Edit',
	'removeTag': 'Remove',
	'renameTag': 'Rename',
	'grid': 'Show Grid',
	'invisibleBlocks': 'Show Invisible Blocks',
  'panel.structure': '3D',
  'panel.map': 'Map',
  'panel.region': 'Region',
	'panel.default': 'Default',
	'panel.snbt': 'SNBT',
}

function lazy<T>(getter: () => T) {
	let value: T | null = null
	return () => {
		if (value === null) {
			value = getter()
		}
		return value
	}
}

export function locale(key: string) {
  return LOCALES[key] ?? key
}

export type SearchResult = {
	show(): void
}

export interface EditorPanel {
	reveal?(): void
	hide?(): void
	onInit(file: NbtFile): void
	onUpdate(file: NbtFile, edit: NbtEdit): void
	onMessage?(message: ViewMessage): void
	onSearch?(query: SearchQuery): SearchResult[]
	onHideSearch?(): void
	menu?(): Element[]
}

export type EditHandler = (edit: NbtEdit) => void

class Editor {
	private panels: {
		[key: string]: {
			editor: () => EditorPanel
			updated?: boolean
			options?: string[]
		}
	} = {
		'structure': {
			editor: lazy(() => new StructureEditor(root, vscode, e => this.makeEdit(e), this.readOnly)),
			options: ['structure', 'default', 'snbt']
		},
		'map': {
			editor: lazy(() => new MapEditor(root, vscode, e => this.makeEdit(e), this.readOnly)),
			options: ['map', 'default', 'snbt']
		},
		'region': {
			editor: lazy(() => new RegionEditor(root, vscode, e => this.makeEdit(e), this.readOnly)),
			options: ['region']
		},
		'default': {
			editor: lazy(() => new TreeEditor(root, vscode, e => this.makeEdit(e), this.readOnly)),
			options: ['default', 'snbt']
		},
		'snbt': {
			editor: lazy(() => new SnbtEditor(root, vscode, e => this.makeEdit(e), this.readOnly))
		}
	}

	private type: string
	private nbtFile: NbtFile
	private activePanel: string
	private readOnly: boolean

	private findWidget: HTMLElement
	private searchQuery: SearchQuery = {}
	private searchResults: null | SearchResult[] = null
	private searchIndex: number = 0

	constructor() {
		window.addEventListener('message', async e => {
			this.onMessage(e.data)
		});

		this.findWidget = document.querySelector('.find-widget') as HTMLElement
		const findTypeSelect = this.findWidget.querySelector('.type-select > select') as HTMLSelectElement
		const findNameInput = this.findWidget.querySelector('.name-input') as HTMLInputElement
		const findValueInput = this.findWidget.querySelector('.value-input') as HTMLInputElement
		findTypeSelect.addEventListener('change', () => {
			findTypeSelect.parentElement!.setAttribute('data-icon', findTypeSelect.value)
			this.doSearch()
		})
		;['any', ...tagNames.filter(t => t !== 'end')].forEach(t => {
			const option = document.createElement('option')
			option.value = t
			option.textContent = t.charAt(0).toUpperCase() + t.slice(1).split(/(?=[A-Z])/).join(' ')
			findTypeSelect.append(option)
		})
		findTypeSelect.parentElement!.setAttribute('data-icon', 'any')
		this.findWidget.addEventListener('keyup', evt => {
			if (evt.key !== 'Enter') {
				this.doSearch()
			}
		})
		this.findWidget.addEventListener('keydown', evt => {
			if (evt.key === 'Enter') {
				if (evt.shiftKey) {
					this.showMatch(this.searchIndex - 1)
				} else {
					this.showMatch(this.searchIndex + 1)
				}
			}
		})
		this.findWidget.querySelector('.previous-match')?.addEventListener('click', () => {
			this.showMatch(this.searchIndex - 1)
		})
		this.findWidget.querySelector('.next-match')?.addEventListener('click', () => {
			this.showMatch(this.searchIndex + 1)
		})
		this.findWidget.querySelector('.close-widget')?.addEventListener('click', () => {
			this.findWidget.classList.remove('visible')
		})

		document.addEventListener('keydown', evt => {
			if (evt.ctrlKey && evt.code === 'KeyF') {
				this.findWidget.classList.add('visible')
				if (this.searchQuery.name) {
					findNameInput.focus()
					findNameInput.setSelectionRange(0, findNameInput.value.length)
				} else {
					findValueInput.focus()
					findValueInput.setSelectionRange(0, findValueInput.value.length)
				}
				if (this.searchResults && this.searchResults.length > 0) {
					this.searchResults[this.searchIndex].show()
				}
			} else if (evt.key === 'Escape') {
				this.findWidget.classList.remove('visible')
				this.panels[this.activePanel]?.editor().onHideSearch?.()
			}
		})

		vscode.postMessage({ type: 'ready' })
	}

	onMessage(m: ViewMessage) {
		switch (m.type) {
			case 'init':
				console.log(m.body)
				this.type = m.body.type
				this.nbtFile = m.body.content
				this.readOnly = m.body.readOnly
				this.setPanel(this.type)
				return;

			case 'update':
				try {
					applyEdit(this.nbtFile, m.body)
					Object.values(this.panels).forEach(p => p.updated = false)
					this.panels[this.activePanel].editor().onUpdate(this.nbtFile, m.body)
					this.panels[this.activePanel].updated = true
				} catch (e) {
					vscode.postMessage({ type: 'error', body: e.message })
				}
				return;

			default:
				this.panels[this.type].editor().onMessage?.(m)
		}
	}

	private setPanel(panel: string) {
		root.innerHTML = `<div class="spinner"></div>`
		this.panels[this.activePanel]?.editor().hide?.()
		this.activePanel = panel
		const editorPanel = this.panels[panel].editor()
		this.setPanelMenu(editorPanel)
		setTimeout(() => {
			if (!this.panels[panel].updated) {
				editorPanel.onInit(this.nbtFile)
				this.panels[panel].updated = true
			}
			root.innerHTML = ''
			editorPanel?.reveal?.()
		})
	}

	private setPanelMenu(panel: EditorPanel) {
		const el = document.querySelector('.panel-menu')!
		el.innerHTML = ''
		const btnGroup = document.createElement('div')
		btnGroup.classList.add('btn-group')
		el.append(btnGroup)
		this.panels[this.type].options?.forEach((p: string) => {
			const button = document.createElement('div')
			btnGroup.append(button)
			button.classList.add('btn')
			button.textContent = locale(`panel.${p}`)
			if (p === this.activePanel) {
				button.classList.add('active')
			} else {
				button.addEventListener('click', () => this.setPanel(p))
			}
		})
		if (panel.menu) {
			el.insertAdjacentHTML('beforeend', '<div class="menu-spacer"></div>')
			panel.menu().forEach(e => el.append(e))
		}
	}

	private doSearch() {
		const typeQuery = (this.findWidget.querySelector('.type-select > select') as HTMLSelectElement).value
		const nameQuery = (this.findWidget.querySelector('.name-input') as HTMLInputElement).value
		const valueQuery = (this.findWidget.querySelector('.value-input') as HTMLInputElement).value
		const query = {
			type: typeQuery === 'any' ? undefined : typeQuery,
			name: nameQuery || undefined,
			value: valueQuery || undefined
		}
		if (this.searchQuery.type === query.type
			&& this.searchQuery.name === query.name
			&& this.searchQuery.value === query.value) {
				return
		}
		this.searchQuery = query

		const editorPanel = this.panels[this.activePanel]?.editor()
		if (editorPanel?.onSearch && (query.name || query.value || query.type)) {
			this.searchResults = editorPanel.onSearch(query)
			this.searchIndex = 0
		} else {
			this.searchResults = null
		}

		if (this.searchResults && this.searchResults.length > 0) {
			this.showMatch(0)
		} else {
			editorPanel.onHideSearch?.()
			this.findWidget.querySelector('.matches')!.textContent = `No results`
		}
		this.findWidget.classList.toggle('no-results', this.searchResults !== null && this.searchResults.length === 0)
		this.findWidget.querySelectorAll('.previous-match, .next-match').forEach(e =>
			e.classList.toggle('disabled', this.searchResults === null || this.searchResults.length === 0))
	}

	private showMatch(index: number) {
		if (this.searchResults === null) return
		const matches = this.searchResults.length
		if (matches === 0) return

		this.searchIndex = (index % matches + matches) % matches
		this.findWidget.querySelector('.matches')!.textContent = `${this.searchIndex + 1} of ${matches}`

		this.searchResults[this.searchIndex].show()
	} 

	private makeEdit(edit: NbtEdit) {
		if (this.readOnly) return
		vscode.postMessage({ type: 'edit', body: edit })
	}
}

new Editor()
