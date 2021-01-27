import { NbtFile, NbtEdit, EditorMessage, ViewMessage } from "../../src/types"
import { RegionEditor } from "./RegionEditor";
import { SnbtEditor } from "./SnbtEditor";
import { StructureEditor } from "./StructureEditor";
import { TreeEditor } from "./TreeEditor";

export type VSCode = {
	postMessage(message: EditorMessage): void
}

declare function acquireVsCodeApi(): VSCode
const vscode = acquireVsCodeApi();

const root = document.querySelector('.nbt-editor')

const LOCALES = {
	'copy': 'Copy',
	'editTag': 'Edit Tag',
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
	onInit(file: NbtFile): void
	onUpdate(file: NbtFile, edit: NbtEdit): void
	onMessage?(message: ViewMessage): void
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
			editor: lazy(() => new StructureEditor(root, vscode, this.makeEdit)),
			options: ['structure', 'tree', 'snbt']
		},
		'region': {
			editor: lazy(() => new RegionEditor(root, vscode, this.makeEdit)),
			options: ['region']
		},
		'tree': {
			editor: lazy(() => new TreeEditor(root, vscode, this.makeEdit)),
			options: ['tree', 'snbt']
		},
		'snbt': {
			editor: lazy(() => new SnbtEditor(root, vscode, this.makeEdit))
		}
	}

	private type: string
	private nbtFile: NbtFile
	private activePanel: string

	constructor() {
		window.addEventListener('message', async e => {
			editor.onMessage(e.data)
		});

		vscode.postMessage({ type: 'ready' })
	}

	onMessage(m: ViewMessage) {
		switch (m.type) {
			case 'init':
				if (m.body.type === 'structure') {
					this.type = 'structure'
				} else if (m.body.type === 'region') {
					this.type = 'region'
				} else {
					this.type = 'tree'
				}
				this.nbtFile = m.body.content
				this.setPanel(this.type)
				return;

			case 'update':
				try {
					this.applyEdit(m.body)
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
		this.activePanel = panel
		const editorPanel = this.panels[panel].editor()
		this.setPanelMenu(editorPanel)
		setTimeout(() => {
			if (!this.panels[panel].updated) {
				editorPanel.onInit(this.nbtFile)
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

	private makeEdit(edit: NbtEdit) {
		vscode.postMessage({ type: 'edit', body: edit })
	}

	private applyEdit(edit: NbtEdit) {
		for (let i = 0; i < edit.ops.length; i += 1) {
				const op = edit.ops[i];
				switch(op.type) {
						case 'set': this.pathSet(op.path, op.new);
				}
		}
}

	private pathSet(path: (number | string)[], value: any) {
		let node: any
    let type = 'compound'
    let index = 0

    if (this.nbtFile.region) {
      const chunk = this.nbtFile.chunks[path[0]]
      node = chunk.nbt.value
      index = 1
    } else if (this.nbtFile.region === false) {
      node = this.nbtFile.data.value
    }

    for (; index < path.length - 1; index++) {
      const el = path[index]
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

    const last = path[path.length -1]
    if (type === 'compound' && typeof last === 'string') {
      node[last].value = value
    } else if (type === 'list' && typeof last === 'number') {
      node = node.value[last] = value
    } else if (type.endsWith('Array') && typeof last === 'number') {
      node = node[last] = value
    }
	}
}

const editor = new Editor()
