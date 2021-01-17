import { NamedNbtTag } from "@webmc/nbt";
import { EditorPanel } from "./Editor";
import { NbtPath } from "./NbtPath";
import { Snbt } from "./Snbt";
import { hexId } from "./Util"

export class TreeEditor implements EditorPanel {
  private static readonly EXPANDABLE_TYPES = new Set(['compound', 'list', 'byteArray', 'intArray', 'longArray'])

  private events: { [id: string]: (el: Element) => void }
  private expanded: Set<string>
  protected content: HTMLDivElement
  private data: NamedNbtTag

  constructor(protected root: Element) {
    this.events = {}
    this.expanded = new Set()
    this.expand(new NbtPath())

    this.content = document.createElement('div');
    this.content.className = 'nbt-content';
    this.data = { name: '', value: {} }
  }

  reveal() {
    this.root.append(this.content)
    this.redraw()
  }

  update(data: any) {
    this.data = data.data
    const rootKeys = Object.keys(this.data.value)
    if (rootKeys.length === 1) {
      this.expand(new NbtPath([rootKeys[0]]))
    }
    this.redraw()
  }

  protected onLoad(callback: (el: Element) => void) {
    const id = hexId()
    this.events[id] = (el) => {
      callback(el)
    }
    return `data-id="${id}"`
  }

  protected on(event: string, callback: (el: Element) => void) {
    return this.onLoad((el) => {
      el.addEventListener(event, (evt) => {
        callback(el)
        evt.stopPropagation()
      })
    })
  }

  protected redraw() {
    this.content.innerHTML = this.drawTag(new NbtPath(), 'compound', this.data.value);
    this.addEvents()
  }

  protected addEvents() {
    Object.keys(this.events).forEach(id => {
      const el = this.content.querySelector(`[data-id="${id}"]`);
      if (el !== undefined) this.events[id](el)
    })
    this.events = {}
  }

  protected isExpanded(path: NbtPath) {
    return this.expanded.has(path.toString())
  }

  protected collapse(path: NbtPath) {
    this.expanded.delete(path.toString())
  }

  protected expand(path: NbtPath) {
    this.expanded.add(path.toString())
  }

  protected drawTag(path: NbtPath, type: string, data: any) {
    const expanded = this.canExpand(type) && this.isExpanded(path)
    return `<div class="nbt-tag${this.canExpand(type)  ? ' collapse' : ''}">
      ${this.canExpand(type) ? this.drawCollapse(path, type, data) : ''}
      ${this.drawIcon(type)}
      ${this.drawKey(path)}
      ${this.drawTagHeader(path, type, data)}
    </div>
    <div class="nbt-body">
      ${expanded ? this.drawTagBody(path, type, data) : ''}
    </div>`
  }

  protected canExpand(type: string) {
    return TreeEditor.EXPANDABLE_TYPES.has(type)
  }

  protected drawTagHeader(path: NbtPath, type: string, data: any) {
    try {
      switch(type) {
        case 'compound': return this.drawEntries(Object.keys(data));
        case 'list': return this.drawEntries(data.value);
        case 'byteArray':
        case 'intArray':
        case 'longArray': return this.drawEntries(data);
        case 'string': return this.drawString(path, data);
        case 'byte':
        case 'double':
        case 'float':
        case 'short':
        case 'int': return this.drawNumber(path, data, type);
        case 'long': return this.drawLong(path, data);
        default: return `<span>${type}</span>`;
      }
    } catch (e) {
      console.error(e)
      return `<span class="error">Error "${e.message}"</span>`
    }
  }

  protected drawTagBody(path: NbtPath, type: string, data: any) {
    try {
      switch(type) {
        case 'compound': return this.drawCompound(path, data);
        case 'list': return this.drawList(path, data);
        case 'byteArray': return this.drawArray(path, data, 'byte');
        case 'intArray': return this.drawArray(path, data, 'int');
        case 'longArray': return this.drawArray(path, data, 'long');
        default: return '';
      }
    } catch (e) {
      console.error(e)
      return `<span class="error">Error "${e.message}"</span>`
    }
  }

  protected drawIcon(type: string) {
    return `<span class="nbt-icon ${type}-icon"></span>`
  }

  protected drawKey(path: NbtPath) {
    const el = path.last()
    if (el === undefined || typeof el === 'number') return ''
    return `<span class="nbt-key">${path.last()}: </span>`
  }

  protected drawCollapse(path: NbtPath, type: string, data: any) {
    const click = this.on('click', (el) => {
      const body = el.parentElement.nextElementSibling;
      if (this.isExpanded(path)) {
        this.collapse(path);
        body.innerHTML = '';
        el.textContent = '+';
      } else {
        this.expand(path);
        el.textContent = '-';
        setTimeout(() => {
          body.innerHTML = this.drawTagBody(path, type, data)
          this.addEvents();
        })
      }
    })
    return `<span class="nbt-collapse" ${click}>${this.isExpanded(path) ? '-' : '+'}</span>`;
  }

  protected drawEntries(entries: any[]) {
    return `<span class="nbt-entries">${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}</span>`;
  }

  protected drawCompound(path: NbtPath, data: any) {
    return Object.keys(data).sort().map(k => `<div>
      ${this.drawTag(path.push(k), data[k].type, data[k].value)}
    </div>`).join('')
  }

  protected drawList(path: NbtPath, data: any) {
    return data.value.map((v, i) => `<div>
      ${this.drawTag(path.push(i), data.type, v)}
    </div>`).join('')
  }

  protected drawArray(path: NbtPath, data: any, type: string) {
    return data.map((v, i) => `<div>
      ${this.drawTag(path.push(i), type, v)}
    </div>`).join('')
  }

  protected drawString(path: NbtPath, data: any) {
    return `<span>${JSON.stringify(data)}</span>`;
  }

  protected drawNumber(path: NbtPath, data: any, type: string) {
    return `<span>${data}</span>`;
  }

  protected drawLong(path: NbtPath, data: any) {
    return `<span>${Snbt.stringifyLong(data)}</span>`;
  }
}
