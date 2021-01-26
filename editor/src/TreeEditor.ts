import { NamedNbtTag } from "@webmc/nbt";
import { NbtFile } from "../../src/types";
import { EditorPanel, VsCode } from "./Editor";
import { NbtPath } from "./NbtPath";
import { Snbt } from "./Snbt";
import { hexId } from "./Util"

export class TreeEditor implements EditorPanel {
  static readonly EXPANDABLE_TYPES = new Set(['compound', 'list', 'byteArray', 'intArray', 'longArray'])

  static readonly PARSERS: {[type: string]: (value: string) => any} = {
    'string': v => v,
    'byte': v => parseInt(v),
    'short': v => parseInt(v),
    'int': v => parseInt(v),
    'float': v => parseFloat(v),
    'double': v => parseFloat(v),
    'long': v => Snbt.parseLong(v),
  }

  static readonly SERIALIZERS: {[type: string]: (value: any) => string} = {
    'string': v => v,
    'byte': v => `${v}`,
    'short': v => `${v}`,
    'int': v => `${v}`,
    'float': v => `${v}`,
    'double': v => `${v}`,
    'long': v => Snbt.stringifyLong(v),
  }

  protected events: { [id: string]: (el: Element) => void }
  protected expanded: Set<string>
  protected content: HTMLDivElement
  protected data: NamedNbtTag

  constructor(protected root: Element, protected vscode: VsCode) {
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

  onInit(file: NbtFile) {
    if (file.region !== false) return
    this.data = file.data
    const rootKeys = Object.keys(this.data.value)
    if (rootKeys.length === 1) {
      this.expand(new NbtPath([rootKeys[0]]))
    }
    this.redraw()
  }

  onUpdate(file: NbtFile) {
    this.onInit(file)
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
    return `<div class="nbt-tag${this.canExpand(type)  ? ' collapse' : ''}" ${this.on('click', el => this.clickTag(path, type, data, el))}>
      ${this.canExpand(type) ? this.drawCollapse(path) : ''}
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
      if (type === 'compound') {
        return this.drawEntries(Object.keys(data))
      } else if (type === 'list') {
        return this.drawEntries(data.value)
      } else if (type.endsWith('Array')) {
        return this.drawEntries(data)
      } else {
        return this.drawPrimitiveTag(type, data)
      }
    } catch (e) {
      this.vscode.postMessage({ type: 'error', body: e.message })
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
      this.vscode.postMessage({ type: 'error', body: e.message })
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

  protected drawCollapse(path: NbtPath) {
    return `<span class="nbt-collapse">${this.isExpanded(path) ? '-' : '+'}</span>`;
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

  protected drawPrimitiveTag(type: string, data: any) {
    return `<span class="nbt-value">${TreeEditor.SERIALIZERS[type](data)}</span>`;
  }

  protected clickTag(path: NbtPath, type: string, data: any, el: Element) {
    if (this.canExpand(type)) {
      this.clickExpandableTag(path, type, data, el);
    } else {
      this.clickPrimitiveTag(path, type, data, el)
    }
  }

  protected clickExpandableTag(path: NbtPath, type: string, data: any, el: Element) {
    const body = el.nextElementSibling;
    if (this.isExpanded(path)) {
      this.collapse(path);
      body.innerHTML = '';
      el.querySelector('.nbt-collapse').textContent = '+';
    } else {
      this.expand(path);
      el.querySelector('.nbt-collapse').textContent = '-';
      setTimeout(() => {
        body.innerHTML = this.drawTagBody(path, type, data)
        this.addEvents();
      })
    }
  }

  protected clickPrimitiveTag(path: NbtPath, type: string, data: any, el: Element) {
    const spanEl = el.querySelector('span.nbt-value')
    if (spanEl === null) return
    const value = TreeEditor.SERIALIZERS[type](data)
    spanEl.outerHTML = `<input class="nbt-value" type="text" value="${value}" ${this.onLoad(el => {
      const inputEl = el as HTMLInputElement
      inputEl.focus();
      inputEl.setSelectionRange(value.length, value.length)
      const makeEdit = () => {
        const newData = TreeEditor.PARSERS[type](inputEl.value)
        inputEl.outerHTML = this.drawPrimitiveTag(type, newData)
        if (JSON.stringify(data) !== JSON.stringify(newData)) {
          this.vscode.postMessage({ type: 'edit', body: {
            ops: [{ type: 'set', path: path['arr'], old: data, new: newData }]
          } })
        }
      }
      inputEl.addEventListener('blur', makeEdit)
      inputEl.addEventListener('keyup', evt => {
        if (evt.key === 'Enter') {
          makeEdit()
        } else if (evt.key === 'Escape') {
          inputEl.outerHTML = this.drawPrimitiveTag(type, data)
        }
      })
    })}>`
    this.addEvents()
  }
}
