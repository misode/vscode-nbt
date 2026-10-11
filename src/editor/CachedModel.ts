import type { BlockModelElement, Color, TextureAtlasProvider , Cull} from 'deepslate'
import { BlockModel, Mesh, Quad, Vertex } from 'deepslate'
import { mat4 } from 'gl-matrix'

/** Shared bounded cache; returned meshes are copies because ChunkBuilder transforms them. */
export class GeometryCache {
	private readonly entries = new Map<string, Mesh>()
	private faces = 0
	get(key: string): Mesh | undefined {
		const mesh = this.entries.get(key)
		if (mesh) { this.entries.delete(key); this.entries.set(key, mesh); return copyMesh(mesh) }
		return undefined
	}
	put(key: string, mesh: Mesh): void {
		if (mesh.quads.length > 100000) return
		while (this.entries.size >= 2048 || this.faces + mesh.quads.length > 100000) {
			const first = this.entries.keys().next().value as string | undefined
			if (!first) break
			this.faces -= this.entries.get(first)!.quads.length; this.entries.delete(first)
		}
		this.entries.set(key, copyMesh(mesh)); this.faces += mesh.quads.length
	}
	clear(): void { this.entries.clear(); this.faces = 0 }
}

export class CachedModel extends BlockModel {
	constructor(private readonly id: string, textures: Record<string, string>, elements: BlockModelElement[] | undefined, private readonly cache: GeometryCache) { super(undefined, textures, elements) }
	getMesh(atlas: TextureAtlasProvider, cull: Cull, tint?: Color | ((index: number) => Color)): Mesh {
		// Vanilla dynamic tint functions can depend on inputs; leave those uncached.
		if (typeof tint === 'function') return super.getMesh(atlas, cull, tint)
		const key = `${this.id}:${JSON.stringify(cull)}:${JSON.stringify(tint)}`
		const cached = this.cache.get(key)
		if (cached) return cached
		const mesh = super.getMesh(atlas, cull, tint)
		this.cache.put(key, mesh)
		return mesh
	}
	getElementMesh(element: BlockModelElement, atlas: TextureAtlasProvider, cull: Cull, getTint: (index?: number) => Color): Mesh {
		const rotation = element.rotation
		if (!rotation?.rescale) return super.getElementMesh(element, atlas, cull, getTint)
		// Deepslate 0.26 uses sqrt(2) for both 22.5 and 45 degrees. Preserve its
		// UV/face generation, then apply Minecraft's angle-dependent rescale.
		const mesh = super.getElementMesh({ ...element, rotation: { ...rotation, rescale: false } }, atlas, cull, getTint)
		const angle = rotation.angle * Math.PI / 180
		const axis: [number, number, number] = rotation.axis === 'x' ? [1, 0, 0] : rotation.axis === 'y' ? [0, 1, 0] : [0, 0, 1]
		const scale = axis.map(n => n ? 1 : 1 / Math.cos(angle)) as [number, number, number]
		const t = mat4.create()
		mat4.translate(t, t, rotation.origin); mat4.rotate(t, t, angle, axis); mat4.scale(t, t, scale); mat4.rotate(t, t, -angle, axis); mat4.translate(t, t, rotation.origin.map(n => -n) as [number, number, number])
		return mesh.transform(t)
	}
}

function copyMesh(mesh: Mesh): Mesh {
	const vertex = (v: Vertex) => new Vertex(v.pos, [...v.color], v.texture ? [...v.texture] : undefined, v.textureLimit ? [...v.textureLimit] : undefined, v.normal, v.blockPos)
	return new Mesh(mesh.quads.map(q => new Quad(vertex(q.v1), vertex(q.v2), vertex(q.v3), vertex(q.v4))))
}
