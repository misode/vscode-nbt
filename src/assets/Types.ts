export type JsonObject = { [key: string]: unknown }
export interface ModelVariant { model: string, x?: number, y?: number, uvlock?: boolean, weight?: number }
export type VariantEntry = ModelVariant | ModelVariant[]
export type Condition = { [key: string]: string | Condition[] }
export interface BlockstateJson {
	variants?: Record<string, VariantEntry>
	multipart?: { when?: Condition, apply: VariantEntry }[]
}
export interface ModelFace { texture: string, uv?: [number, number, number, number], rotation?: 0 | 90 | 180 | 270, cullface?: string, tintindex?: number }
export interface ModelElement {
	from: [number, number, number]
	to: [number, number, number]
	rotation?: { origin: [number, number, number], axis: 'x' | 'y' | 'z', angle: number, rescale?: boolean }
	faces?: Record<string, ModelFace>
}
export interface ModelJson { parent?: string, textures?: Record<string, string | { sprite: string }>, elements?: ModelElement[], loader?: string, ambientocclusion?: boolean }
export function textureReference(value: string | { sprite: string }): string { return typeof value === 'string' ? value : value.sprite }
export interface AssetBundle {
	blockstates: Record<string, BlockstateJson>
	models: Record<string, ModelJson>
	textures: Record<string, string>
	diagnostics: string[]
	tint: [number, number, number]
	connectedTextures?: Record<string, ConnectedTexture>
}
export interface ConnectedTexture { texture: string, connectTo?: { block: string, properties?: Record<string, string> }[], ignoreStates: boolean, connectInside: boolean }
export interface MinecraftInstance {
	id: string
	name: string
	launcher: string
	directory: string
	version?: string
	loader: string
	mods: string[]
	resourcePacks: string[]
	clientJars: string[]
}
export interface BlockCatalog { ids: string[], total: number, offset: number, namespaces: string[] }
export interface BlockOptions { id: string, properties: Record<string, string[]>, defaults: Record<string, string> }
export const LIMITS = { resourceBytes: 8 * 1024 * 1024, entries: 250000, resources: 500000, jsonBytes: 2 * 1024 * 1024, bundleBytes: 32 * 1024 * 1024, depth: 64, blocks: 8192, textures: 2048, textureDimension: 1024, cacheBytes: 64 * 1024 * 1024 }

export function resourceId(value: string): string {
	const id = value.includes(':') ? value : `minecraft:${value}`
	if (!/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(id) || id.split(':')[1].split('/').some(p => !p || p === '.' || p === '..')) throw new Error(`Invalid resource identifier: ${value}`)
	return id
}

export function safeAssetPath(value: string): boolean {
	return /^assets\/[a-z0-9_.-]+\/(blockstates|models|textures)\/[a-z0-9_./-]+\.(json|png|png\.mcmeta)$/.test(value) && !value.split('/').some(p => !p || p === '.' || p === '..')
}

export function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error) }
