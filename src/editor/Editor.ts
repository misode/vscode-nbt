import type { NamedNbtTag } from 'deepslate'
import { tagNames } from 'deepslate'
import { NbtPath } from '../common/NbtPath'
import type { SearchQuery } from '../common/Operations'
import { applyEdit } from '../common/Operations'
import type { EditorMessage, NbtEdit, NbtEditOp, NbtFile, ViewMessage } from '../common/types'
import { ChunkEditor } from './ChunkEditor'
import { FileInfoEditor } from './FileInfoEditor'
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
	onFile?(file: NbtFile): void
	onInit?(file: NamedNbtTag, prefix?: NbtPath): void
	onUpdate?(file: NamedNbtTag, edit: NbtEdit): void
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
				options: ['structure', 'default', 'snbt', 'info'],
			},
			map: {
				editor: lazy(() => new MapEditor(root, vscode, e => this.makeEdit(e), this.readOnly)),
				options: ['map', 'default', 'snbt', 'info'],
			},
			chunk: {
				editor: lazy(() => new ChunkEditor(root, vscode, e => this.makeEdit(e), this.readOnly)),
				options: ['chunk', 'default', 'snbt'],
			},
			default: {
				editor: lazy(() => new TreeEditor(root, vscode, e => this.makeEdit(e), this.readOnly)),
				options: ['default', 'snbt', 'info'],
			},
			snbt: {
				editor: lazy(() => new SnbtEditor(root, vscode, e => this.makeEdit(e), this.readOnly)),
			},
			info: {
				editor: lazy(() => new FileInfoEditor(root, vscode, () => {}, this.readOnly)),
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

	private inMap = false
	private waitingChunk: Promise<void> | null
	private chunkResolver: () => unknown
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

		document.querySelector('.region-menu .btn')?.addEventListener('click', () => {
			this.inMap = !this.inMap
			this.updateRegionMap()
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
				if (this.nbtFile.region) {
					this.type = 'chunk'
					this.activePanel = this.type
					this.inMap = true
					this.updateRegionMap()
				} else {
					this.setPanel(this.type)
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
							const ops = m.body.ops.map<NbtEditOp>(op => ({ ...op, path: op.path.slice(1) }))
							this.getPanel()?.onUpdate?.(chunk.nbt, { ops })
						}
					} else {
						this.getPanel()?.onUpdate?.(this.nbtFile, m.body)
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
				if (this.inMap) {
					this.updateRegionMap()
				}
				this.chunkResolver()
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
		setTimeout(async () => {
			if (!this.panels[panel].updated) {
				try {
					if (this.nbtFile.region) {
						if (this.waitingChunk !== null) {
							await this.waitingChunk
						}
						const chunkIndex = this.nbtFile.chunks.findIndex(c => c.x === this.selectedChunk.x && c.z === this.selectedChunk.z)
						const chunk = this.nbtFile.chunks[chunkIndex]
						if (chunk?.nbt) {
							editorPanel.onInit?.(chunk.nbt, new NbtPath([chunkIndex]))
						}
					} else {
						editorPanel.onFile?.(this.nbtFile)
						editorPanel.onInit?.(this.nbtFile)
					}
				} catch (e) {
					if (e instanceof Error) {
						console.error(e)
						const div = document.createElement('div')
						div.classList.add('nbt-content', 'error')
						div.textContent = e.message
						root.innerHTML = ''
						root.append(div)
						return
					}
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
		const menuPanels = panel.menu?.() ?? []
		if (menuPanels.length > 0) {
			el.insertAdjacentHTML('beforeend', '<div class="menu-spacer"></div>')
			menuPanels.forEach(e => el.append(e))
		}
	}

	private updateRegionMap() {
		if (!this.nbtFile?.region) {
			return
		}
		document.querySelector('.region-menu .btn')?.classList.toggle('active', this.inMap)
		document.querySelector('.panel-menu')?.classList.toggle('hidden', this.inMap)
		document.querySelector('.nbt-editor')?.classList.toggle('hidden', this.inMap)
		
		if (this.inMap) {
			const map = document.createElement('div')
			map.classList.add('region-map')
			for (let z = 0; z < 32; z += 1) {
				for (let x = 0; x < 32; x += 1) {
					const chunk = this.nbtFile.chunks.find(c => c.x === x && c.z === z)
					const cell = document.createElement('div')
					cell.classList.add('region-map-chunk')
					cell.textContent = `${x} ${z}`
					cell.classList.toggle('empty', chunk === undefined)
					cell.classList.toggle('loaded', chunk?.nbt !== undefined)
					if (chunk !== undefined) {
						cell.addEventListener('click', () => {
							this.requestChunk(x, z)				
						})
					}
					cell.setAttribute('data-pos', `${x} ${z}`)
					map.append(cell)
				}
			}
			document.body.append(map)
		} else {
			document.querySelector('.region-map')?.remove()
		}
	}

	private refreshChunk() {
		if (!this.nbtFile?.region) {
			return
		}
		const x = getInt(document.getElementById('chunk-x')) ?? 0
		const z = getInt(document.getElementById('chunk-z')) ?? 0
		this.requestChunk(x, z)
	}

	private requestChunk(x: number, z: number) {
		if (!this.nbtFile?.region) {
			return
		}
		if (this.selectedChunk.x === x && this.selectedChunk.z === z) {
			this.inMap = false
			this.updateRegionMap()
			return
		}
		this.selectedChunk = { x, z };
		(document.getElementById('chunk-x') as HTMLInputElement).value = `${x}`;
		(document.getElementById('chunk-z') as HTMLInputElement).value = `${z}`
		const chunk = this.nbtFile.chunks.find(c => c.x === x && c.z === z)
		document.querySelector('.region-menu')?.classList.toggle('invalid', !chunk)
		if (!chunk) {
			return
		}
		Object.values(this.panels).forEach(p => p.updated = false)
		this.waitingChunk = null
		if (chunk.nbt) {
			this.setPanel(this.activePanel)
		} else {
			this.waitingChunk = new Promise((res) => {
				this.chunkResolver = () => {
					if (this.selectedChunk.x === x && this.selectedChunk.z === z) {
						this.waitingChunk = null
						res()
					}
				}
			})
			vscode.postMessage({ type: 'getChunkData', body: { x, z } })
		}
		this.inMap = false
		this.updateRegionMap()
		this.setPanel(this.activePanel)
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
