import { NamedNbtTag } from "@webmc/nbt";
import { NbtPath } from "./NbtPath";
import { NbtEdit, NbtEditOp, NbtFile } from "./types";

export function reverseEdit(edit: NbtEdit): NbtEdit {
  return {
    ops: [...edit.ops].reverse().map(reverseEditOp)
  }
}

export function reverseEditOp(op: NbtEditOp): NbtEditOp {
  switch(op.type) {
    case 'set': return { ...op, new: op.old, old: op.new }
    case 'add': return { ...op, type: 'remove' }
    case 'remove': return { ...op, type: 'add' }
    case 'move': return { ...op, path: op.target, target: op.path }
  }
}

export function applyEdit(file: NbtFile, edit: NbtEdit, logger?: (str: string) => void) {
  edit.ops.forEach(op => applyEditOp(file, op, logger))
}

export function applyEditOp(file: NbtFile, op: NbtEditOp, logger?: (str: string) => void) {
  logger?.(`Applying edit type=${op.type} path=${new NbtPath(op.path).toString()} ${op.type === 'remove' ? '' : op.type === 'move' ? `target=${new NbtPath(op.target).toString()}` : `value=${(a => a.slice(0, 40) + (a.length > 40 ? '...' : ''))(JSON.stringify(op.type === 'set' ? op.new : op.value))}`}`)
  try {
    const { data, path } = getRoot(file, new NbtPath(op.path))
    const { type, value } = getNode(data, path.pop())
    switch(op.type) {
      case 'set': setValue(value, type, path.last(), op.new); break
      case 'add': addValue(value, type, path.last(), op.value, op.valueType); break
      case 'remove': removeValue(value, type, path.last()); break
      case 'move':
        const { type: nType, value: nValue} = getNodeImpl(value, type, new NbtPath([path.last()]))
        removeValue(value, type, path.last())
        const target = new NbtPath(op.target)
        const { type: tType, value: tValue} = getNode(data, target.pop())
        addValue(tValue, tType, target.last(), nValue, nType)
        break
    }
  } catch (e) {
    logger?.(`Error applying edit: ${e.message}`)
    throw e
  }
}

function getRoot(file: NbtFile, path: NbtPath) {
  if (file.region === true) {
    return {
      data: file.chunks[path.head() as number].nbt!,
      path: path.shift()
    }
  }
  return { data: file.data, path: path }
}

export function getNode(data: NamedNbtTag, path: NbtPath) {
  return getNodeImpl(data.value as any, 'compound', path)
}

function getNodeImpl(value: any, type: string, path: NbtPath) {
  for (const el of path.arr) {
    if (type === 'compound' && typeof el === 'string') {
      type = value[el].type
      value = value[el].value
    } else if (type === 'list' && typeof el === 'number') {
      type = value.type
      value = value.value[el]
    } else if (type.endsWith('Array') && typeof el === 'number') {
      type = type.slice(-5)
      value = value[el]
    }
    if (value === undefined) {
      throw new Error(`Invalid path ${path.toString()}`)
    }
  }
  return { type, value }
}

function setValue(node: any, type: string, last: number | string, value: any) {
  if (type === 'compound' && typeof last === 'string') {
    node[last].value = value
  } else if (type === 'list' && typeof last === 'number') {
    node = node.value[last] = value
  } else if (type.endsWith('Array') && typeof last === 'number') {
    node = node[last] = value
  }
}

function addValue(node: any, type: string, last: number | string, value: any, valueType: string) {
  if (type === 'compound') {
    node[last] = { type: valueType, value }
  } else if (type === 'list') {
    node.value.splice(last, 0, value)
  } else {
    node.splice(last, 0, value)
  }
}

function removeValue(node: any, type: string, last: number | string) {
  if (type === 'compound') {
    delete node[last]
  } else if (type === 'list') {
    node.value.splice(last, 1)
  } else {
    node.splice(last, 1)
  }
}

export function searchNode(data: NamedNbtTag, query: string): NbtPath[] {
  const results: NbtPath[] = []
  searchNodeImpl(new NbtPath(), data.value as any, 'compound', query, results)
  return results
}

function searchNodeImpl(path: NbtPath, node: any, type: string, query: string, results: NbtPath[]) {
  switch (type) {
    case 'compound':
      Object.keys(node).forEach(k => {
        searchNodeImpl(path.push(k), node[k].value, node[k].type, query, results)
      })
      break
    case 'list':
      (node.value as any[]).forEach((v, i) => {
        searchNodeImpl(path.push(i), v, node.type, query, results)
      })
      break
    case 'string':
      if ((node as string).includes(query)) {
        results.push(path)
      }
      break
  }
}
