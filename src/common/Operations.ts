import type { NamedNbtTag } from 'deepslate'
import { NbtPath } from './NbtPath'
import { Snbt } from './Snbt'
import type { Logger, NbtEdit, NbtEditOp, NbtFile } from './types'

export function reverseEdit(edit: NbtEdit): NbtEdit {
	return {
		ops: [...edit.ops].reverse().map(reverseEditOp),
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

export function applyEdit(file: NbtFile, edit: NbtEdit, logger?: Logger) {
	edit.ops.forEach(op => applyEditOp(file, op, logger))
}

export function applyEditOp(file: NbtFile, op: NbtEditOp, logger?: Logger) {
	logger?.info(`Applying edit type=${op.type} path=${new NbtPath(op.path).toString()} ${op.type === 'remove' ? '' : op.type === 'move' ? `target=${new NbtPath(op.target).toString()}` : `value=${(a => a.slice(0, 40) + (a.length > 40 ? '...' : ''))(JSON.stringify(op.type === 'set' ? op.new : op.value))}`}`)
	try {
		const { data, path } = getRoot(file, new NbtPath(op.path))
		const { type, value } = getNode(data, path.pop())
		switch(op.type) {
			case 'set': setValue(value, type, path.last(), op.new); break
			case 'add': addValue(value, type, path.last(), op.value, op.valueType); break
			case 'remove': removeValue(value, type, path.last()); break
			case 'move': moveNode(data, value, type, path, new NbtPath(op.target)); break
		}
	} catch (e) {
		logger?.error(`Error applying edit: ${e.message}`)
		throw e
	}
}

function getRoot(file: NbtFile, path: NbtPath) {
	if (file.region === true) {
		const chunk = file.chunks[path.head() as number]
		chunk.dirty = true
		return {
			data: chunk.nbt!,
			path: path.shift(),
		}
	}
	return { data: file, path }
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

function moveNode(data: NamedNbtTag, value: any, type: string, source: NbtPath, target: NbtPath) {
	const { type: sType, value: sValue} = getNodeImpl(value, type, new NbtPath([source.last()]))
	removeValue(value, type, source.last())
	const { type: tType, value: tValue} = getNode(data, target.pop())
	addValue(tValue, tType, target.last(), sValue, sType)
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

export type SearchQuery = {
	type?: string,
	name?: string,
	value?: string,
}

export function searchNodes(data: NamedNbtTag, query: SearchQuery): NbtPath[] {
	const results: NbtPath[] = []
	searchNodesImpl(new NbtPath(), data.value as any, 'compound', query, results)
	return results
}

function searchNodesImpl(path: NbtPath, node: any, type: string, query: SearchQuery, results: NbtPath[]) {
	if (matchesNode(path, node, type, query)) {
		results.push(path)
	}
	switch (type) {
		case 'compound':
			Object.keys(node).sort().forEach(k => {
				searchNodesImpl(path.push(k), node[k].value, node[k].type, query, results)
			})
			break
		case 'list':
			(node.value as any[]).forEach((v, i) => {
				searchNodesImpl(path.push(i), v, node.type, query, results)
			})
			break
		case 'byteArray':
		case 'intArray':
		case 'longArray':
			(node as any[]).forEach((v, i) => {
				searchNodesImpl(path.push(i), v, type.slice(0, -5), query, results)
			})
			break
	}
}

export function matchesNode(path: NbtPath, node: any, type: string, query: SearchQuery): boolean {
	const last = path.last()
	const typeMatches = !query.type || type === query.type
	const nameMatches = !query.name || (typeof last === 'string' && last.includes(query.name))
	const valueMatches = !query.value || matchesValue(node, type, query)
	return typeMatches && nameMatches && valueMatches
}

function matchesValue(node: any, type: string, query: SearchQuery): boolean {
	try {
		switch (type) {
			case 'string':
				return node.includes(query.value)
			case 'byte':
			case 'short':
			case 'int':
			case 'float':
			case 'double':
				return node === JSON.parse(query.value!)
			case 'long':
				const long = Snbt.parseLong(query.value!)
				return node[0] === long[0] && node[1] === long[1]
		}
	} catch (e) {}
	return false
}

export function replaceNode(data: NamedNbtTag, path: NbtPath, replace: SearchQuery): NbtEdit {
	const ops: NbtEditOp[] = []
	const { value } = getNode(data, path)
	if (replace.value) {
		ops.push({ type: 'set', path: path.arr, old: value, new: replace.value })
	}
	if (replace.name) {
		ops.push({ type: 'move', path: path.arr, target: path.pop().push(replace.name).arr })
	}
	return { ops }
}
