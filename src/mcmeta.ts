import envPaths from 'env-paths'
import path from 'path'
import { Readable, Writable } from 'stream'
import tar from 'tar'
import type { Logger } from './common/types'
import type { Job } from './Downloader'
import { Downloader } from './Downloader'

const MCMETA = 'https://raw.githubusercontent.com/misode/mcmeta'
const FALLBACK_VERSION = '1.18.2'

const cacheRoot = envPaths('vscode-nbt').cache
export const mcmetaRoot = path.join(cacheRoot, 'mcmeta')

interface McmetaVersion {
	id: string,
	name: string,
	release_target: string,
	type: 'release' | 'snapshot',
	stable: boolean,
	data_version: number,
	protocol_version: number,
	data_pack_version: number,
	resource_pack_version: number,
	build_time: string,
	release_time: string,
	sha1: string
}

export async function getAssets(dataVersion: number | undefined, logger: Logger) {
	const downloader = new Downloader(mcmetaRoot, logger)

	const versions = await downloader.download<McmetaVersion[]>({
		id: 'versions',
		uri: `${MCMETA}/summary/versions/data.min.json`,
		transformer: data => JSON.parse(data.toString('utf-8')),
		cache: cacheOptions(),
	})
	const target = dataVersion ?? versions?.find(v => v.type === 'release')?.data_version
	const version = versions?.find(v => v.data_version === target)?.id ?? FALLBACK_VERSION
	logger.info(`Found matching version for ${target}: ${version}`)

	const [blocks, atlas, uvmapping] = await Promise.all([
		downloader.download({
			id: `${version}-blocks`,
			uri: `${MCMETA}/${version}-summary/blocks/data.min.json`,
			transformer: () => true,
			cache: cacheOptions(data => Buffer.from('const stringifiedBlocks = `' + data.toString('utf-8') + '`')),
		}),
		downloader.download({
			id: `${version}-atlas`,
			uri: `${MCMETA}/${version}-atlas/all/atlas.png`,
			transformer: () => true,
			cache: cacheOptions(),
		}),
		downloader.download({
			id: `${version}-uvmapping`,
			uri: `${MCMETA}/${version}-atlas/all/data.min.json`,
			transformer: () => true,
			cache: cacheOptions(data => Buffer.from('const stringifiedUvmapping = `' + data.toString('utf-8') + '`')),
		}),
		downloader.download({
			id: `${version}-assets`,
			uri: `https://github.com/misode/mcmeta/tarball/${version}-assets-json`,
			transformer: data => data,
			cache: cacheOptions(async data => {
				const entries = await readTarGz(data, (path: string) => {
					return path.includes('/assets/minecraft/models/')
						|| path.includes('/assets/minecraft/blockstates/')
				})
				const filterEntries = (type: string) => {
					const pattern = RegExp(`/assets/minecraft/${type}/([a-z0-9/_]+)\\.json`)
					return Object.fromEntries(entries.flatMap<[string, unknown]>(({ path, data }) => {
						const match = path.match(pattern)
						return match ? [[match[1], JSON.parse(data)]] : []
					}))
				}
				const blockstates = filterEntries('blockstates')
				const models = filterEntries('models')
				return Buffer.from('const stringifiedAssets = `' + JSON.stringify({ blockstates, models }) + '`')
			}),
		}),
	])

	if (!blocks || !atlas || !uvmapping) {
		throw new Error('Failed loading assets')
	}

	return {
		version,
	}
}

function cacheOptions(serializer?: (data: Buffer) => Buffer | Promise<Buffer>): Job<unknown>['cache'] {
	return {
		checksumExtension: '.cache',
		checksumJob: {
			uri: `${MCMETA}/summary/version.json`,
			transformer: data => JSON.parse(data.toString('utf-8')).id,
		},
		serializer,
	}
}

interface TarEntry {
	path: string,
	data: string,
}

function readTarGz(buffer: Buffer, filter: (path: string) => boolean = (() => true)) {
	const entries: TarEntry[] = []
	return new Promise<TarEntry[]>((res, rej) => {
		Readable.from(buffer)
			.on('error', err => rej(err))
			.pipe(new tar.Parse())
			.on('entry', entry => {
				if (filter(entry.path)) {
					let data = ''
					entry.pipe(new Writable({
						write(chunk, _, next) {
							data += chunk.toString()
							next()
						},
						final() {
							entries.push({ path: entry.path, data })
						},
					}))
				} else {
					entry.resume()
				}
			})
			.on('end', () => {
				res(entries)
			})
	})
}
