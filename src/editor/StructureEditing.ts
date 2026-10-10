import { BlockPos, NbtCompound, NbtFile, NbtInt, NbtList, NbtString, NbtType } from 'deepslate'
import type { NbtEdit } from '../common/types'
import { resourceId } from '../assets/Types'
import { ae2CableItem } from '../assets/Ae2'

export function canBuildStructure(file: NbtFile): boolean {
	const root = file.root
	return root.hasList('size', NbtType.Int, 3) && !root.has('palettes') && ['palette', 'blocks'].every(key => {
		const tag = root.get(key)
		return tag?.isList() && (tag.length === 0 || tag.getType() === NbtType.Compound)
	})
}
export function createBlankStructure(dataVersion: number, size: BlockPos = [16, 16, 16]): NbtFile {
	if (!Number.isSafeInteger(dataVersion) || dataVersion < 1 || !size.every(n => Number.isSafeInteger(n) && n > 0 && n <= 256)) throw new Error('Invalid structure version or size')
	const file = NbtFile.create({ compression: 'gzip' })
	file.root.set('DataVersion', new NbtInt(dataVersion)).set('size', new NbtList(size.map(n => new NbtInt(n))))
		.set('palette', new NbtList([], NbtType.Compound)).set('blocks', new NbtList([], NbtType.Compound)).set('entities', new NbtList([], NbtType.Compound))
	return file
}
function validatePosition(file: NbtFile, pos: BlockPos): void {
	if (!canBuildStructure(file)) throw new Error('Build tools require a Java structure NBT with one palette. Create a new NBT structure to build from scratch.')
	const size = file.root.getList('size').getItems().map(t => t.getAsNumber())
	if (!pos.every((n, i) => Number.isSafeInteger(n) && n >= 0 && n < size[i])) throw new Error('Position is outside the structure. Increase Size before placing here.')
}
export function setStructureBlock(file: NbtFile, pos: BlockPos, brushId: string, properties: Record<string, string>): NbtEdit {
	validatePosition(file, pos)
	const brush = ae2CableItem(resourceId(brushId))
	const id = brush ? `${brush.namespace}:cable_bus` : resourceId(brushId)
	if (Object.keys(properties).length > 128 || Object.entries(properties).some(([k, v]) => !/^[a-z0-9_]+$/.test(k) || !/^[a-z0-9_.-]+$/.test(v) || v.length > 128)) throw new Error('Invalid block properties')
	const palette = file.root.getList('palette', NbtType.Compound)
	const state = new NbtCompound().set('Name', new NbtString(id))
	if (Object.keys(properties).length) state.set('Properties', new NbtCompound(new Map(Object.entries(properties).map(([k, v]) => [k, new NbtString(v)]))))
	let stateIndex = palette.getItems().findIndex(t => t.getString('Name') === id && JSON.stringify(Object.entries(t.getCompound('Properties').toSimplifiedJson()).sort()) === JSON.stringify(Object.entries(properties).sort()))
	const edits: NbtEdit[] = []
	if (stateIndex < 0) {
		stateIndex = palette.length
		edits.push(palette.length ? { type: 'add', path: ['palette', stateIndex], value: state.toJsonWithId() } : { type: 'set', path: ['palette'], old: file.root.get('palette')!.toJsonWithId(), new: new NbtList([state]).toJsonWithId() })
	}
	const blocks = file.root.getList('blocks', NbtType.Compound)
	const matches = blocks.getItems().map((t, i) => ({ t, i })).filter(({ t }) => BlockPos.equals(BlockPos.fromNbt(t.getList('pos')), pos))
	if (matches.length > 1) throw new Error('Duplicate blocks at this position; repair the NBT before editing it')
	const existing = matches[0]
	const tag = existing ? NbtCompound.fromJson(existing.t.toJson()) : new NbtCompound()
	tag.set('pos', new NbtList(pos.map(n => new NbtInt(n)))).set('state', new NbtInt(stateIndex))
	if (existing && palette.getCompound(existing.t.getNumber('state')).getString('Name') !== id) tag.delete('nbt')
	if (brush) tag.set('nbt', tag.getCompound('nbt').set('id', new NbtString(id)).set('cable', new NbtCompound().set('id', new NbtString(brushId))))
	edits.push(existing ? { type: 'set', path: ['blocks', existing.i], old: existing.t.toJsonWithId(), new: tag.toJsonWithId() } : blocks.length ? { type: 'add', path: ['blocks', blocks.length], value: tag.toJsonWithId() } : { type: 'set', path: ['blocks'], old: file.root.get('blocks')!.toJsonWithId(), new: new NbtList([tag]).toJsonWithId() })
	return { type: 'composite', edits }
}
export function removeStructureBlock(file: NbtFile, pos: BlockPos): NbtEdit | undefined {
	validatePosition(file, pos)
	const blocks = file.root.getList('blocks', NbtType.Compound)
	const index = blocks.getItems().findIndex(t => BlockPos.equals(BlockPos.fromNbt(t.getList('pos')), pos))
	return index < 0 ? undefined : { type: 'remove', path: ['blocks', index], value: blocks.getCompound(index).toJsonWithId() }
}

export interface RayHit { distance: number, normal: BlockPos }
export function intersectBox(origin: readonly number[], direction: readonly number[], min: readonly number[], max: readonly number[]): RayHit | undefined {
	let near = -Infinity; let far = Infinity
	let normal: BlockPos = [0, 0, 0]
	for (let axis = 0; axis < 3; axis++) {
		if (Math.abs(direction[axis]) < 1e-8) { if (origin[axis] < min[axis] || origin[axis] > max[axis]) return undefined; continue }
		const a = (min[axis] - origin[axis]) / direction[axis]
		const b = (max[axis] - origin[axis]) / direction[axis]
		const entry = Math.min(a, b)
		if (entry > near) { near = entry; normal = [0, 0, 0]; normal[axis] = a < b ? -1 : 1 }
		far = Math.min(far, Math.max(a, b))
		if (near > far) return undefined
	}
	return far < 0 || !Number.isFinite(near) ? undefined : { distance: Math.max(0, near), normal }
}
