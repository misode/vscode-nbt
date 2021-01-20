import * as nbt from "@webmc/nbt"
import { RegionEditor } from "./RegionEditor";
import { SnbtEditor } from "./SnbtEditor";
import { StructureEditor } from "./StructureEditor";
import { TreeEditor } from "./TreeEditor";

declare function acquireVsCodeApi(): any
const vscode = acquireVsCodeApi();

export type SimpleNbtFile = {
	anvil: false
	gzipped: boolean
	data: nbt.NamedNbtTag
}

export type RegionNbtFile = {
	anvil: true
	chunks: nbt.NbtChunk[]
}

export type NbtFile = SimpleNbtFile | RegionNbtFile

export type NbtEdit = {
	label: 'Set',
	path: (number | string)[]
	new: any,
	old: any
} | {
	label: 'Init'
}

const root = document.querySelector('.nbt-editor')

const LOCALES = {
	'copy': 'Copy',
	'grid': 'Show Grid',
  'panel.structure': '3D',
  'panel.region': 'Region',
	'panel.tree': 'Tree',
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

export interface EditorPanel {
	reveal(): void
	update(data: any, edit: NbtEdit): void
	onMessage?(type: string, body: any, requestId: number): void
	menu?(): Element[]
}

class Editor {
	private panels: {
		[key: string]: {
			editor: () => EditorPanel
			updated?: boolean
			options?: string[]
		}
	} = {
		'structure': {
			editor: lazy(() => new StructureEditor(root, vscode)),
			options: ['structure', 'tree', 'snbt']
		},
		'region': {
			editor: lazy(() => new RegionEditor(root, vscode))
		},
		'tree': {
			editor: lazy(() => new TreeEditor(root, vscode)),
			options: ['tree', 'snbt']
		},
		'snbt': {
			editor: lazy(() => new SnbtEditor(root))
		}
	}
	private nbtFile: NbtFile
	private activePanel: string
	private type: string

	constructor() {
		window.addEventListener('message', async e => {
			const { type, body, requestId } = e.data;
			editor.onMessage(type, body, requestId)
		});

		vscode.postMessage({ type: 'ready' })
	}

	onMessage(type: string, body: any, requestId: number) {
		switch (type) {
			case 'init':
				if (body.structure) {
					this.type = 'structure'
				} else if (body.content.anvil) {
					this.type = 'region'
				} else {
					this.type = 'tree'
				}
				this.nbtFile = body.content
				this.setPanel(this.type)
				return;

			case 'update':
				try {
					this.applyEdit(body.content)
					Object.values(this.panels).forEach(p => p.updated = false)
					this.panels[this.activePanel].editor().update(this.nbtFile, body.content)
					this.panels[this.activePanel].updated = true
				} catch (e) {
					vscode.postMessage({ type: 'error', body: e })
				}
				return;

			case 'getFileData':
				vscode.postMessage({ type: 'response', requestId, body: this.nbtFile });
				return;
			
			default:
				this.panels[this.type].editor().onMessage?.(type, body, requestId)
		}
	}

	private setPanel(panel: string) {
		root.innerHTML = `<div class="spinner"></div>`
		this.activePanel = panel
		const editorPanel = this.panels[panel].editor()
		this.setPanelMenu(editorPanel)
		setTimeout(() => {
			if (!this.panels[panel].updated) {
				editorPanel.update(this.nbtFile, { label: 'Init' })
				this.panels[panel].updated = true
			}
			root.innerHTML = ''
			editorPanel.reveal()
		})
	}

	private setPanelMenu(panel: EditorPanel) {
		const el = document.querySelector('.panel-menu')
		el.innerHTML = ''
		this.panels[this.type].options?.forEach((p: string) => {
			const button = document.createElement('div')
			el.append(button)
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

	private applyEdit(edit: NbtEdit) {
		if (edit.label !== 'Set') return

		let node: any
    let type = 'compound'
    let index = 0

    if (this.nbtFile.anvil) {
      const chunk = this.nbtFile.chunks[edit.path[0]]
      node = chunk.nbt.value
      index = 1
    } else if (this.nbtFile.anvil === false) {
      node = this.nbtFile.data.value
    }

    for (; index < edit.path.length - 1; index++) {
      const el = edit.path[index]
      if (type === 'compound' && typeof el === 'string') {
        type = node[el].type
        node = node[el].value
      } else if (type === 'list' && typeof el === 'number') {
        type = node.type
        node = node.value[el]
      } else if (type.endsWith('Array') && typeof el === 'number') {
        type = type.slice(-5)
        node = node[el]
      }
    }

    const last = edit.path[edit.path.length -1]
    if (type === 'compound' && typeof last === 'string') {
      node[last].value = edit.new
    } else if (type === 'list' && typeof last === 'number') {
      node = node.value[last] = edit.new
    } else if (type.endsWith('Array') && typeof last === 'number') {
      node = node[last] = edit.new
    }
	}
}

const editor = new Editor()
