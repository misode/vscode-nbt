import { BlockPos, NbtCompound, NbtFile, NbtInt, NbtList, NbtString, NbtType } from 'deepslate'
import type { NbtEdit } from '../common/types'
import { resourceId } from '../assets/Types'
import { ae2CableItem } from '../assets/Ae2'
import type { StructureProvider } from 'deepslate'

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
	const propertyKey = JSON.stringify(Object.entries(properties).sort())
	let stateIndex = palette.getItems().findIndex(t => t.getString('Name') === id && JSON.stringify(Object.entries(t.getCompound('Properties').toSimplifiedJson()).sort()) === propertyKey)
	const edits: NbtEdit[] = []
	if (stateIndex < 0) {
		stateIndex = palette.length
		edits.push(palette.length ? { type: 'add', path: ['palette', stateIndex], value: state.toJsonWithId() } : { type: 'set', path: ['palette'], old: file.root.get('palette')!.toJsonWithId(), new: new NbtList([state]).toJsonWithId() })
	}
	const blocks = file.root.getList('blocks', NbtType.Compound)
	let existing: { t: NbtCompound, i: number } | undefined
	for (let i = 0; i < blocks.length; i++) {
		const t = blocks.getCompound(i)
		if (!BlockPos.equals(BlockPos.fromNbt(t.getList('pos')), pos)) continue
		if (existing) throw new Error('Duplicate blocks at this position; repair the NBT before editing it')
		existing = { t, i }
	}
	const tag = existing ? NbtCompound.fromJson(existing.t.toJson()) : new NbtCompound()
	tag.set('pos', new NbtList(pos.map(n => new NbtInt(n)))).set('state', new NbtInt(stateIndex))
	if (existing && palette.getCompound(existing.t.getNumber('state')).getString('Name') !== id) tag.delete('nbt')
	if (brush) {
		const nbt = tag.getCompound('nbt')
		tag.set('nbt', nbt.set('id', new NbtString(id)).set('cable', nbt.getCompound('cable').set('id', new NbtString(brushId))))
	}
	if (existing && !edits.length && JSON.stringify(existing.t.toJson()) === JSON.stringify(tag.toJson())) return { type: 'composite', edits: [] }
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
// Deepslate encodes positions as pos / 256 into an 8-bit framebuffer. Recover
// quantized candidates and use the click ray to distinguish adjacent cells.
export function resolveColorPick(structure: StructureProvider, color: readonly number[], origin: readonly number[], direction: readonly number[]): BlockPos | null {
	const encoded = (n: number) => Math.round(Math.min(1, Math.max(0, n / 256)) * 255)
	let positions: BlockPos[]
	if (color.some(n => n === 255)) positions = structure.getBlocks().map(b => b.pos).filter(pos => pos.every((n, i) => encoded(n) === color[i]))
	else {
		const axes = color.map(n => [...new Set([Math.floor(n * 256 / 255), Math.ceil(n * 256 / 255)])].filter(v => encoded(v) === n))
		positions = axes[0].flatMap(x => axes[1].flatMap(y => axes[2].map(z => [x, y, z] as BlockPos)))
	}
	let nearest = Infinity
	let picked: BlockPos | null = null
	for (const pos of positions) {
		const block = structure.getBlock(pos)
		if (!block || ['minecraft:air', 'minecraft:cave_air', 'minecraft:void_air'].includes(block.state.getName().toString())) continue
		const hit = intersectBox(origin, direction, pos, pos.map(n => n + 1))
		if (hit && hit.distance < nearest) { nearest = hit.distance; picked = pos }
	}
	return picked
}
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
