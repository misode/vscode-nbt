import type { ConnectedTexture } from './Types'
import { resourceId } from './Types'

function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value) }

/** CTM v1 metadata: base sprite plus a 2×2 sheet of connected corner styles. */
export function connectedTexture(value: unknown): ConnectedTexture | undefined {
	if (!object(value) || value.ctm === undefined) return undefined
	const ctm = value.ctm
	if (!object(ctm) || ctm.ctm_version !== 1 || typeof ctm.type !== 'string' || ctm.type.toLowerCase() !== 'ctm') throw new Error('Unsupported connected texture metadata (supported: CTM v1 type CTM)')
	if (!Array.isArray(ctm.textures) || ctm.textures.length !== 1 || typeof ctm.textures[0] !== 'string') throw new Error('CTM requires one connected texture sheet')
	if (ctm.proxy !== undefined) throw new Error('CTM proxy layouts are not supported')
	const extra = object(ctm.extra) ? ctm.extra : {}
	let connectTo: ConnectedTexture['connectTo']
	if (extra.connect_to !== undefined) {
		if (!Array.isArray(extra.connect_to) || extra.connect_to.length > 256) throw new Error('Invalid CTM connection rules')
		connectTo = extra.connect_to.map(entry => {
			if (!object(entry) || typeof entry.block !== 'string') throw new Error('Unsupported CTM connection rule')
			let properties: Record<string, string> | undefined
			if (entry.properties !== undefined) {
				if (!object(entry.properties) || Object.keys(entry.properties).length > 128 || Object.values(entry.properties).some(v => typeof v !== 'string')) throw new Error('Invalid CTM block properties')
				properties = entry.properties as Record<string, string>
			}
			return { block: resourceId(entry.block), properties }
		})
	}
	return { texture: resourceId(ctm.textures[0]), connectTo, ignoreStates: extra.ignore_states === true, connectInside: extra.connect_inside === true }
}
