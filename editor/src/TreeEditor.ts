import { NamedNbtTag } from "@webmc/nbt";
import { NbtFile } from "../../src/common/types";
import { EditHandler, EditorPanel, locale, VSCode } from "./Editor";
import { NbtPath } from "../../src/common/NbtPath";
import { getNode } from "../../src/common/Operations";
import { Snbt } from "./Snbt";
import { hexId } from "./Util"

export type SelectedTag = {
  path: NbtPath
  type: string
  data: () => any
  el: Element
}

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

  protected selected: null | SelectedTag

  constructor(protected root: Element, protected vscode: VSCode, protected editHandler: EditHandler, protected readOnly: boolean) {
    this.events = {}
    this.expanded = new Set()
    this.expand(new NbtPath())

    this.content = document.createElement('div');
    this.content.className = 'nbt-content';
    this.data = { name: '', value: {} }
    this.selected = null
  }

  reveal() {
    this.root.append(this.content)
    if (this.selected) {
      this.select(this.selected)
    }
    document.addEventListener('keyup', this.onKeyUp)
  }

  hide() {
    document.removeEventListener('keyup', this.onKeyUp)
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

  menu() {
    if (this.readOnly) return []

    const editTag = document.createElement('div')
    editTag.className = 'btn btn-edit-tag disabled'
    editTag.textContent = locale('editTag')
    editTag.addEventListener('click', () => {
      if (!this.selected) return
      this.selected.el.scrollIntoView({ block: 'center' })
      this.clickTag(this.selected.path, this.selected.type, this.selected.data(), this.selected.el)
    })
    const removeTag = document.createElement('div')
    removeTag.className = 'btn btn-remove-tag disabled'
    removeTag.textContent = locale('removeTag')
    removeTag.addEventListener('click', () => {
      if (!this.selected) return
      this.selected.el.scrollIntoView({ block: 'center' })
      this.removeTag(this.selected.path, this.selected.type, this.selected.data(), this.selected.el)
    })
    return [removeTag, editTag]
  }

  protected onKeyUp = (evt: KeyboardEvent) => {
    if (evt.key === 'Delete' && this.selected) {
      this.removeTag(this.selected.path, this.selected.type, this.selected.data(), this.selected.el)
    }
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
      if (el !== null) this.events[id](el)
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

  protected select(selected: SelectedTag | null) {
    if (this.readOnly) return

    this.selected = selected
    this.root.querySelectorAll('.nbt-tag.selected').forEach(e => e.classList.remove('selected'))
    if (selected){
      selected.el.classList.add('selected')
      const btnEditTag = document.querySelector('.btn-edit-tag') as HTMLElement
      btnEditTag?.classList.toggle('disabled', this.canExpand(selected.type))
    }
    const btnRemoveTag = document.querySelector('.btn-remove-tag') as HTMLElement
    btnRemoveTag?.classList.toggle('disabled', this.selected === null || this.selected.path.length() === 0)
  }

  protected drawTag(path: NbtPath, type: string, data: any) {
    const expanded = this.canExpand(type) && this.isExpanded(path)
    return `<div class="nbt-tag${this.canExpand(type)  ? ' collapse' : ''}" ${this.onLoad(el => {
      el.addEventListener('click', () => this.select({path, type, data: () => data, el }))
      el.addEventListener('dblclick', () => this.clickTag(path, type, data, el))
    })}>
      ${this.drawCollapse(path, type, (el) => this.clickTag(path, type, data, el.parentElement!))}
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

  protected drawCollapse(path: NbtPath, type: string, handler: (el: Element) => void) {
    if (!this.canExpand(type)) return ''
    return `<span class="nbt-collapse" ${this.on('click', handler)}>
      ${this.isExpanded(path) ? '-' : '+'}
    </span>`;
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
    const body = el.nextElementSibling!;
    if (this.isExpanded(path)) {
      this.collapse(path);
      body.innerHTML = '';
      el.querySelector('.nbt-collapse')!.textContent = '+';
    } else {
      this.expand(path);
      el.querySelector('.nbt-collapse')!.textContent = '-';
      setTimeout(() => {
        body.innerHTML = this.drawTagBody(path, type, data)
        this.addEvents();
      })
    }
  }

  protected clickPrimitiveTag(path: NbtPath, type: string, data: any, el: Element) {
    if (this.readOnly) return

    const spanEl = el.querySelector('span.nbt-value')
    if (spanEl === null) return
    const value = TreeEditor.SERIALIZERS[type](data)
    spanEl.outerHTML = `<input class="nbt-value" type="text" value="${value}" ${this.onLoad(el => {
      const inputEl = el as HTMLInputElement
      inputEl.focus();
      inputEl.setSelectionRange(value.length, value.length);
      inputEl.scrollLeft = inputEl.scrollWidth;
      const makeEdit = () => {
        const newData = TreeEditor.PARSERS[type](inputEl.value)
        inputEl.outerHTML = this.drawPrimitiveTag(type, newData)
        if (JSON.stringify(data) !== JSON.stringify(newData)) {
          this.editHandler({ ops: [
            { type: 'set', path: path.arr, old: data, new: newData }
          ] })
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

  protected removeTag(path: NbtPath, type: string, data: any, el: Element) {
    if (this.readOnly) return

    const { type: parentType } = getNode(this.data, path.pop())
    if (parentType === 'compound') {
      this.editHandler({ ops: [
        { type: 'delete', path: path.pop().arr, key: path.last() as string, value: data, keyType: type }
      ] })
    } else {
      this.editHandler({ ops: [
        { type: 'remove', path: path.pop().arr, index: path.last() as number, value: data }
      ] })
    }
    el.parentElement?.remove()
    this.select(null)
    path['arr']
  }
}
