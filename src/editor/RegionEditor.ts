import type { NbtChunk } from 'deepslate'
import { NbtPath } from '../common/NbtPath'
import { getNode } from '../common/Operations'
import type { NbtFile, ViewMessage } from '../common/types'
import type { EditHandler, VSCode } from './Editor'
import { TreeEditor } from './TreeEditor'

export class RegionEditor extends TreeEditor {
	private chunks: Partial<NbtChunk>[]

	constructor(root: Element, vscode: VSCode, editHandler: EditHandler, readOnly: boolean) {
		super(root, vscode, editHandler, readOnly)
		this.chunks = []
	}

	redraw() {
		this.content.innerHTML = ''
		this.content.append(this.drawRegion(new NbtPath(), this.chunks))
	}

	onInit(file: NbtFile) {
		if (file.region !== true) return
		this.chunks = file.chunks
		this.redraw()
	}

	onUpdate(file: NbtFile) {
		this.onInit(file)
	}

	onMessage(m: ViewMessage) {
		if (m.type === 'chunk') {
			const index = this.chunks.findIndex(c => c.x === m.body.x && c.z === m.body.z)
			this.chunks[index] = m.body
			this.redraw()
		}
	}

	private drawRegion(path: NbtPath, chunks: Partial<NbtChunk>[]) {
		const el = document.createElement('div')
		chunks.forEach((c, i) => {
			const child = this.drawChunk(path.push(i), c)
			el.append(child)
		})
		return el
	}

	private drawChunk(path: NbtPath, chunk: Partial<NbtChunk>) {
		const expanded = chunk.nbt && this.isExpanded(path)
		const el = document.createElement('div')
		const head = document.createElement('div')
		head.classList.add('nbt-tag')
		head.classList.add('collapse')
		head.append(this.drawCollapse(path, () => this.clickChunk(path, chunk, head)))
		head.append(this.drawIcon('chunk'))
		head.append(this.drawKey(`Chunk [${chunk.x}, ${chunk.z}]`))
		head.addEventListener('click', () => this.select({
			path, type: 'compound', data: () => getNode(this.chunks[path.head()].nbt, path.shift()).value, el: head,
		}))
		head.addEventListener('dblclick', () => this.clickChunk(path, chunk, head))
		el.append(head)

		const body = document.createElement('div')
		body.classList.add('nbt-body')
		if (expanded) {
			body.append(this.drawCompound(path, chunk.nbt?.value))
		}
		el.append(body)

		return el
	}

	private clickChunk(path: NbtPath, chunk: Partial<NbtChunk>, el: Element) {
		if (chunk.nbt) {
			this.clickExpandableTag(path, 'compound', chunk.nbt.value, el)
		} else {
			this.expand(path)
			this.vscode.postMessage({ type: 'getChunkData', body: { x: chunk.x!, z: chunk.z! } })
		}
	}
}
