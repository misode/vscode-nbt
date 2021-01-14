import { RegionEditor } from "./RegionEditor";
import { SnbtEditor } from "./SnbtEditor";
import { StructureEditor } from "./StructureEditor";
import { TreeEditor } from "./TreeEditor";

declare function acquireVsCodeApi(): any
const vscode = acquireVsCodeApi();

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
	update(data: any): void
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
			editor: lazy(() => new StructureEditor(root)),
			options: ['structure', 'tree', 'snbt']
		},
		'region': {
			editor: lazy(() => new RegionEditor(root, vscode))
		},
		'tree': {
			editor: lazy(() => new TreeEditor(root)),
			options: ['tree', 'snbt']
		},
		'snbt': {
			editor: lazy(() => new SnbtEditor(root))
		}
	}
	private nbtFile: any
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
		setTimeout(() => {
			const editorPanel = this.panels[panel].editor()
			this.setPanelMenu(editorPanel)
			if (!this.panels[panel].updated) {
				editorPanel.update(this.nbtFile)
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
}

const editor = new Editor()
