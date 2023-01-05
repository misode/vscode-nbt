import type { NbtCompound, NbtFile } from 'deepslate'
import { NbtByte, NbtDouble, NbtEnd, NbtFloat, NbtInt, NbtLong, NbtRegion, NbtShort, NbtString, NbtTag, NbtType } from 'deepslate'
import { NbtPath } from './NbtPath'
import type { Logger, NbtEdit } from './types'

export function reverseEdit(edit: NbtEdit): NbtEdit {
	switch(edit.type) {
		case 'composite': return { ...edit, edits: [...edit.edits].reverse().map(reverseEdit) }
		case 'chunk': return edit
		case 'set': return { ...edit, new: edit.old, old: edit.new }
		case 'add': return { ...edit, type: 'remove' }
		case 'remove': return { ...edit, type: 'add' }
		case 'move': return { ...edit, path: edit.source, source: edit.path }
	}
}

export function mapEdit(edit: NbtEdit, mapper: (e: NbtEdit & { type: 'set' | 'add' | 'remove' | 'move' }) => NbtEdit): NbtEdit {
	switch(edit.type) {
		case 'composite': return { ...edit, edits: edit.edits.map(e => mapEdit(e, mapper)) }
		case 'chunk': return { ...edit, edit: mapEdit(edit.edit, mapper) }
		default: return mapper(edit)
	}
}

export function applyEdit(file: NbtFile | NbtRegion | NbtRegion.Ref, edit: NbtEdit, logger?: Logger) {
	logger?.info(`Applying edit to file ${editToString(edit)}`)
	if (file instanceof NbtRegion || file instanceof NbtRegion.Ref) {
		if (edit.type !== 'chunk') {
			throw new Error(`Expected chunk edit, but got '${edit.type}'`)
		}
		const chunk = file.findChunk(edit.x, edit.z)
		const chunkFile = chunk?.getFile()
		if (chunkFile === undefined) {
			// chunk does not exist or the ref is not loaded, so no need to apply any edits.
			return
		}
		applyEdit(chunkFile, edit.edit, logger)
	} else {
		if (edit.type === 'chunk') {
			throw new Error('Cannot apply chunk edit, this is not a region file')
		}
		if (edit.type !== 'composite' && edit.path.length === 0) {
			if (edit.type !== 'set') {
				throw new Error(`Cannot apply ${edit.type} edit on the root, expected 'set'`)
			}
			const newTag = NbtTag.fromJsonWithId(edit.new)
			if (!newTag.isCompound()) {
				throw new Error(`Expected a compound, but got ${NbtType[newTag.getId()]}`)
			}
			file.root = newTag
		} else {
			applyEditTag(file.root, edit, logger)
		}
	}
}

export function getEditedFile(file: NbtFile | NbtRegion | NbtRegion.Ref, edit: NbtEdit) {
	if (file instanceof NbtRegion || file instanceof NbtRegion.Ref) {
		if (edit.type !== 'chunk') {
			throw new Error(`Expected chunk edit, but got '${edit.type}'`)
		}
		const chunk = file.findChunk(edit.x, edit.z)
		return { file: chunk?.getFile(), edit: edit.edit }
	} else {
		return { file, edit }
	}
}

export function applyEditTag(tag: NbtTag, edit: NbtEdit, logger?: Logger) {
	logger?.info(`Applying edit ${editToString(edit)}`)
	try {
		if (edit.type === 'composite') {
			edit.edits.forEach(edit => applyEditTag(tag, edit, logger))
			return
		} else if (edit.type === 'chunk') {
			throw new Error('Cannot apply chunk edit to a tag')
		}
		if (edit.path.length === 0) {
			throw new Error('Cannot apply edit to the root')
		}
		const path = new NbtPath(edit.path)
		const node = getNode(tag, path.pop())
		const last = path.last()
		switch(edit.type) {
			case 'set': return setValue(node, last, NbtTag.fromJsonWithId(edit.new))
			case 'add': return addValue(node, last, NbtTag.fromJsonWithId(edit.value))
			case 'remove': return removeValue(node, last)
			case 'move': {
				if (edit.source.length === 0) {
					throw new Error('Cannot move the root')
				}
				const sPath = new NbtPath(edit.source)
				const sNode = getNode(tag, sPath.pop())
				const sLast = sPath.last()
				return moveNode(node, last, sNode, sLast)
			}
		}
	} catch (e) {
		logger?.error(`Error applying edit to tag: ${e.message}`)
		throw e
	}
}

function editToString(edit: NbtEdit) {
	return `type=${edit.type} ${edit.type === 'chunk' ? `x=${edit.x} z=${edit.z} ` : ''}${edit.type !== 'composite' && edit.type !== 'chunk' ? ` path=${new NbtPath(edit.path).toString()}` : ''} ${edit.type === 'remove' || edit.type === 'composite' || edit.type === 'chunk' ? '' : edit.type === 'move' ? `source=${new NbtPath(edit.source).toString()}` : `value=${(a => a.slice(0, 40) + (a.length > 40 ? '...' : ''))(JSON.stringify(edit.type === 'set' ? edit.new : edit.value))}`}`
}

export function getNode(tag: NbtTag, path: NbtPath) {
	let node: NbtTag | undefined = tag
	for (const el of path.arr) {
		if (node?.isCompound() && typeof el === 'string') {
			node = node.get(el)
		} else if (node?.isListOrArray() && typeof el === 'number') {
			node = node.get(el)
		} else {
			node = undefined
		}
		if (node === undefined) {
			throw new Error(`Invalid path ${path.toString()}`)
		}
	}
	return node
}

function moveNode(tag: NbtTag, last: number | string, sTag: NbtTag, sLast: number | string) {
	const value = getNode(sTag, new NbtPath([sLast]))
	addValue(tag, last, value)
	removeValue(sTag, sLast)
}

function setValue(tag: NbtTag, last: number | string, value: NbtTag) {
	if (tag.isCompound() && typeof last === 'string') {
		tag.set(last, value)
	} else if (tag.isList() && typeof last === 'number') {
		tag.set(last, value)
	} else if (tag.isByteArray() && typeof last === 'number' && value.isByte()) {
		tag.set(last, value)
	} else if (tag.isIntArray() && typeof last === 'number' && value.isInt()) {
		tag.set(last, value)
	} else if (tag.isLongArray() && typeof last === 'number' && value.isLong()) {
		tag.set(last, value)
	}
}

function addValue(tag: NbtTag, last: number | string, value: NbtTag) {
	if (tag.isCompound() && typeof last === 'string') {
		tag.set(last, value)
	} else if (tag.isList() && typeof last === 'number') {
		tag.insert(last, value)
	} else if (tag.isByteArray() && typeof last === 'number' && value.isByte()) {
		tag.insert(last, value)
	} else if (tag.isIntArray() && typeof last === 'number' && value.isInt()) {
		tag.insert(last, value)
	} else if (tag.isLongArray() && typeof last === 'number' && value.isLong()) {
		tag.insert(last, value)
	}
}

function removeValue(tag: NbtTag, last: number | string) {
	if (tag.isCompound() && typeof last === 'string') {
		tag.delete(last)
	} else if (tag.isListOrArray() && typeof last === 'number') {
		tag.delete(last)
	}
}

export type SearchQuery = {
	type?: number,
	name?: string,
	value?: string,
}

export function searchNodes(tag: NbtCompound, query: SearchQuery): NbtPath[] {
	const results: NbtPath[] = []
	let parsedValue: NbtTag | undefined = undefined
	try {
		if (query.value !== undefined) {
			parsedValue = NbtTag.fromString(query.value)
		}
	} catch (e) {}
	searchNodesImpl(new NbtPath(), tag, query, results, parsedValue)
	return results
}

function searchNodesImpl(path: NbtPath, tag: NbtTag, query: SearchQuery, results: NbtPath[], parsedValue: NbtTag | undefined) {
	if (matchesNode(path, tag, query, parsedValue)) {
		results.push(path)
	}
	if (tag.isCompound()) {
		[...tag.keys()].sort().forEach(k => {
			searchNodesImpl(path.push(k), tag.get(k)!, query, results, parsedValue)
		})
	} else if (tag.isListOrArray()) {
		tag.forEach((v, i) => {
			searchNodesImpl(path.push(i), v, query, results, parsedValue)
		})
	}
}

function matchesNode(path: NbtPath, tag: NbtTag, query: SearchQuery, parsedValue: NbtTag | undefined): boolean {
	const last = path.last()
	const typeMatches = !query.type || tag.getId() === query.type
	const nameMatches = !query.name || (typeof last === 'string' && last.includes(query.name))
	const valueMatches = !query.value || matchesValue(tag, query.value, parsedValue)
	return typeMatches && nameMatches && valueMatches
}

function matchesValue(tag: NbtTag, value: string, parsedValue: NbtTag | undefined): boolean {
	if (parsedValue && tag.getId() == parsedValue.getId() && tag.toString() == parsedValue.toString()) {
		return true
	}
	try {
		if (tag.isString()) {
			return tag.getAsString().includes(value)
		} else if (tag.isLong()) {
			const long = NbtLong.bigintToPair(BigInt(value))
			return tag.getAsPair()[0] === long[0] && tag.getAsPair()[1] === long[1]
		} else if (tag.isNumber()) {
			return tag.getAsNumber() === JSON.parse(value)
		}
	} catch (e) {}
	return false
}

export function replaceNode(tag: NbtTag, path: NbtPath, replace: SearchQuery): NbtEdit {
	const edits: NbtEdit[] = []
	if (replace.value) {
		const node = getNode(tag, path)
		const newNode = parsePrimitive(node.getId(), replace.value)
		edits.push({ type: 'set', path: path.arr, old: node.toJsonWithId(), new: newNode.toJsonWithId() })
	}
	if (replace.name) {
		edits.push({ type: 'move', source: path.arr, path: path.pop().push(replace.name).arr })
	}
	if (edits.length === 1) {
		return edits[0]
	}
	return { type: 'composite', edits }
}

export function serializePrimitive(tag: NbtTag) {
	if (tag.isString()) return tag.getAsString()
	if (tag.isLong()) return NbtLong.pairToString(tag.getAsPair())
	if (tag.isNumber()) return tag.getAsNumber().toFixed()
	return ''
}

export function parsePrimitive(id: number, value: string) {
	switch (id) {
		case NbtType.String: return new NbtString(value)
		case NbtType.Byte: return new NbtByte(parseInt(value))
		case NbtType.Short: return new NbtShort(parseInt(value))
		case NbtType.Int: return new NbtInt(parseInt(value))
		case NbtType.Long: return new NbtLong(BigInt(value))
		case NbtType.Float: return new NbtFloat(parseFloat(value))
		case NbtType.Double: return new NbtDouble(parseFloat(value))
		default: return NbtEnd.INSTANCE
	}
}
