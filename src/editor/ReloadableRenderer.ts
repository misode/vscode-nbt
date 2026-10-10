import { StructureRenderer } from 'deepslate'

/** Reupload the existing GPU atlas without duplicating shaders and textures. */
export class ReloadableRenderer extends StructureRenderer {
	private atlasHandle!: WebGLTexture
	protected createAtlasTexture(image: ImageData): WebGLTexture { this.atlasHandle = super.createAtlasTexture(image); return this.atlasHandle }
	refreshAtlas(image: ImageData): void {
		this.gl.bindTexture(this.gl.TEXTURE_2D, this.atlasHandle)
		this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.gl.RGBA, this.gl.UNSIGNED_BYTE, image)
		this.gl.generateMipmap(this.gl.TEXTURE_2D)
	}
}
