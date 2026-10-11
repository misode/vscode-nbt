import { promises as fs } from 'fs'
import * as path from 'path'
import type * as yauzl from 'yauzl'
import type { AssetBundle, BlockCatalog, BlockOptions, MinecraftInstance, ModelJson } from './Types'
import { errorText, LIMITS, resourceId, safeAssetPath, textureReference } from './Types'
import { modelReferences, validateBlockstate, validateModel } from './Validation'
import { ae2CableItem, ae2Template } from './Ae2'
import { blockOptions } from './BlockOptions'
import { connectedTexture } from './ConnectedTextures'
import { openArchive } from './Zip'

interface Location { source: string, entry?: yauzl.Entry, fingerprint: string }
async function fingerprint(file: string): Promise<string> { const s = await fs.stat(file); return `${s.size}:${s.mtimeMs}:${s.ctimeMs}` }
export class ResourceIndex {
	private readonly index = new Map<string, Location>()
	private readonly namespaces = new Set<string>()
	private readonly cache = new Map<string, Buffer>()
	private cacheBytes = 0
	private generation = 0
	private sources: string[] = []
	private signatures: string[] = []
	private readonly archiveIndexes = new Map<string, { signature: string, entries: [string, Location][], diagnostics: string[] }>()
	readonly diagnostics: string[] = []
	private hits = 0
	private misses = 0
	private archivesRead = 0
	private archivesReused = 0
	private blockIds?: string[]
	private blockNamespaces?: string[]
	private catalogSearch?: { query: string, namespace: string, matches: string[] }
	private catalogIds(): string[] {
		if (this.blockIds) return this.blockIds
		const ids = [...this.index.keys()].flatMap(name => { const match = /^assets\/([^/]+)\/blockstates\/(.+)\.json$/.exec(name); return match ? [`${match[1]}:${match[2]}`] : [] })
		for (const namespace of ['ae2', 'appliedenergistics2']) if (ids.includes(`${namespace}:cable_bus`)) {
			for (const type of ['glass', 'covered', 'smart', 'dense_covered', 'dense_smart']) {
				if (!this.index.has(`assets/${namespace}/models/part/cable/${type}/center.json`)) continue
				for (const color of ['transparent', 'white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black']) {
					if (this.index.has(`assets/${namespace}/textures/part/cable/${type}/${color}.png`)) ids.push(`${namespace}:${color === 'transparent' ? 'fluix' : color}_${type.replace('dense_covered', 'covered_dense').replace('dense_smart', 'smart_dense')}_cable`)
				}
			}
		}
		return this.blockIds = [...new Set(ids)].sort()
	}
	catalog(query: string, namespace: string, offset: number): BlockCatalog {
		const ids = this.catalogIds()
		query = query.toLowerCase()
		if (!this.catalogSearch || this.catalogSearch.query !== query || this.catalogSearch.namespace !== namespace) {
			this.catalogSearch = { query, namespace, matches: ids.filter(id => (!namespace || id.startsWith(`${namespace}:`)) && id.includes(query)) }
		}
		this.blockNamespaces ??= [...new Set(ids.map(id => id.split(':')[0]))].sort()
		const matches = this.catalogSearch.matches
		return { ids: matches.slice(offset, offset + 100), total: matches.length, offset, namespaces: [...this.blockNamespaces] }
	}
	async blockOptions(id: string): Promise<BlockOptions> {
		id = resourceId(id)
		if (!this.catalogIds().includes(id)) throw new Error('Block is not present in the selected instance assets')
		if (ae2CableItem(id)) return blockOptions(id)
		const [namespace, name] = id.split(':')
		const json = await this.json(`assets/${namespace}/blockstates/${name}.json`)
		return blockOptions(id, json === undefined ? undefined : validateBlockstate(json))
	}
	get stats() { return { resources: this.index.size, namespaces: [...this.namespaces].sort(), cacheEntries: this.cache.size, cacheBytes: this.cacheBytes, hits: this.hits, misses: this.misses, archivesRead: this.archivesRead, archivesReused: this.archivesReused } }
	clear(): void { this.generation++; this.index.clear(); this.blockIds = undefined; this.blockNamespaces = undefined; this.catalogSearch = undefined; this.namespaces.clear(); this.archiveIndexes.clear(); this.cache.clear(); this.cacheBytes = 0; this.hits = 0; this.misses = 0; this.archivesRead = 0; this.archivesReused = 0; this.diagnostics.length = 0; this.sources = []; this.signatures = [] }
	private report(message: string): void { if (this.diagnostics.length < 1000 && !this.diagnostics.includes(message)) this.diagnostics.push(message) }
	async build(instance: MinecraftInstance, extraPacks: string[] = [], progress: (message: string) => void = () => {}, cancelled: () => boolean = () => false): Promise<void> {
		this.generation++; this.index.clear(); this.blockIds = undefined; this.blockNamespaces = undefined; this.catalogSearch = undefined; this.namespaces.clear(); this.diagnostics.length = 0; this.signatures = []
		const generation = this.generation
		this.sources = [...instance.clientJars, ...instance.mods, ...instance.resourcePacks, ...extraPacks]
		for (const source of this.archiveIndexes.keys()) if (!this.sources.includes(source)) this.archiveIndexes.delete(source)
		for (const [sourceIndex, source] of this.sources.entries()) {
			if (cancelled() || generation !== this.generation) throw new Error('Asset indexing cancelled')
			progress(`Indexing ${path.basename(source)}`)
			try {
				const signature = await fingerprint(source)
				this.signatures[sourceIndex] = signature
				if ((await fs.stat(source)).isDirectory()) await this.walk(source, source, 0, generation)
				else {
					const saved = this.archiveIndexes.get(source)
					if (saved?.signature === signature) { this.archivesReused++; saved.diagnostics.forEach(s => this.report(s)); for (const [name, location] of saved.entries) this.add(name, location, generation) }
					else {
						this.archivesRead++
						const diagnosticStart = this.diagnostics.length
						const entries = await this.archive(source, signature, generation, cancelled)
						this.archiveIndexes.set(source, { signature, entries, diagnostics: this.diagnostics.slice(diagnosticStart) })
					}
				}
			} catch (e) { if (generation !== this.generation || cancelled()) throw e; this.report(`${source}: ${errorText(e)}`) }
		}
	}
	private add(name: string, location: Location, generation: number): void {
		if (generation !== this.generation) throw new Error('Obsolete asset index')
		if (!safeAssetPath(name)) return
		if (this.index.size >= LIMITS.resources && !this.index.has(name)) throw new Error('Resource index limit reached')
		this.index.set(name, location)
		this.namespaces.add(name.split('/')[1])
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
	private async archive(source: string, signature: string, generation: number, cancelled: () => boolean): Promise<[string, Location][]> {
		const entries: [string, Location][] = []
		const zip = await openArchive(source)
		try { await new Promise<void>((resolve, reject) => {
			let count = 0
			zip.on('error', reject)
			zip.on('end', resolve)
			zip.on('entry', (entry: yauzl.Entry) => {
				try {
					if (cancelled() || ++count > LIMITS.entries) throw new Error('Archive cancelled or entry count exceeded')
					if (safeAssetPath(entry.fileName) && entry.uncompressedSize <= LIMITS.resourceBytes && !(entry.generalPurposeBitFlag & 1)) {
						const location = { source, entry, fingerprint: signature }
						this.add(entry.fileName, location, generation); entries.push([entry.fileName, location])
					}
					else if (/^assets\/[^/]+\/(models|blockstates|textures)\/.*\.(json|png)$/.test(entry.fileName)) this.report(`Skipped unsafe/oversized/unsupported entry ${entry.fileName}`)
					zip.readEntry()
				} catch (e) { reject(e) }
			})
			zip.readEntry()
		}) } finally { zip.close() }
		return entries
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
			const zip = await openArchive(location.source, false)
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
				const template = ae2Template(id)
				const [ns, p] = resourceId(template?.source ?? id).split(':')
				const value = await this.json(`assets/${ns}/models/${p}.json`)
				if (value === undefined) return // vanilla parents can come from the existing atlas assets
				const parsed: ModelJson = validateModel(template ? template.convert(validateModel(value)) : value)
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
		let loadedTextures = 0
		for (const id of textures) {
			if (loadedTextures++ >= LIMITS.textures) { failure('Texture dependency limit reached'); break }
			check()
			try {
				const [ns, p] = id.split(':'); const png = await this.read(`assets/${ns}/textures/${p}.png`)
				if (!png) { if (ns !== 'minecraft') failure(`${id}: missing texture`); continue }
				if (png.length < 24 || !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || png.readUInt32BE(16) < 1 || png.readUInt32BE(20) < 1 || png.readUInt32BE(16) > LIMITS.textureDimension || png.readUInt32BE(20) > LIMITS.textureDimension * 64 || png.readUInt32BE(16) * png.readUInt32BE(20) > 4 * 1024 * 1024) throw new Error('Invalid or oversized PNG')
				bundle.textures[id] = png.toString('base64'); bytes += bundle.textures[id].length
				try {
					const rule = connectedTexture(await this.json(`assets/${ns}/textures/${p}.png.mcmeta`))
					if (rule) { (bundle.connectedTextures ??= Object.create(null))[id] = rule; textures.add(rule.texture); bytes += JSON.stringify(rule).length }
				} catch (e) { failure(`${id}: ${errorText(e)}; using base texture`) }
			} catch (e) { failure(`${id}: ${errorText(e)}`) }
		}
		check()
		return bundle
	}
}
