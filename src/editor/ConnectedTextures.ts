import { Mesh, Quad, Vector, Vertex } from 'deepslate'
import type { StructureProvider } from 'deepslate'
import type { ConnectedTexture } from '../assets/Types'

type UV = [number, number, number, number]
type Block = NonNullable<ReturnType<StructureProvider['getBlock']>>
export interface ConnectedSprite { rule: ConnectedTexture, base: UV, sheet: UV }

/** Render CTM corner pieces after block rotations, before world translation. */
export function connectTextures(mesh: Mesh, position: number[], block: Block, structure: StructureProvider, sprites: ReadonlyMap<string, ConnectedSprite>): Mesh {
	return new Mesh(mesh.quads.flatMap(quad => {
		const sprite = quad.v1.textureLimit && sprites.get(quad.v1.textureLimit.join(','))
		if (!sprite) return [quad]
		const { base, sheet, rule } = sprite
		const vertices = quad.vertices()
		const normalized = vertices.map(v => [(v.texture![0] - base[0]) / (base[2] - base[0]), (v.texture![1] - base[1]) / (base[3] - base[1])])
		// Cropped/rotated elements need a different subdivision scheme; retain
		// their base sprite rather than changing the geometry or stretching it.
		if (normalized.some(uv => uv.some(v => Math.abs(v - Math.round(v)) > 0.0001 || v < -0.0001 || v > 1.0001))) return [quad]
		const at = (u: number, v: number) => vertices[normalized.findIndex(uv => Math.abs(uv[0] - u) < 0.0001 && Math.abs(uv[1] - v) < 0.0001)]
		const origin = at(0, 0), right = at(1, 0), bottom = at(0, 1)
		if (!origin || !right || !bottom) return [quad]
		const u = right.pos.components().map((n, i) => n - origin.pos.components()[i])
		const v = bottom.pos.components().map((n, i) => n - origin.pos.components()[i])
		if ([u, v].some(axis => axis.filter(n => Math.abs(n) > 0.0001).length !== 1 || axis.some(n => Math.abs(n) > 1.0001 || Math.abs(n - Math.round(n)) > 0.0001))) return [quad]
		const normal = quad.normal().components().map(Math.round)
		const matches = (neighbor: ReturnType<StructureProvider['getBlock']>) => {
			if (!neighbor) return false
			if (rule.connectTo) return rule.connectTo.some(entry => neighbor.state.getName().toString() === entry.block && Object.entries(entry.properties ?? {}).every(([key, value]) => neighbor.state.getProperty(key) === value))
			return neighbor.state.getName().equals(block.state.getName()) && (rule.ignoreStates || neighbor.state.toString() === block.state.toString())
		}
		const connected = (offset: number[]) => {
			const target = position.map((n, i) => n + offset[i]) as [number, number, number]
			return matches(structure.getBlock(target)) && (rule.connectInside || !matches(structure.getBlock(target.map((n, i) => n + normal[i]) as [number, number, number])))
		}
		const pieces: Quad[] = []
		for (let t = 0; t < 2; t++) for (let s = 0; s < 2; s++) {
			const points = [[s / 2, t / 2], [(s + 1) / 2, t / 2], [(s + 1) / 2, (t + 1) / 2], [s / 2, (t + 1) / 2]]
			const center = interpolate(quad, (s + 0.5) / 2, (t + 0.5) / 2)
			const x = Math.floor((center.texture![0] - base[0]) / (base[2] - base[0]) * 2)
			const y = Math.floor((center.texture![1] - base[1]) / (base[3] - base[1]) * 2)
			const du = u.map(n => n * (x ? 1 : -1)), dv = v.map(n => n * (y ? 1 : -1))
			const a = connected(du), b = connected(dv), corner = a && b && connected(du.map((n, i) => n + dv[i]))
			// CTM's 2×2 sheet contains interior, vertical edge, horizontal edge,
			// and inner-corner styles. The original sprite supplies outer corners.
			const tileX = b && !corner ? 1 : 0, tileY = a && !corner ? 1 : 0
			const target = a || b ? region(sheet, tileX * 2 + x, tileY * 2 + y, 4) : region(base, x, y, 2)
			const piece = points.map(([su, tv]) => {
				const vertex = interpolate(quad, su, tv)
				const pu = (vertex.texture![0] - base[0]) / (base[2] - base[0]) * 2 - x
				const pv = (vertex.texture![1] - base[1]) / (base[3] - base[1]) * 2 - y
				vertex.texture = [target[0] + pu * (target[2] - target[0]), target[1] + pv * (target[3] - target[1])]
				vertex.textureLimit = target
				return vertex
			})
			pieces.push(new Quad(piece[0], piece[1], piece[2], piece[3]))
		}
		return pieces
	}))
}

function region(uv: UV, x: number, y: number, divisions: number): UV {
	const width = (uv[2] - uv[0]) / divisions, height = (uv[3] - uv[1]) / divisions
	return [uv[0] + x * width, uv[1] + y * height, uv[0] + (x + 1) * width, uv[1] + (y + 1) * height]
}

function interpolate(quad: Quad, s: number, t: number): Vertex {
	const vertices = quad.vertices(), weights = [(1 - s) * (1 - t), s * (1 - t), s * t, (1 - s) * t]
	const mix = (get: (v: Vertex) => number) => vertices.reduce((sum, v, i) => sum + weights[i] * get(v), 0)
	return new Vertex(new Vector(mix(v => v.pos.x), mix(v => v.pos.y), mix(v => v.pos.z)), [mix(v => v.color[0]), mix(v => v.color[1]), mix(v => v.color[2])], [mix(v => v.texture![0]), mix(v => v.texture![1])], quad.v1.textureLimit, quad.v1.normal, quad.v1.blockPos)
}
