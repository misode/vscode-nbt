import { NamedNbtTag, tagNames } from "@webmc/nbt";
import { NbtEditOp, NbtFile } from "../../src/common/types";
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

  static readonly PARSERS: Record<string, (value: string) => any> = {
    'string': v => v,
    'byte': v => parseInt(v),
    'short': v => parseInt(v),
    'int': v => parseInt(v),
    'float': v => parseFloat(v),
    'double': v => parseFloat(v),
    'long': v => Snbt.parseLong(v),
  }

  static readonly SERIALIZERS: Record<string, (value: any) => string> = {
    'string': v => v,
    'byte': v => `${v}`,
    'short': v => `${v}`,
    'int': v => `${v}`,
    'float': v => `${v}`,
    'double': v => `${v}`,
    'long': v => Snbt.stringifyLong(v),
  }

  static readonly DEFAULTS: Record<string, () => any> = {
    'string': () => '',
    'byte': () => 0,
    'short': () => 0,
    'int': () => 0,
    'float': () => 0,
    'double': () => 0,
    'long': () => [0, 0],
    'list': () => ({ type: 'end', value: [] }),
    'compound': () => ({}),
    'byteArray': () => [],
    'intArray': () => [],
    'longArray': () => []
  }

  protected events: Record<string, (el: Element) => void>
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

    const actionButton = (action: string, fn: (...args: any[]) => void) => {
      const el = document.createElement('div')
      el.className = `btn btn-${action}-tag disabled`
      el.textContent = locale(`${action}Tag`)
      el.addEventListener('click', () => {
        if (!this.selected) return
        this.selected.el.scrollIntoView({ block: 'center' })
        fn.bind(this)(this.selected.path, this.selected.type, this.selected.data(), this.selected.el)
      })
      return el
    }

    const editTag = actionButton('edit', this.clickTag)
    const removeTag = actionButton('remove', this.removeTag)
    const addTag = actionButton('add', this.addTag)
    const renameTag = actionButton('rename', this.renameTag)
    return [removeTag, editTag, addTag, renameTag]
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
      const btnAddTag = document.querySelector('.btn-add-tag') as HTMLElement
      btnAddTag?.classList.toggle('disabled', !this.canExpand(selected.type))
      const parentType = getNode(this.data, selected.path.pop()).type
      const btnRenameTag = document.querySelector('.btn-rename-tag') as HTMLElement
      btnRenameTag?.classList.toggle('disabled', parentType !== 'compound')
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
    return `<span data-icon="${type}"></span>`
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
    
    el.querySelector('span.nbt-value')?.remove()
    const value = TreeEditor.SERIALIZERS[type](data)

    const valueEl = document.createElement('input')
    el.append(valueEl)
    valueEl.classList.add('nbt-value')
    valueEl.value = value
    valueEl.focus();
    valueEl.setSelectionRange(value.length, value.length);
    valueEl.scrollLeft = valueEl.scrollWidth;

    const confirmButton = document.createElement('button')
    el.append(confirmButton)
    confirmButton.classList.add('nbt-confirm')
    confirmButton.textContent = locale('confirm')
    const makeEdit = () => {
      const newData = TreeEditor.PARSERS[type](valueEl.value)
      if (JSON.stringify(data) !== JSON.stringify(newData)) {
        this.editHandler({ ops: [
          { type: 'set', path: path.arr, old: data, new: newData }
        ] })
      }
    }
    confirmButton.addEventListener('click', makeEdit)
    valueEl.addEventListener('keyup', evt => {
      if (evt.key === 'Enter') {
        makeEdit()
      }
    })
  }

  protected removeTag(path: NbtPath, type: string, data: any, el: Element) {
    if (this.readOnly) return

    this.editHandler({ ops: [
      { type: 'remove', path: path.arr, value: data, valueType: type }
    ] })
  }

  protected addTag(path: NbtPath, type: string, data: any, el: Element) {
    if (this.readOnly) return

    const body = el.nextElementSibling!;
    const root = document.createElement('div')
    body.prepend(root)
    const nbtTag = document.createElement('div')
    nbtTag.classList.add('nbt-tag')
    root.append(nbtTag)

    const typeRoot = document.createElement('div')
    nbtTag.append(typeRoot)

    const keyInput = document.createElement('input')
    if (type === 'compound') {
      keyInput.classList.add('nbt-key')
      keyInput.placeholder = locale('name')
      nbtTag.append(keyInput)
    }

    const valueInput = document.createElement('input')
    valueInput.classList.add('nbt-value')
    valueInput.placeholder = locale('value')
    nbtTag.append(valueInput)

    const typeSelect = document.createElement('select')
    if (type === 'compound' || data?.value?.length === 0) {
      typeRoot.classList.add('type-select')
      typeRoot.setAttribute('data-icon', 'byte')
      typeRoot.append(typeSelect)

      typeSelect.addEventListener('change', () => {
        typeRoot.setAttribute('data-icon', typeSelect.value)
      })
      tagNames.filter(t => t !== 'end').forEach(t => {
        const option = document.createElement('option')
        option.value = t
        option.textContent = t.charAt(0).toUpperCase() + t.slice(1).split(/(?=[A-Z])/).join(' ')
        typeSelect.append(option)
      })

      typeSelect.focus()
      typeSelect.addEventListener('change', () => {
        valueInput.classList.toggle('hidden', this.canExpand(typeSelect.value))
        nbtTag.querySelector('input')?.focus()
      })
    } else {
      const keyType = (type === 'list') ? data.type : type.replace(/Array$/, '')
      typeRoot.setAttribute('data-icon', keyType)
      valueInput.focus()
    }

    const confirmButton = document.createElement('button')
    nbtTag.append(confirmButton)
    confirmButton.classList.add('nbt-confirm')
    confirmButton.textContent = locale('confirm')
    const makeEdit = () => {
      const valueType = (type === 'compound' || data?.value?.length === 0)
        ? typeSelect.value
        : (type === 'list') ? data.type : type.replace(/Array$/, '')
      const last = type === 'compound' ? keyInput.value : 0
      let newData = TreeEditor.DEFAULTS[valueType]()
      if (!this.canExpand(valueType)) {
        try {
          newData = TreeEditor.PARSERS[valueType](valueInput.value)
        } catch(e) {}
      }

      const edit: NbtEditOp = (data?.value?.length === 0)
        ? { type: 'set', path: path.arr, new: { type: valueType, value: [newData] }, old: data }
        : { type: 'add', path: path.push(last).arr, value: newData, valueType }

      this.expand(path)
      this.editHandler({ ops: [edit] })
    }
    confirmButton.addEventListener('click', makeEdit)
    valueInput.addEventListener('keyup', evt => {
      if (evt.key === 'Enter') {
        makeEdit()
      }
    })
  }

  protected renameTag(path: NbtPath, type: string, data: any, el: Element) {
    if (this.readOnly) return

    el.querySelector('span.nbt-key')?.remove()
    const valueEl = el.querySelector('.nbt-value')
    const key = path.last() as string

    const keyEl = document.createElement('input')
    el.insertBefore(keyEl, valueEl)
    keyEl.classList.add('nbt-value')
    keyEl.value = key
    keyEl.focus();
    keyEl.setSelectionRange(key.length, key.length);
    keyEl.scrollLeft = keyEl.scrollWidth;

    const confirmButton = document.createElement('button')
    el.insertBefore(confirmButton, valueEl)
    confirmButton.classList.add('nbt-confirm')
    confirmButton.textContent = locale('confirm')
    const makeEdit = () => {
      const newKey = keyEl.value
      if (key !== newKey) {
        this.editHandler({ ops: [
          { type: 'move', path: path.arr, target: path.pop().push(newKey).arr }
        ] })
      }
    }
    confirmButton.addEventListener('click', makeEdit)
    keyEl.addEventListener('keyup', evt => {
      if (evt.key === 'Enter') {
        makeEdit()
      }
    })
  }
}
