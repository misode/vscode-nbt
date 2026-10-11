import { Mesh, StructureRenderer } from 'deepslate'
import type { Quad, StructureProvider } from 'deepslate'
import type { mat4, vec3 } from 'gl-matrix'

/** Reupload the existing GPU atlas without duplicating shaders and textures. */
export class ReloadableRenderer extends StructureRenderer {
	private atlasHandle!: WebGLTexture
	private atlasImage!: ImageData
	private collecting?: Mesh[]
	private opaque?: Mesh[]
	private translucent: Mesh[] = []
	private sortedView = ''
	private maxAttributes?: number
	private readonly alpha = new Map<string, boolean>()
	protected createAtlasTexture(image: ImageData): WebGLTexture { this.atlasImage = image; this.atlasHandle = super.createAtlasTexture(image); return this.atlasHandle }
	refreshAtlas(image: ImageData): void {
		this.atlasImage = image
		this.alpha.clear()
		this.invalidate()
		this.gl.bindTexture(this.gl.TEXTURE_2D, this.atlasHandle)
		this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.gl.RGBA, this.gl.UNSIGNED_BYTE, image)
		this.gl.generateMipmap(this.gl.TEXTURE_2D)
	}
	updateStructureBuffers(positions?: vec3[]): void { super.updateStructureBuffers(positions); this.invalidate() }
	setStructure(structure: StructureProvider): void { super.setStructure(structure); this.invalidate() }
	private invalidate(): void {
		for (const mesh of [...(this.opaque ?? []), ...this.translucent]) { mesh.clear(); mesh.rebuild(this.gl, attributes) }
		this.opaque = undefined; this.translucent = []; this.sortedView = ''
	}
	protected drawMesh(mesh: Mesh, options: Parameters<StructureRenderer['drawMesh']>[1]): void {
		if (this.collecting) this.collecting.push(mesh)
		else this.drawBatch(mesh, options)
	}
	private drawBatch(mesh: Mesh, options: Parameters<StructureRenderer['drawMesh']>[1]): void {
		// Grid/picking shaders use fewer attributes. Do not leave their enabled
		// arrays pointing into a shorter or released buffer from the previous pass.
		this.maxAttributes ??= this.gl.getParameter(this.gl.MAX_VERTEX_ATTRIBS) as number
		for (let i = 0; i < this.maxAttributes; i++) this.gl.disableVertexAttribArray(i)
		super.drawMesh(mesh, options)
	}
	drawStructure(view: mat4): void {
		// Let Deepslate prepare its shader and atlas; partition the actual generated
		// faces instead of guessing transparency from a mod's namespace.
		this.collecting = []
		try { super.drawStructure(view) } finally {
			if (!this.opaque) {
				this.opaque = []
				for (const mesh of this.collecting) {
					const solid = mesh.quads.filter(q => !this.hasAlpha(q))
					const blend = mesh.quads.filter(q => this.hasAlpha(q))
					this.opaque.push(...batches(solid).map(m => m.rebuild(this.gl, attributes)))
					this.translucent.push(...batches(blend))
				}
			}
			this.collecting = undefined
		}
		const key = Array.from(view).join(',')
		if (this.sortedView !== key) {
			const faces = this.translucent.flatMap(m => m.quads).map(quad => ({ quad, depth: faceDepth(quad, view) })).sort((a, b) => a.depth - b.depth).map(entry => entry.quad)
			let offset = 0
			for (const mesh of this.translucent) {
				mesh.quads = faces.slice(offset, offset + mesh.quads.length); offset += mesh.quads.length
				mesh.rebuild(this.gl, attributes)
			}
			this.sortedView = key
		}
		try {
			this.gl.depthMask(true)
			for (const mesh of this.opaque ?? []) this.drawBatch(mesh, attributes)
			this.gl.depthMask(false)
			for (const mesh of this.translucent) this.drawBatch(mesh, attributes)
		} finally { this.gl.depthMask(true) }
	}
	private hasAlpha(quad: Quad): boolean {
		const uv = quad.v1.textureLimit
		if (!uv) return false
		const key = uv.join(',')
		const cached = this.alpha.get(key)
		if (cached !== undefined) return cached
		const { width, height, data } = this.atlasImage
		const x0 = Math.max(0, Math.floor(uv[0] * width)), x1 = Math.min(width, Math.ceil(uv[2] * width))
		const y0 = Math.max(0, Math.floor(uv[1] * height)), y1 = Math.min(height, Math.ceil(uv[3] * height))
		let transparent = false
		for (let y = y0; y < y1 && !transparent; y++) for (let x = x0; x < x1; x++) if (data[(y * width + x) * 4 + 3] < 255) { transparent = true; break }
		this.alpha.set(key, transparent)
		return transparent
	}
}

const attributes = { pos: true, color: true, texture: true, normal: true }
function batches(quads: Quad[]): Mesh[] {
	const result: Mesh[] = []
	// Deepslate's index buffers use Uint16; four vertices per face.
	for (let i = 0; i < quads.length; i += 16000) result.push(new Mesh(quads.slice(i, i + 16000)))
	return result
}
export function faceDepth(quad: Quad, view: mat4): number {
	return quad.vertices().reduce((depth, v) => depth + view[2] * v.pos.x + view[6] * v.pos.y + view[10] * v.pos.z + view[14], 0) / 4
}
