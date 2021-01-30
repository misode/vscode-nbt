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
    case 'put': return { ...op, type: 'delete' }
    case 'delete': return { ...op, type: 'put' }
  }
}

export function applyEdit(file: NbtFile, edit: NbtEdit, logger?: (str: string) => void) {
  edit.ops.forEach(op => applyEditOp(file, op, logger))
}

export function applyEditOp(file: NbtFile, op: NbtEditOp, logger?: (str: string) => void) {
  logger?.(`Applying edit type=${op.type} path=${new NbtPath(op.path).toString()}${op.type === 'put' || op.type === 'delete' ? ` key=${op.key}` : op.type === 'add' || op.type === 'remove' ? ` index=${op.index}` : ''} ${op.type === 'remove' || op.type === 'delete' ? '' : `value=${(a => a.slice(0, 40) + (a.length > 40 ? '...' : ''))(JSON.stringify(op.type === 'set' ? op.new : op.value))}`}`)
  try {
    const { data, path } = getRoot(file, new NbtPath(op.path))
    const { type, value } = getNode(data, op.type === 'set' ? path.pop() : path)
    switch(op.type) {
      case 'set': return setValue(value, type, new NbtPath(op.path).last(), op.new)
      case 'add': return addValue(value, type, op.index, op.value)
      case 'remove': return removeValue(value, type, op.index)
      case 'put': return putValue(value, op.key, op.keyType, op.value)
      case 'delete': return deleteValue(value, op.key)
    }
  } catch (e) {
    logger?.(`Error applying edit: ${e.message}`)
    throw e
  }
}

export function getRoot(file: NbtFile, path: NbtPath) {
  if (file.region === true) {
    return {
      data: file.chunks[path.head() as number].nbt!,
      path: path.shift()
    }
  }
  return { data: file.data, path: path }
}

export function getNode(data: NamedNbtTag, path: NbtPath) {
  let value = data.value as any
  let type = 'compound'

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

export function setValue(node: any, type: string, last: number | string, value: any) {
  if (type === 'compound' && typeof last === 'string') {
    node[last].value = value
  } else if (type === 'list' && typeof last === 'number') {
    node = node.value[last] = value
  } else if (type.endsWith('Array') && typeof last === 'number') {
    node = node[last] = value
  }
}

export function addValue(node: any, type: string, index: number, value: any) {
  if (type === 'list') {
    node.value.splice(index, 0, value)
  } else {
    node.splice(index, 0, value)
  }
}

export function removeValue(node: any, type: string, index: number) {
  if (type === 'list') {
    node.value.splice(index, 1)
  } else {
    node.splice(index, 1)
  }
}

export function putValue(node: any, key: string, type: string, value: any) {
  node[key] = { type, value }
}

export function deleteValue(node: any, key: string) {
  delete node[key]
}
