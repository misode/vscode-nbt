import { Editor } from "./Editor";
import { NbtPath } from "./NbtPath";
import { hexId } from "./Util"

export class TreeEditor implements Editor {
  private static readonly EXPANDABLE_TYPES = new Set(['compound', 'list', 'byteArray', 'intArray', 'longArray'])

  private events: { [id: string]: (el: Element) => void }
  private expanded: Set<string>
  private content: HTMLDivElement
  private data: any

  constructor() {
    this.events = {}
    this.expanded = new Set()
    this.expand(new NbtPath())

    this.content = document.createElement('div');
    this.content.className = 'nbt-content';
    document.querySelector('.nbt-editor').append(this.content)
  }

  public async onUpdate(data: any) {
    this.data = data.data
    console.log(this.data)
    const rootKeys = Object.keys(this.data.value)
    if (rootKeys.length === 1) {
      this.expand(new NbtPath([rootKeys[0]]))
    }
    this.redraw()
  }

  private onLoad(callback: (el: Element) => void) {
    const id = hexId()
    this.events[id] = (el) => {
      callback(el)
    }
    return `data-id="${id}"`
  }

  private on(event: string, callback: (el: Element) => void) {
    return this.onLoad((el) => {
      el.addEventListener(event, (evt) => {
        callback(el)
        evt.stopPropagation()
      })
    })
  }

  private redraw() {
    var t0 = performance.now()
    this.content.innerHTML = this.drawTag(new NbtPath(), 'compound', this.data.value);
    this.addEvents()
    var t1 = performance.now()
    console.log(`Redraw: ${t1-t0} ms`)
  }

  private addEvents() {
    Object.keys(this.events).forEach(id => {
      const el = this.content.querySelector(`[data-id="${id}"]`);
      if (el !== undefined) this.events[id](el)
    })
    this.events = {}
  }

  private isExpanded(path) {
    return this.expanded.has(path.toString())
  }

  private collapse(path) {
    this.expanded.delete(path.toString())
  }

  private expand(path) {
    this.expanded.add(path.toString())
  }

  private drawTag(path: NbtPath, type: string, data: any) {
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

  private canExpand(type: string) {
    return TreeEditor.EXPANDABLE_TYPES.has(type)
  }

  private drawTagHeader(path: NbtPath, type: string, data: any) {
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
      return `<span class="nbt-error">Error "${e.message}"</span>`
    }
  }

  private drawTagBody(path: NbtPath, type: string, data: any) {
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
      return `<span>Error "${e.message}"</span>`
    }
  }

  private drawIcon(type: string) {
    return `<span class="nbt-icon ${type}-icon"></span>`
  }

  private drawKey(path: NbtPath) {
    const el = path.last()
    if (el === undefined || typeof el === 'number') return ''
    return `<span class="nbt-key">${path.last()}: </span>`
  }

  private drawCollapse(path: NbtPath, type: string, data: any) {
    const click = this.on('click', (el) => {
      const body = el.parentElement.nextElementSibling;
      if (this.isExpanded(path)) {
        this.collapse(path);
        body.innerHTML = '';
        el.textContent = '+';
      } else {
        this.expand(path);
        body.innerHTML = this.drawTagBody(path, type, data)
        this.addEvents();
        el.textContent = '-';
      }
    })
    return `<span class="nbt-collapse" ${click}>${this.isExpanded(path) ? '-' : '+'}</span>`;
  }

  private drawEntries(entries: any[]) {
    return `<span class="nbt-entries">${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}</span>`;
  }

  private drawCompound(path: NbtPath, data: any) {
    return Object.keys(data).sort().map(k => `<div>
      ${this.drawTag(path.push(k), data[k].type, data[k].value)}
    </div>`).join('')
  }

  private drawList(path: NbtPath, data: any) {
    return data.value.map((v, i) => `<div>
      ${this.drawTag(path.push(i), data.type, v)}
    </div>`).join('')
  }

  private drawArray(path: NbtPath, data: any, type: string) {
    return data.map((v, i) => `<div>
      ${this.drawTag(path.push(i), type, v)}
    </div>`).join('')
  }

  private drawString(path: NbtPath, data: any) {
    return `<span>${JSON.stringify(data)}</span>`;
  }

  private drawNumber(path: NbtPath, data: any, type: string) {
    return `<span>${data}</span>`;
  }

  private drawLong(path: NbtPath, data: any) {
    return `<span>[${data}]</span>`;
  }
}
