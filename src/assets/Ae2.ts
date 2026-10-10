import type { NbtCompound, StructureProvider } from 'deepslate'
import type { ModelJson, ModelVariant } from './Types'

const directions = ['down', 'up', 'north', 'south', 'west', 'east'] as const
const offsets = [[0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]]
const rotations = [{ x: 90 }, { x: 270 }, {}, { y: 180 }, { y: 270 }, { y: 90 }]
type Block = ReturnType<StructureProvider['getBlock']>
export function isAe2Bus(id: string): boolean { return id === 'ae2:cable_bus' || id === 'appliedenergistics2:cable_bus' }
function cable(nbt?: NbtCompound) {
	const tag = nbt?.getCompound('cable')
	const id = tag?.getString('id') ?? ''
	const match = /^(ae2|appliedenergistics2):(fluix|transparent|white|orange|magenta|light_blue|yellow|lime|pink|gray|light_gray|cyan|purple|blue|brown|green|red|black)_(glass|covered|smart|covered_dense|smart_dense|dense_covered|dense_smart)_cable$/.exec(id)
	if (!match) return undefined
	const type = match[3].replace('covered_dense', 'dense_covered').replace('smart_dense', 'dense_smart')
	return { tag: tag!, namespace: match[1], color: match[2] === 'fluix' ? 'transparent' : match[2], type }
}
function parts(nbt: NbtCompound | undefined, report: (message: string) => void): ModelVariant[] {
	const result: ModelVariant[] = []
	for (const [i, direction] of directions.entries()) {
		if (!nbt?.hasCompound(direction)) continue
		const part = nbt.getCompound(direction)
		const match = /^(ae2|appliedenergistics2):([a-z_]+)$/.exec(part.getString('id'))
		if (!match) { report(`AE2 ${direction}: unsupported attachment ${part.getString('id')}`); continue }
		const [, ns, id] = match
		const visual = part.getCompound('visual')
		const state = visual.getBoolean('powered') ? visual.getBoolean('missingChannel') ? 'on' : 'has_channel' : 'off'
		let models: string[]
		if (['cable_anchor', 'energy_acceptor', 'quartz_fiber'].includes(id)) models = [id]
		else if (['import_bus', 'export_bus', 'storage_bus', 'interface'].includes(id)) models = [`${id}_base`, `${id}_${state}`]
		else if (id === 'pattern_provider') models = ['pattern_provider_base', `interface_${state}`]
		else if (['terminal', 'crafting_terminal'].includes(id)) models = ['display_base', `${id}_${state === 'off' ? 'off' : 'on'}`, `display_status_${state}`]
		else { report(`AE2 ${direction}: unsupported attachment ${id}`); continue }
		result.push(...models.map(model => ({ model: `${ns}:part/${model}`, ...rotations[i] })))
		if (!part.hasCompound('visual')) report('AE2 attachment: saved visual state unavailable; displaying unpowered model')
	}
	return result
}
// Read saved visual connections when present. Ordinary world saves omit visual
// data; in that case infer compatible cable neighbours, not arbitrary machines.
export function ae2Variants(block: Block, structure: StructureProvider, report: (message: string) => void = () => {}): ModelVariant[] | undefined {
	if (!block || !isAe2Bus(block.state.getName().toString())) return undefined
	const attachments = parts(block.nbt, report)
	const value = cable(block.nbt)
	if (!value) { if (attachments.length) return attachments; report('AE2 cable bus: missing or unsupported cable NBT; showing fallback'); return [{ model: 'nbtviewer:fallback' }] }
	if (value.type.includes('smart')) report('AE2 smart cable: cable geometry is supported; runtime channel-light overlays are not yet rendered')
	const visual = value.tag.getCompound('visual')
	const saved = visual.hasList('connections') ? visual.getList('connections').getItems().map(t => t.getAsString()) : undefined
	const connections = directions.filter((direction, i) => {
		if (saved) return saved.includes(direction)
		const offset = offsets[i]
		const neighbor = structure.getBlock([block.pos[0] + offset[0], block.pos[1] + offset[1], block.pos[2] + offset[2]])
		const other = neighbor && isAe2Bus(neighbor.state.getName().toString()) ? cable(neighbor.nbt) : undefined
		return !!other && (other.color === value.color || other.color === 'transparent' || value.color === 'transparent')
	})
	if (!saved) report('AE2: saved visual connections unavailable; inferred cable neighbours. Machine connections and channel lights may be incomplete.')
	const model = (shape: string) => `nbtviewer:ae2/${value.namespace}/${value.type}/${value.color}/${shape}`
	const opposite = !attachments.length && connections.length === 2 && (directions.indexOf(connections[0]) >> 1) === (directions.indexOf(connections[1]) >> 1)
	const variants: ModelVariant[] = opposite ? [{ model: model('straight'), ...rotations[directions.indexOf(connections[0])] }] : [{ model: model('center') }, ...connections.map(d => ({ model: model('connection'), ...rotations[directions.indexOf(d)] }))]
	return [...variants, ...attachments]
}
export function ae2ModelRequests(structure: StructureProvider): string[] {
	return [...new Set(structure.getBlocks().flatMap(block => ae2Variants(block, structure)?.map(v => v.model) ?? []))]
}
export function ae2Template(id: string): { source: string, convert: (model: ModelJson) => ModelJson } | undefined {
	const match = /^nbtviewer:ae2\/(ae2|appliedenergistics2)\/(glass|covered|smart|dense_covered|dense_smart)\/(transparent|white|orange|magenta|light_blue|yellow|lime|pink|gray|light_gray|cyan|purple|blue|brown|green|red|black)\/(center|connection|straight)$/.exec(id)
	if (!match) return undefined
	const [, namespace, type, color, shape] = match
	return { source: `${namespace}:part/cable/${type}/${shape}`, convert: model => {
		const core = type === 'glass' ? 'glass' : type.startsWith('dense') ? 'dense_smart' : 'covered'
		const base = `${namespace}:part/cable/${shape === 'center' ? `core/${core}` : type}/${color}`
		// Runtime channel overlays need powered/channel state and colour composition.
		// Keep the genuine cable geometry and diagnose the omitted lighting.
		return { ...model, textures: { ...Object.fromEntries(Object.entries(model.textures ?? {}).filter(([key]) => key !== 'channels')), base }, elements: model.elements?.map(e => ({ ...e, faces: Object.fromEntries(Object.entries(e.faces ?? {}).filter(([, f]) => f.texture !== '#channels')) })).filter(e => Object.keys(e.faces ?? {}).length > 0) }
	} }
}
