import { promises as fs } from 'fs'
import * as os from 'os'
import * as path from 'path'
import * as yauzl from 'yauzl'
import type { MinecraftInstance } from './Types'
import { errorText } from './Types'

export interface DiscoveryOptions { platform?: NodeJS.Platform, home?: string, env?: NodeJS.ProcessEnv, customPaths?: string[], report?: (message: string) => void }
export interface LauncherRoot { launcher: string, directory: string }
export function launcherRoots(options: DiscoveryOptions = {}): LauncherRoot[] {
	const platform = options.platform ?? process.platform
	const p = platform === 'win32' ? path.win32 : path.posix
	const home = options.home ?? os.homedir()
	const env = options.env ?? process.env
	const roaming = env.APPDATA ?? p.join(home, 'AppData', 'Roaming')
	const local = env.LOCALAPPDATA ?? p.join(home, 'AppData', 'Local')
	const data = platform === 'win32' ? roaming : platform === 'darwin' ? p.join(home, 'Library', 'Application Support') : env.XDG_DATA_HOME ?? p.join(home, '.local', 'share')
	const roots: [string, string][] = [
		['Official Launcher', platform === 'win32' ? p.join(roaming, '.minecraft') : platform === 'darwin' ? p.join(data, 'minecraft') : p.join(home, '.minecraft')],
		['Prism Launcher', p.join(data, 'PrismLauncher', 'instances')],
		['MultiMC', p.join(data, 'MultiMC', 'instances')],
		['ATLauncher', p.join(data, 'ATLauncher', 'instances')],
		['Modrinth App', p.join(data, 'com.modrinth.theseus', 'profiles')],
		['GDLauncher', p.join(data, 'gdlauncher_next', 'instances')],
		['GDLauncher', p.join(data, 'gdlauncher', 'instances')],
		['GDLauncher', p.join(data, 'gdlauncher_carbon', 'data', 'instances')],
		['CurseForge', p.join(home, 'curseforge', 'minecraft', 'Instances')],
		['CurseForge', p.join(home, 'Documents', 'Curse', 'Minecraft', 'Instances')],
	]
	if (platform === 'win32') roots.push(['CurseForge', p.join(local, 'CurseForge', 'Minecraft', 'Instances')], ['Modrinth App', p.join(roaming, 'ModrinthApp', 'profiles')])
	if (platform === 'linux') roots.push(['Prism Launcher', p.join(home, '.var', 'app', 'org.prismlauncher.PrismLauncher', 'data', 'PrismLauncher', 'instances')], ['ATLauncher', p.join(home, '.var', 'app', 'com.atlauncher.ATLauncher', 'data', 'ATLauncher', 'instances')])
	for (const directory of options.customPaths ?? []) roots.push(['Custom', directory])
	return roots.map(([launcher, directory]) => ({ launcher, directory }))
}

async function exists(directory: string): Promise<boolean> { try { return (await fs.stat(directory)).isDirectory() } catch { return false } }
async function json(file: string, report: (s: string) => void): Promise<Record<string, unknown>> {
	try { if ((await fs.stat(file)).size > 2 * 1024 * 1024) throw new Error('Metadata exceeds 2 MiB'); return JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, unknown> } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') report(`${file}: ${errorText(e)}`); return {} }
}
async function files(directory: string, suffix?: string): Promise<string[]> {
	try { return (await fs.readdir(directory, { withFileTypes: true })).filter(e => !e.isSymbolicLink() && (suffix ? e.isFile() && e.name.endsWith(suffix) : e.isDirectory() || e.isFile() && /\.(zip|jar)$/i.test(e.name))).map(e => path.join(directory, e.name)).sort() } catch { return [] }
}

async function modLoader(jar: string): Promise<string[]> {
	return new Promise(resolve => yauzl.open(jar, { lazyEntries: true }, (error, archive) => {
		if (error || !archive) { resolve([]); return }
		const loaders = new Set<string>()
		let count = 0
		archive.on('error', () => { archive.close(); resolve([...loaders]) })
		archive.on('end', () => resolve([...loaders]))
		archive.on('entry', (entry: yauzl.Entry) => {
			if (++count > 250000) { archive.close(); resolve([...loaders]); return }
			const loader = ({ 'fabric.mod.json': 'fabric', 'quilt.mod.json': 'quilt', 'META-INF/mods.toml': 'forge', 'META-INF/neoforge.mods.toml': 'neoforge' } as Record<string, string>)[entry.fileName]
			if (loader) loaders.add(loader)
			archive.readEntry()
		})
		archive.readEntry()
	}))
}

export async function inspectInstance(directory: string, launcher = 'Custom', report: (s: string) => void = () => {}, selectedVersion?: string): Promise<MinecraftInstance | undefined> {
	const original = path.resolve(directory)
	for (const sub of ['.minecraft', 'minecraft']) { if (await exists(path.join(directory, sub))) { directory = path.join(directory, sub); break } }
	if (!await exists(directory)) return undefined
	const mods = await files(path.join(directory, 'mods'), '.jar')
	const pack = await json(path.join(original, 'mmc-pack.json'), report)
	const curse = await json(path.join(original, 'minecraftinstance.json'), report)
	const profile = await json(path.join(original, 'profile.json'), report)
	const manifest = await json(path.join(original, 'manifest.json'), report)
	const gd = await json(path.join(original, 'instance.json'), report)
	const components = Array.isArray(pack.components) ? pack.components as Record<string, unknown>[] : []
	const metadata = JSON.stringify({ components, curse, profile, manifest, gd }).toLowerCase()
	let loader = ['neoforge', 'quilt', 'fabric', 'forge'].find(l => metadata.includes(l)) ?? 'Vanilla / unknown'
	const mc = components.find(c => c.uid === 'net.minecraft')
	const minecraft = manifest.minecraft as Record<string, unknown> | undefined
	const baseLoader = curse.baseModLoader as Record<string, unknown> | undefined
	let version = selectedVersion || String(mc?.version ?? curse.gameVersion ?? minecraft?.version ?? baseLoader?.minecraftVersion ?? profile.game_version ?? gd.minecraftVersion ?? '') || undefined
	const clientJars: string[] = []
	const versionDirs = await files(path.join(directory, 'versions'))
	const versionRoots = [path.join(directory, 'versions'), path.join(path.dirname(path.dirname(original)), 'versions'), path.join(path.dirname(path.dirname(original)), 'libraries', 'com', 'mojang', 'minecraft')]
	if (versionDirs.length && !version) {
		const profiles = await json(path.join(directory, 'launcher_profiles.json'), report)
		const entries = Object.values((profiles.profiles ?? {}) as Record<string, Record<string, unknown>>)
		version = entries.map(e => e.lastVersionId).find(v => typeof v === 'string' && !v.startsWith('latest')) as string | undefined
	}
	if (version) for (const root of versionRoots) {
		const v = await json(path.join(root, version, `${version}.json`), report)
		if (v.inheritsFrom && typeof v.inheritsFrom === 'string') { const parent = path.join(root, v.inheritsFrom, `${v.inheritsFrom}.jar`); try { if ((await fs.stat(parent)).isFile()) clientJars.push(parent) } catch { /* optional archive */ } }
		const jar = path.join(root, version, `${version}.jar`)
		try { if ((await fs.stat(jar)).isFile()) clientJars.push(jar) } catch { /* mcmeta supplies vanilla if no client archive */ }
	}
	if (loader === 'Vanilla / unknown' && mods.length) {
		const found = new Set<string>()
		for (const jar of mods) { for (const value of await modLoader(jar)) found.add(value); if (found.size > 1) break }
		loader = found.size === 1 ? [...found][0] : found.size > 1 ? `Unknown (mod metadata: ${[...found].join(', ')})` : loader
	}
	let resourcePacks: string[] = []
	const available = await files(path.join(directory, 'resourcepacks'))
	try {
		const options = await fs.readFile(path.join(directory, 'options.txt'), 'utf8')
		const value = options.split(/\r?\n/).find(l => l.startsWith('resourcePacks:'))?.slice('resourcePacks:'.length)
		if (value) { const enabled: unknown = JSON.parse(value); if (Array.isArray(enabled)) resourcePacks = enabled.flatMap(id => typeof id === 'string' ? available.filter(file => path.basename(file) === id.replace(/^file\//, '')) : []) }
	} catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') report(`Resource pack selection: ${errorText(e)}`) }
	return { id: original, name: String(profile.name ?? curse.name ?? path.basename(original)), launcher, directory: path.resolve(directory), version, loader, mods, resourcePacks, clientJars: [...new Set(clientJars)] }
}

export async function discoverInstances(options: DiscoveryOptions = {}): Promise<MinecraftInstance[]> {
	const result = new Map<string, MinecraftInstance>()
	for (const root of launcherRoots(options)) {
		if (!await exists(root.directory)) continue
		const candidates = root.launcher === 'Official Launcher' || await exists(path.join(root.directory, 'mods')) || await exists(path.join(root.directory, 'minecraft')) || await exists(path.join(root.directory, '.minecraft')) ? [root.directory] : await files(root.directory)
		for (const candidate of candidates) {
			const instance = await inspectInstance(candidate, root.launcher, options.report)
			if (instance) result.set(instance.directory, instance)
		}
		if (root.launcher === 'Official Launcher') {
			const profiles = await json(path.join(root.directory, 'launcher_profiles.json'), options.report ?? (() => {}))
			for (const profile of Object.values((profiles.profiles ?? {}) as Record<string, Record<string, unknown>>)) {
				const directory = typeof profile.gameDir === 'string' ? profile.gameDir : root.directory
				const version = typeof profile.lastVersionId === 'string' && !profile.lastVersionId.startsWith('latest') ? profile.lastVersionId : undefined
				const instance = await inspectInstance(directory, root.launcher, options.report, version)
				if (instance) { instance.name = typeof profile.name === 'string' ? profile.name : instance.name; result.set(`${instance.directory}|${instance.version ?? ''}`, instance) }
			}
		}
	}
	return [...result.values()]
}
