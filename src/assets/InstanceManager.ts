import * as path from 'path'
import * as vscode from 'vscode'
import type { AssetBundle, MinecraftInstance } from './Types'
import { errorText } from './Types'
import { discoverInstances, inspectInstance } from './Instances'
import { ResourceIndex } from './ResourceIndex'

export class InstanceManager implements vscode.Disposable, vscode.TreeDataProvider<vscode.TreeItem> {
	private readonly index = new ResourceIndex()
	private instance?: MinecraftInstance
	private loading?: Thenable<void>
	private dirty = true
	private epoch = 0
	private readonly watchers: vscode.Disposable[] = []
	private readonly changed = new vscode.EventEmitter<void>()
	readonly onDidChangeResources = this.changed.event
	private readonly treeChanged = new vscode.EventEmitter<vscode.TreeItem | undefined>()
	readonly onDidChangeTreeData = this.treeChanged.event
	private status = 'No instance selected'
	private readonly browserDiagnostics = new Set<string>()
	private reloadTimer?: ReturnType<typeof setTimeout>
	private prompting?: Promise<void>
	async promptForDocument(): Promise<void> {
		const mode = this.config().get<string>('askForInstanceOnOpen', 'always')
		if (mode === 'never' || mode === 'whenMissing' && this.config().get<string>('selectedInstance', '')) return
		if (!this.prompting) this.prompting = this.select(true).catch(error => { void vscode.window.showErrorMessage(`NBT resources: ${errorText(error)}`) }).finally(() => { this.prompting = undefined })
		await this.prompting
	}
	private readonly output = vscode.window.createOutputChannel('NBT Resource Diagnostics')
	constructor(context: vscode.ExtensionContext) {
		context.subscriptions.push(this, this.output, vscode.window.registerTreeDataProvider('nbtResources', this))
		const command = (id: string, action: () => Promise<unknown> | void) => context.subscriptions.push(vscode.commands.registerCommand(`nbtViewer.${id}`, async () => { try { await action() } catch (e) { this.output.appendLine(errorText(e)); vscode.window.showErrorMessage(`NBT resources: ${errorText(e)}`) } }))
		command('selectInstance', () => this.select())
		command('scanMods', () => this.reload())
		command('reloadResources', () => this.reload())
		command('clearCache', async () => { this.index.clear(); this.invalidate(); await this.reload() })
		command('showDiagnostics', () => this.showDiagnostics())
		context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration('nbtViewer')) { this.disposeWatchers(); this.instance = undefined; this.invalidate() } }))
	}
	private config() { return vscode.workspace.getConfiguration('nbtViewer') }
	private invalidate(): void {
		this.epoch++; this.dirty = true
		if (this.reloadTimer) clearTimeout(this.reloadTimer)
		this.reloadTimer = setTimeout(() => { this.changed.fire(); this.treeChanged.fire(undefined) }, 200)
	}
	private disposeWatchers(): void { this.watchers.splice(0).forEach(w => w.dispose()) }
	dispose(): void { if (this.reloadTimer) clearTimeout(this.reloadTimer); this.disposeWatchers(); this.changed.dispose(); this.treeChanged.dispose(); this.index.clear() }
	private async scan(): Promise<MinecraftInstance[]> {
		return vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Finding Minecraft instances' }, async () => {
			const instances = await discoverInstances({ customPaths: this.config().get<string[]>('instancePaths', []), report: s => this.output.appendLine(s) })
			this.output.appendLine(`Discovered ${instances.length} Minecraft instances`)
			return instances
		})
	}
	private async select(direct = false): Promise<void> {
		if (direct) {
			const uris = await vscode.window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true, canSelectMany: false, title: 'Choose the modpack folder for this NBT (the folder containing mods)', openLabel: 'Use this modpack', defaultUri: this.config().get<string>('selectedInstance', '') ? vscode.Uri.file(this.config().get<string>('selectedInstance', '')) : undefined })
			if (!uris?.length) return
			await this.config().update('selectedVersion', '', vscode.ConfigurationTarget.Global)
			await this.config().update('selectedInstance', uris[0].fsPath, vscode.ConfigurationTarget.Global)
			await this.reload()
			return
		}
		const instances = await this.scan()
		const manual = { label: 'Browse for a Minecraft instance…', description: 'Select an instance or .minecraft directory', instance: undefined as MinecraftInstance | undefined }
		const chosen = await vscode.window.showQuickPick([...instances.map(instance => ({ label: instance.name, description: `${instance.launcher} • ${instance.version ?? 'unknown version'} • ${instance.loader}`, detail: instance.directory, instance })), manual], { placeHolder: 'Select the instance that supplies rendering assets' })
		if (!chosen) return
		let directory = chosen.instance?.id
		if (!directory) { const uris = await vscode.window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true, canSelectMany: false, openLabel: 'Select Minecraft instance' }); directory = uris?.[0].fsPath }
		if (!directory) return
		await this.config().update('selectedVersion', chosen.instance?.version ?? '', vscode.ConfigurationTarget.Global)
		await this.config().update('selectedInstance', directory, vscode.ConfigurationTarget.Global)
		await this.reload()
	}
	async reload(): Promise<void> { this.invalidate(); await this.ensure(); this.changed.fire() }
	private async ensure(): Promise<void> {
		if (this.loading) {
			try { await this.loading } catch (error) { if (!this.dirty) throw error }
			if (!this.dirty) return
		}
		const selected = this.config().get<string>('selectedInstance', '')
		if (!selected) { this.index.clear(); this.instance = undefined; this.status = 'Select a Minecraft instance to enable modded assets'; this.dirty = false; this.treeChanged.fire(undefined); return }
		if (!this.dirty) return
		const epoch = this.epoch
		this.loading = vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Indexing Minecraft resources', cancellable: true }, async (progress, token) => {
			this.instance = await inspectInstance(selected, 'Selected', s => this.output.appendLine(s), this.config().get<string>('selectedVersion', ''))
			if (!this.instance) throw new Error('Selected Minecraft directory does not exist')
			this.status = 'Indexing…'; this.treeChanged.fire(undefined)
			await this.index.build(this.instance, this.config().get<string[]>('resourcePacks', []), message => { progress.report({ message }); this.status = message; this.treeChanged.fire(undefined) }, () => token.isCancellationRequested || epoch !== this.epoch)
			this.dirty = epoch !== this.epoch
			this.status = `${this.index.stats.resources} assets indexed`
			this.disposeWatchers()
			this.browserDiagnostics.clear()
			for (const directory of [path.join(this.instance.directory, 'mods'), path.join(this.instance.directory, 'resourcepacks'), path.join(this.instance.directory, 'versions'), ...this.instance.clientJars, ...this.config().get<string[]>('resourcePacks', [])]) {
				const pattern = /\.(zip|jar)$/i.test(directory) ? new vscode.RelativePattern(path.dirname(directory), path.basename(directory)) : new vscode.RelativePattern(directory, '**/*')
				const watcher = vscode.workspace.createFileSystemWatcher(pattern)
				const onChange = () => this.invalidate()
				this.watchers.push(watcher, watcher.onDidChange(onChange), watcher.onDidCreate(onChange), watcher.onDidDelete(onChange))
			}
			const options = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(this.instance.directory, 'options.txt'))
			this.watchers.push(options, options.onDidChange(() => this.invalidate()))
			this.treeChanged.fire(undefined)
		}).then(() => {}, e => { this.status = errorText(e); this.dirty = true; this.treeChanged.fire(undefined); throw e })
		try { await this.loading } finally { this.loading = undefined }
	}
	async bundle(ids: string[], models: string[], textures: string[], cancelled: () => boolean): Promise<AssetBundle> {
		await this.ensure()
		const tint = this.config().get<number[]>('fallbackTint', [1, 1, 1])
		const validTint = tint.length === 3 && tint.every(n => Number.isFinite(n) && n >= 0 && n <= 1) ? tint as [number, number, number] : [1, 1, 1] as [number, number, number]
		const result = await this.index.bundle(ids, validTint, cancelled, models, textures)
		this.treeChanged.fire(undefined)
		return result
	}
	recordDiagnostics(messages: string[]): void {
		for (const s of messages.slice(0, 1000)) {
			const message = s.slice(0, 2048)
			if (this.browserDiagnostics.size < 1000 && !this.browserDiagnostics.has(message)) { this.browserDiagnostics.add(message); this.output.appendLine(message) }
		}
		this.treeChanged.fire(undefined)
	}
	private showDiagnostics(): void {
		this.output.appendLine(JSON.stringify({ selected: this.instance, status: this.status, ...this.index.stats, diagnostics: [...this.index.diagnostics, ...this.browserDiagnostics] }, null, 2)); this.output.show(true)
	}
	getTreeItem(item: vscode.TreeItem): vscode.TreeItem { return item }
	getChildren(): vscode.TreeItem[] {
		const item = (label: string) => new vscode.TreeItem(label)
		return [item(this.status), item(`Instance: ${this.instance?.name ?? this.config().get('selectedInstance', 'None')}`), item(`Minecraft: ${this.instance?.version ?? 'unknown'}`), item(`Loader: ${this.instance?.loader ?? 'unknown'}`), item(`Mods: ${this.instance?.mods.length ?? 0}`), item(`Namespaces: ${this.index.stats.namespaces.join(', ') || 'none'}`), ...(this.instance?.resourcePacks ?? []).map(p => item(`Pack: ${path.basename(p)}`)), ...this.config().get<string[]>('resourcePacks', []).map(p => item(`Override pack: ${path.basename(p)}`)), item(`Cache: ${this.index.stats.cacheEntries} entries, ${(this.index.stats.cacheBytes / 1048576).toFixed(1)} MiB`), item(`Cache hits/misses: ${this.index.stats.hits}/${this.index.stats.misses}`), ...[...this.index.diagnostics, ...this.browserDiagnostics].slice(0, 100).map(item)]
	}
}
