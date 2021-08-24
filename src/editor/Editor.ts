import { tagNames } from 'deepslate'
import type { NbtPath } from '../common/NbtPath'
import type { SearchQuery } from '../common/Operations'
import { applyEdit } from '../common/Operations'
import type { EditorMessage, NbtEdit, NbtEditOp, NbtFile, ViewMessage } from '../common/types'
import { locale } from './Locale'
import { MapEditor } from './MapEditor'
import { SnbtEditor } from './SnbtEditor'
import { StructureEditor } from './StructureEditor'
import { TreeEditor } from './TreeEditor'
import { getInt } from './Util'

export type VSCode = {
	postMessage(message: EditorMessage): void,
}

declare function acquireVsCodeApi(): VSCode
const vscode = acquireVsCodeApi()

const root = document.querySelector('.nbt-editor')!

function lazy<T>(getter: () => T) {
	let value: T | null = null
	return () => {
		if (value === null) {
			value = getter()
		}
		return value
	}
}

export type SearchResult = {
	path: NbtPath,
	show(): void,
	replace(replacement: SearchQuery): NbtEdit,
}

export interface EditorPanel {
	reveal?(): void
	hide?(): void
	onInit(file: NbtFile): void
	onUpdate(file: NbtFile, edit: NbtEdit): void
	onMessage?(message: ViewMessage): void
	onSearch?(query: SearchQuery | null): SearchResult[]
	menu?(): Element[]
}

export type EditHandler = (edit: NbtEdit) => void

class Editor {
	private readonly panels: {
		[key: string]: {
			editor: () => EditorPanel,
			updated?: boolean,
			options?: string[],
		},
	} = {
		structure: {
			editor: lazy(() => new StructureEditor(root, vscode, e => this.makeEdit(e), this.readOnly)),
			options: ['structure', 'default', 'snbt'],
		},
		map: {
			editor: lazy(() => new MapEditor(root, vscode, e => this.makeEdit(e), this.readOnly)),
			options: ['map', 'default', 'snbt'],
		},
		default: {
			editor: lazy(() => new TreeEditor(root, vscode, e => this.makeEdit(e), this.readOnly)),
			options: ['default', 'snbt'],
		},
		snbt: {
			editor: lazy(() => new SnbtEditor(root, vscode, e => this.makeEdit(e), this.readOnly)),
		},
	}

	private type: string
	private nbtFile: NbtFile
	private activePanel: string
	private readOnly: boolean

	private readonly findWidget: HTMLElement
	private searchQuery: SearchQuery = {}
	private searchResults: SearchResult[] | null = null
	private searchIndex: number = 0
	private lastReplace: NbtPath | null = null

	private selectedChunk: { x: number, z: number } = { x: 0, z: 0 }

	constructor() {
		window.addEventListener('message', async e => {
			this.onMessage(e.data)
		})

		this.findWidget = document.querySelector('.find-widget') as HTMLElement
		const findTypeSelect = this.findWidget.querySelector('.find-part > .type-select > select') as HTMLSelectElement
		const findNameInput = this.findWidget.querySelector('.find-part > .name-input') as HTMLInputElement
		const findValueInput = this.findWidget.querySelector('.find-part > .value-input') as HTMLInputElement
		findTypeSelect.addEventListener('change', () => {
			findTypeSelect.parentElement!.setAttribute('data-icon', findTypeSelect.value)
			this.doSearch()
		})
		this.findWidget.querySelectorAll('.type-select select').forEach(select => {
			['any', ...tagNames.filter(t => t !== 'end')].forEach(t => {
				const option = document.createElement('option')
				option.value = t
				option.textContent = t.charAt(0).toUpperCase() + t.slice(1).split(/(?=[A-Z])/).join(' ')
				select.append(option)
			})
			select.parentElement!.setAttribute('data-icon', 'any')
		})
		this.findWidget.querySelector<HTMLElement>('.find-part')?.addEventListener('keyup', evt => {
			if (evt.key !== 'Enter') {
				this.doSearch()
			}
		})
		this.findWidget.querySelector<HTMLElement>('.find-part')?.addEventListener('keydown', evt => {
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
		this.findWidget.querySelector<HTMLElement>('.replace-part')?.addEventListener('keydown', evt => {
			if (evt.key === 'Enter') {
				if (evt.altKey && evt.ctrlKey) {
					this.doReplaceAll()
				} else {
					this.doReplace()
				}
			}
		})
		const replaceExpand = this.findWidget.querySelector('.replace-expand')
		replaceExpand?.addEventListener('click', () => {
			const expanded = this.findWidget.classList.toggle('expanded')
			replaceExpand?.classList.remove('codicon-chevron-right', 'codicon-chevron-down')
			replaceExpand?.classList.add(expanded ? 'codicon-chevron-down' : 'codicon-chevron-right')
		})
		this.findWidget.querySelector('.replace')?.addEventListener('click', () => {
			this.doReplace()
		})
		this.findWidget.querySelector('.replace-all')?.addEventListener('click', () => {
			this.doReplaceAll()
		})

		document.querySelectorAll('.region-menu input').forEach(el => {
			el.addEventListener('change', () => {
				this.refreshChunk()
			})
			el.addEventListener('keydown', evt => {
				if ((evt as KeyboardEvent).key === 'Enter') {
					this.refreshChunk()
				}
			})
		})

		document.addEventListener('keydown', evt => {
			if (evt.ctrlKey && (evt.code === 'KeyF' || evt.code === 'KeyH')) {
				this.findWidget.classList.add('visible')
				if (this.searchQuery.name) {
					findNameInput.focus()
					findNameInput.setSelectionRange(0, findNameInput.value.length)
				} else {
					findValueInput.focus()
					findValueInput.setSelectionRange(0, findValueInput.value.length)
				}
				this.findWidget.classList.toggle('expanded', evt.code === 'KeyH')
				replaceExpand?.classList.remove('codicon-chevron-right', 'codicon-chevron-down')
				replaceExpand?.classList.add(evt.code === 'KeyH' ? 'codicon-chevron-down' : 'codicon-chevron-right')
				if (this.searchResults && this.searchResults.length > 0) {
					this.searchResults[this.searchIndex].show()
				}
			} else if (evt.key === 'Escape') {
				this.findWidget.classList.remove('visible')
				this.getPanel()?.onSearch?.(null)
			}
		})
		document.addEventListener('contextmenu', evt => {
			evt.preventDefault()
		})

		vscode.postMessage({ type: 'ready' })
	}

	private onMessage(m: ViewMessage) {
		switch (m.type) {
			case 'init':
				console.log(m.body)
				this.type = m.body.type
				this.nbtFile = m.body.content
				this.readOnly = m.body.readOnly
				this.setPanel(this.type)
				if (this.nbtFile.region) {
					this.refreshChunk()
				}
				return

			case 'update':
				try {
					applyEdit(this.nbtFile, m.body)
					this.refreshSearch()
					Object.values(this.panels).forEach(p => p.updated = false)
					if (this.nbtFile.region) {
						const chunk = this.nbtFile.chunks.find(c => c.x === this.selectedChunk.x && c.z === this.selectedChunk.z)
						if (chunk?.nbt) {
							const file: NbtFile = { region: false, data: chunk.nbt, gzipped: true }
							const ops = m.body.ops.map<NbtEditOp>(op => ({ ...op, path: op.path.slice(1) }))
							this.getPanel()?.onUpdate(file, { ops })
						}
					} else {
						this.getPanel()?.onUpdate(this.nbtFile, m.body)
					}
					this.panels[this.activePanel].updated = true
				} catch (e) {
					vscode.postMessage({ type: 'error', body: e.message })
				}
				return
			
			case 'chunk':
				if (!this.nbtFile.region) {
					return
				}
				const index = this.nbtFile.chunks.findIndex(c => c.x === m.body.x && c.z === m.body.z)
				this.nbtFile.chunks[index] = m.body
				if (m.body.nbt && this.selectedChunk.x === m.body.x && this.selectedChunk.z === m.body.z) {
					const file: NbtFile = { region: false, data: m.body.nbt!, gzipped: true }
					this.getPanel()?.onInit(file)
				}
				return

			default:
				this.panels[this.type].editor().onMessage?.(m)
		}
	}

	private getPanel(): EditorPanel | undefined {
		return this.panels[this.activePanel]?.editor()
	}

	private setPanel(panel: string) {
		root.innerHTML = '<div class="spinner"></div>'
		this.getPanel()?.hide?.()
		this.activePanel = panel
		const editorPanel = this.getPanel()!
		this.setPanelMenu(editorPanel)
		setTimeout(() => {
			if (!this.panels[panel].updated) {
				if (this.nbtFile.region) {
					const chunk = this.nbtFile.chunks.find(c => c.x === this.selectedChunk.x && c.z === this.selectedChunk.z)
					if (chunk?.nbt) {
						const file: NbtFile = { region: false, data: chunk.nbt, gzipped: true }
						editorPanel.onInit(file)
					}
				} else {
					editorPanel.onInit(this.nbtFile)
				}
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

	private refreshChunk() {
		if (!this.nbtFile?.region) {
			return
		}
		const x = getInt(document.getElementById('chunk-x')) ?? 0
		const z = getInt(document.getElementById('chunk-z')) ?? 0
		const chunk = this.nbtFile.chunks.find(c => c.x === x && c.z === z)
		document.querySelector('.region-menu')?.classList.toggle('invalid', !chunk)
		if (!chunk) {
			return
		}
		this.selectedChunk = { x, z };
		(document.getElementById('chunk-x') as HTMLInputElement).value = `${x}`;
		(document.getElementById('chunk-z') as HTMLInputElement).value = `${z}`
		if (chunk.nbt) {
			const file: NbtFile = { region: false, data: chunk.nbt, gzipped: true }
			this.getPanel()?.onInit(file)
		} else {
			console.log('Send message')
			vscode.postMessage({ type: 'getChunkData', body: { x, z } })
		}
	}

	private doSearch() {
		const query = this.getQuery(this.findWidget.querySelector('.find-part'))
		if (['type', 'name', 'value'].every(e => this.searchQuery?.[e] === query[e])) {
			return
		}
		this.searchQuery = query
		this.searchIndex = 0
		this.refreshSearch()
	}

	private refreshSearch() {
		const editorPanel = this.getPanel()
		if (editorPanel?.onSearch && (this.searchQuery.name || this.searchQuery.value || this.searchQuery.type)) {
			this.searchResults = editorPanel.onSearch(this.searchQuery)
		} else {
			this.searchResults = null
		}
		if (this.lastReplace && this.searchResults?.[this.searchIndex].path?.equals(this.lastReplace)) {
			this.searchIndex += 1
			this.lastReplace = null
		}
		this.showMatch(this.searchIndex)
	}

	private doReplace() {
		if (this.searchResults === null || this.searchResults.length === 0) return
		const query = this.getQuery(this.findWidget.querySelector('.replace-part'))
		if (query.name || query.value || query.type) {
			const result = this.searchResults[this.searchIndex]
			this.lastReplace = result.path
			this.makeEdit(result.replace(query))
		}
	}

	private doReplaceAll() {
		if (!this.searchResults) return
		const query = this.getQuery(this.findWidget.querySelector('.replace-part'))
		if (query.name || query.value || query.type) {
			const ops = this.searchResults.flatMap(r => r.replace(query).ops)
			this.makeEdit({ ops })
		}
	}

	private getQuery(element: Element | null): SearchQuery {
		const typeQuery = (element?.querySelector('.type-select > select') as HTMLSelectElement).value
		const nameQuery = (element?.querySelector('.name-input') as HTMLInputElement).value
		const valueQuery = (element?.querySelector('.value-input') as HTMLInputElement).value
		return {
			type: typeQuery === 'any' ? undefined : typeQuery,
			name: nameQuery || undefined,
			value: valueQuery || undefined,
		}
	}

	private showMatch(index: number) {
		if (this.searchResults === null || this.searchResults.length === 0) {
			this.findWidget.querySelector('.matches')!.textContent = 'No results'
			this.getPanel()?.onSearch?.(null)
		} else {
			const matches = this.searchResults.length
			this.searchIndex = (index % matches + matches) % matches
			this.findWidget.querySelector('.matches')!.textContent = `${this.searchIndex + 1} of ${matches}`
			this.searchResults[this.searchIndex].show()
		}
		this.findWidget.classList.toggle('no-results', this.searchResults !== null && this.searchResults.length === 0)
		this.findWidget.querySelectorAll('.previous-match, .next-match').forEach(e =>
			e.classList.toggle('disabled', this.searchResults === null || this.searchResults.length === 0))
	}

	private makeEdit(edit: NbtEdit) {
		if (this.readOnly) return
		console.warn('Edit', edit)
		vscode.postMessage({ type: 'edit', body: edit })
	}
}

new Editor()
