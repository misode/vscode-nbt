import type { BlockstateJson, ModelJson } from '../assets/Types'

/** Only complete static cubes can safely hide a face against the same block ID.
 * Check all variants: ChunkBuilder's flags are per ID, not per block state. */
export function isSelfCullingCube(state: BlockstateJson, models: Record<string, ModelJson>): boolean {
	if (!state.variants || state.multipart) return false
	const variants = Object.values(state.variants).flatMap(value => Array.isArray(value) ? value : [value])
	return variants.length > 0 && variants.every(variant => {
		const model = models[variant.model]
		if (!model || model.loader || model.elements?.length !== 1) return false
		const element = model.elements[0]
		if (element.rotation || element.from.some(n => n !== 0) || element.to.some(n => n !== 16)) return false
		return ['up', 'down', 'north', 'south', 'east', 'west'].every(direction => element.faces?.[direction]?.cullface === direction)
	})
}
