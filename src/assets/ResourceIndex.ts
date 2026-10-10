import { promises as fs } from 'fs'
import * as path from 'path'
import * as yauzl from 'yauzl'
import type { AssetBundle, MinecraftInstance, ModelJson } from './Types'
import { errorText, LIMITS, resourceId, safeAssetPath, textureReference } from './Types'
import { modelReferences, validateBlockstate, validateModel } from './Validation'

interface Location { source: string, entry?: yauzl.Entry, fingerprint: string }
function open(file: string): Promise<yauzl.ZipFile> { return new Promise((resolve, reject) => yauzl.open(file, { lazyEntries: true, autoClose: false, validateEntrySizes: true }, (e, zip) => e || !zip ? reject(e ?? new Error('Cannot open ZIP')) : resolve(zip))) }
async function fingerprint(file: string): Promise<string> { const s = await fs.stat(file); return `${s.size}:${s.mtimeMs}:${s.ctimeMs}` }
export class ResourceIndex {
	private readonly index = new Map<string, Location>()
	private readonly cache = new Map<string, Buffer>()
	private cacheBytes = 0
	private generation = 0
	private sources: string[] = []
	private signatures: string[] = []
	readonly diagnostics: string[] = []
	private hits = 0
	private misses = 0
	get stats() { return { resources: this.index.size, namespaces: [...new Set([...this.index.keys()].map(k => k.split('/')[1]))].sort(), cacheEntries: this.cache.size, cacheBytes: this.cacheBytes, hits: this.hits, misses: this.misses } }
	clear(): void { this.generation++; this.index.clear(); this.cache.clear(); this.cacheBytes = 0; this.hits = 0; this.misses = 0; this.diagnostics.length = 0; this.sources = []; this.signatures = [] }
	private report(message: string): void { if (this.diagnostics.length < 1000 && !this.diagnostics.includes(message)) this.diagnostics.push(message) }
	async build(instance: MinecraftInstance, extraPacks: string[] = [], progress: (message: string) => void = () => {}, cancelled: () => boolean = () => false): Promise<void> {
		this.clear()
		const generation = this.generation
		this.sources = [...instance.clientJars, ...instance.mods, ...instance.resourcePacks, ...extraPacks]
		for (const [sourceIndex, source] of this.sources.entries()) {
			if (cancelled() || generation !== this.generation) throw new Error('Asset indexing cancelled')
			progress(`Indexing ${path.basename(source)}`)
			try {
				const signature = await fingerprint(source)
				this.signatures[sourceIndex] = signature
				if ((await fs.stat(source)).isDirectory()) await this.walk(source, source, 0, generation)
				else await this.archive(source, signature, generation, cancelled)
			} catch (e) { if (generation !== this.generation || cancelled()) throw e; this.report(`${source}: ${errorText(e)}`) }
		}
	}
	private add(name: string, location: Location, generation: number): void {
		if (generation !== this.generation) throw new Error('Obsolete asset index')
		if (!safeAssetPath(name)) return
		if (this.index.size >= LIMITS.resources && !this.index.has(name)) throw new Error('Resource index limit reached')
		this.index.set(name, location)
	}
	private async walk(root: string, directory: string, depth: number, generation: number): Promise<void> {
		if (depth >= LIMITS.depth) throw new Error('Resource directory depth limit')
		for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
			if (entry.isSymbolicLink()) continue
			const file = path.join(directory, entry.name)
			const relative = path.relative(root, file).split(path.sep).join('/')
			if (entry.isDirectory() && (depth > 0 || entry.name === 'assets')) await this.walk(root, file, depth + 1, generation)
			else if (entry.isFile() && safeAssetPath(relative)) { const real = await fs.realpath(file); if (!path.relative(root, real).startsWith('..')) this.add(relative, { source: file, fingerprint: await fingerprint(file) }, generation) }
		}
	}
	private async archive(source: string, signature: string, generation: number, cancelled: () => boolean): Promise<void> {
		const zip = await open(source)
		try { await new Promise<void>((resolve, reject) => {
			let count = 0
			zip.on('error', reject)
			zip.on('end', resolve)
			zip.on('entry', (entry: yauzl.Entry) => {
				try {
					if (cancelled() || ++count > LIMITS.entries) throw new Error('Archive cancelled or entry count exceeded')
					if (safeAssetPath(entry.fileName) && entry.uncompressedSize <= LIMITS.resourceBytes && !(entry.generalPurposeBitFlag & 1)) this.add(entry.fileName, { source, entry, fingerprint: signature }, generation)
					else if (entry.fileName.startsWith('assets/') && !entry.fileName.endsWith('/')) this.report(`Skipped unsafe/oversized/unsupported entry ${entry.fileName}`)
					zip.readEntry()
				} catch (e) { reject(e) }
			})
			zip.readEntry()
		}) } finally { zip.close() }
	}
	async changed(): Promise<boolean> {
		for (let i = 0; i < this.sources.length; i++) { try { if (await fingerprint(this.sources[i]) !== this.signatures[i]) return true } catch { return true } }
		for (const location of this.index.values()) if (!location.entry) { try { if (await fingerprint(location.source) !== location.fingerprint) return true } catch { return true } }
		return false
	}
	async read(name: string): Promise<Buffer | undefined> {
		const location = this.index.get(name)
		if (!location) return undefined
		const key = `${location.source}:${location.fingerprint}:${name}`
		if (await fingerprint(location.source) !== location.fingerprint) throw new Error(`Resource changed during load: ${location.source}`)
		const cached = this.cache.get(key)
		if (cached) { this.hits++; this.cache.delete(key); this.cache.set(key, cached); return cached }
		this.misses++
		let data: Buffer
		if (!location.entry) { if ((await fs.stat(location.source)).size > LIMITS.resourceBytes) throw new Error('Resource size limit'); data = await fs.readFile(location.source) }
		else {
			const zip = await open(location.source)
			try { data = await new Promise<Buffer>((resolve, reject) => zip.openReadStream(location.entry!, (e, stream) => {
				if (e || !stream) { reject(e ?? new Error('No archive stream')); return }
				const chunks: Buffer[] = []; let size = 0
				stream.on('error', reject)
				stream.on('data', (chunk: Buffer) => { size += chunk.length; if (size > LIMITS.resourceBytes) stream.destroy(new Error('Decompression limit')); else chunks.push(chunk) })
				stream.on('end', () => resolve(Buffer.concat(chunks)))
			})) } finally { zip.close() }
		}
		while (this.cacheBytes + data.length > LIMITS.cacheBytes && this.cache.size) { const first = this.cache.keys().next().value as string; this.cacheBytes -= this.cache.get(first)!.length; this.cache.delete(first) }
		this.cache.set(key, data); this.cacheBytes += data.length
		return data
	}
	private async json(name: string): Promise<unknown> {
		const bytes = await this.read(name)
		if (!bytes) return undefined
		if (bytes.length > LIMITS.jsonBytes) throw new Error('JSON size limit')
		return JSON.parse(bytes.toString('utf8')) as unknown
	}
	async bundle(ids: string[], tint: [number, number, number] = [1, 1, 1], cancelled: () => boolean = () => false, extraModels: string[] = [], extraTextures: string[] = []): Promise<AssetBundle> {
		const bundle: AssetBundle = { blockstates: Object.create(null), models: Object.create(null), textures: Object.create(null), diagnostics: [], tint }
		const generation = this.generation
		const textures = new Set<string>(extraTextures.slice(0, LIMITS.textures).map(resourceId))
		const attempted = new Set<string>()
		let bytes = 0
		const check = () => { if (cancelled() || generation !== this.generation) throw new Error('Obsolete resource request'); if (bytes > LIMITS.bundleBytes) throw new Error('Structure asset budget exceeded') }
		const failure = (s: string) => { if (bundle.diagnostics.length < 1000) bundle.diagnostics.push(s); this.report(s) }
		const model = async (id: string, stack: string[]): Promise<void> => {
			check()
			if (stack.includes(id) || stack.length >= LIMITS.depth) { failure(`${id}: inheritance cycle/depth limit`); return }
			if (attempted.has(id)) return
			attempted.add(id)
			try {
				const [ns, p] = resourceId(id).split(':')
				const value = await this.json(`assets/${ns}/models/${p}.json`)
				if (value === undefined) return // vanilla parents can come from the existing atlas assets
				const parsed: ModelJson = validateModel(value)
				bundle.models[id] = parsed; bytes += JSON.stringify(parsed).length
				for (const value of Object.values(parsed.textures ?? {})) { const ref = textureReference(value); if (!ref.startsWith('#')) textures.add(resourceId(ref)) }
				for (const e of parsed.elements ?? []) for (const face of Object.values(e.faces ?? {})) if (!face.texture.startsWith('#')) textures.add(resourceId(face.texture))
				if (parsed.parent) await model(resourceId(parsed.parent), [...stack, id])
			} catch (e) { failure(`${id}: ${errorText(e)}`) }
		}
		for (const id of [...new Set(ids)].slice(0, LIMITS.blocks)) {
			check()
			try {
				const [ns, p] = resourceId(id).split(':')
				const value = await this.json(`assets/${ns}/blockstates/${p}.json`)
				if (value === undefined) { if (ns !== 'minecraft') failure(`${id}: no static blockstate (missing or runtime renderer)`); continue }
				const parsed = validateBlockstate(value)
				bundle.blockstates[id] = parsed; bytes += JSON.stringify(parsed).length
				for (const ref of modelReferences(parsed)) await model(ref, [])
			} catch (e) { failure(`${id}: ${errorText(e)}`) }
		}
		for (const id of extraModels.slice(0, LIMITS.blocks)) await model(resourceId(id), [])
		// Overrides may target vanilla textures even when their models remain upstream.
		for (const id of attempted) { const [ns, p] = id.split(':'); const t = `${ns}:${p}`; if (this.index.has(`assets/${ns}/textures/${p}.png`)) textures.add(t) }
		for (const id of [...textures].slice(0, LIMITS.textures)) {
			check()
			try {
				const [ns, p] = id.split(':'); const png = await this.read(`assets/${ns}/textures/${p}.png`)
				if (!png) { if (ns !== 'minecraft') failure(`${id}: missing texture`); continue }
				if (png.length < 24 || !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || png.readUInt32BE(16) < 1 || png.readUInt32BE(20) < 1 || png.readUInt32BE(16) > LIMITS.textureDimension || png.readUInt32BE(20) > LIMITS.textureDimension * 64 || png.readUInt32BE(16) * png.readUInt32BE(20) > 4 * 1024 * 1024) throw new Error('Invalid or oversized PNG')
				bundle.textures[id] = png.toString('base64'); bytes += bundle.textures[id].length
			} catch (e) { failure(`${id}: ${errorText(e)}`) }
		}
		check()
		return bundle
	}
}
