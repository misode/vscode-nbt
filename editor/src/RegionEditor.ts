import { NbtChunk } from "@webmc/nbt";
import { NbtFile, ViewMessage } from "../../src/common/types";
import { NbtPath } from "../../src/common/NbtPath";
import { getNode } from "../../src/common/Operations";
import { EditHandler, VSCode } from "./Editor";
import { TreeEditor } from "./TreeEditor";

export class RegionEditor extends TreeEditor {
  private chunks: Partial<NbtChunk>[]

  constructor(root: Element, vscode: VSCode, editHandler: EditHandler, readOnly: boolean) {
    super(root, vscode, editHandler, readOnly)
    this.chunks = []
  }

  redraw() {
    this.content.innerHTML = this.drawRegion(new NbtPath(), this.chunks);
    this.addEvents()
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
    return chunks.map((c, i) => `<div>
			${this.drawChunk(path.push(i), c)}
		</div>`).join('')
  }

  private drawChunk(path: NbtPath, chunk: Partial<NbtChunk>) {
    const expanded = chunk.nbt && this.isExpanded(path);
    return `<div class="nbt-tag collapse" ${this.onLoad(el => {
      el.addEventListener('click', () => this.select({
        path, type: 'compound', data: () => getNode(this.chunks[path.head()].nbt, path.shift()).value, el
      }))
      el.addEventListener('dblclick', () => this.clickChunk(path, chunk, el))
    })}>
      ${this.drawCollapse(path, 'compound', (el) => this.clickChunk(path, chunk, el.parentElement!))}
      ${this.drawIcon('chunk')}
      <span class="nbt-key">Chunk [${chunk.x}, ${chunk.z}]</span>
    </div>
    <div class="nbt-body">
      ${expanded ? this.drawCompound(path, chunk.nbt?.value) : ''}
    </div>`
  }

  private clickChunk(path: NbtPath, chunk: Partial<NbtChunk>, el: Element) {
    if (chunk.nbt) {
      this.clickExpandableTag(path, 'compound', chunk.nbt.value, el)
    } else {
      this.expand(path);
      this.vscode.postMessage({ type: 'getChunkData', body: { x: chunk.x!, z: chunk.z! } });
    }
  }
}
