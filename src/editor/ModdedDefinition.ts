import type { BlockModelProvider, TextureAtlasProvider } from 'deepslate'
import { BlockColors, BlockDefinition, Cull, Identifier, Mesh } from 'deepslate'
import { mat4, vec3 } from 'gl-matrix'
import type { BlockstateJson, ModelVariant } from '../assets/Types'
import { chooseVariants } from '../assets/Validation'

// Deepslate's provider API omits positions. ResourceManager supplies the current
// block while ChunkBuilder iterates, keeping visible and picking choices identical.
export class ModdedDefinition extends BlockDefinition {
	constructor(private readonly json: BlockstateJson, private readonly seed: () => number, private readonly tint: [number, number, number], private readonly report: (message: string) => void, private readonly dynamic?: () => ModelVariant[] | undefined) { super(undefined, undefined) }
	getModelVariants(props: Record<string, string>) { return this.dynamic?.() ?? chooseVariants(this.json, props, this.seed()) }
	getMesh(name: Identifier | undefined, props: Record<string, string>, atlas: TextureAtlasProvider, models: BlockModelProvider, cull: Cull): Mesh {
		const mesh = new Mesh()
		const variants = this.getModelVariants(props)
		const fallback = () => models.getBlockModel(Identifier.parse('nbtviewer:fallback'))!.getMesh(atlas, {})
		if (!variants.length && this.json.variants) { this.report(`${name}: no matching static model`); mesh.merge(fallback()) }
		for (const variant of variants) {
			const model = models.getBlockModel(Identifier.parse(variant.model))
			if (!model) { this.report(`${name}: missing/unsupported model ${variant.model}`); mesh.merge(fallback()); continue }
			const part = model.getMesh(atlas, Cull.rotate(cull, variant.x ?? 0, variant.y ?? 0), name?.namespace === 'minecraft' ? BlockColors[name.path]?.(props) : this.tint)
			const t = mat4.create()
			mat4.translate(t, t, [8, 8, 8])
			mat4.rotateY(t, t, -(variant.y ?? 0) * Math.PI / 180)
			mat4.rotateX(t, t, -(variant.x ?? 0) * Math.PI / 180)
			mat4.translate(t, t, [-8, -8, -8])
			if (variant.uvlock) lockUV(part, t)
			mesh.merge(part.transform(t))
		}
		// Empty multipart is legitimate; missing or runtime models receive a fallback.
		return mesh.transform(mat4.fromScaling(mat4.create(), [1 / 16, 1 / 16, 1 / 16]))
	}
}

function uvBasis(normal: vec3): [vec3, vec3] {
	if (Math.abs(normal[1]) > 0.9) return normal[1] > 0 ? [[1, 0, 0], [0, 0, 1]] : [[0, 0, 1], [-1, 0, 0]]
	if (Math.abs(normal[0]) > 0.9) return normal[0] > 0 ? [[0, 0, -1], [0, -1, 0]] : [[0, 0, 1], [0, -1, 0]]
	return normal[2] > 0 ? [[1, 0, 0], [0, -1, 0]] : [[-1, 0, 0], [0, -1, 0]]
}
export function lockUV(mesh: Mesh, rotation: mat4): void {
	const r = mat4.clone(rotation)
	r[12] = r[13] = r[14] = 0
	for (const quad of mesh.quads) {
		const normal = quad.normal().components()
		if (Math.max(...normal.map(Math.abs)) < 0.999) continue
		const [u, v] = uvBasis(normal)
		const worldNormal = vec3.transformMat4(vec3.create(), normal, r)
		const [worldU, worldV] = uvBasis(worldNormal)
		const rotatedU = vec3.transformMat4(vec3.create(), u, r)
		const rotatedV = vec3.transformMat4(vec3.create(), v, r)
		const a = vec3.dot(rotatedU, worldU)
		const b = vec3.dot(rotatedV, worldU)
		const c = vec3.dot(rotatedU, worldV)
		const d = vec3.dot(rotatedV, worldV)
		for (const vertex of quad.vertices()) {
			if (!vertex.texture || !vertex.textureLimit) continue
			const [u0, v0, u1, v1] = vertex.textureLimit
			const du = u1 - u0
			const dv = v1 - v0
			if (!du || !dv) continue
			const x = (vertex.texture[0] - u0) / du - 0.5
			const y = (vertex.texture[1] - v0) / dv - 0.5
			vertex.texture = [u0 + (a * x + b * y + 0.5) * du, v0 + (c * x + d * y + 0.5) * dv]
		}
	}
}
