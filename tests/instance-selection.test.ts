import assert from 'node:assert/strict'
import { test } from 'node:test'
import Module from 'node:module'
import type * as vscode from 'vscode'
import type { InstanceManager } from '../src/assets/InstanceManager'

test('opening documents reuses persisted workspace packs, isolates workspaces, and respects prompt settings', async () => {
	const settings = new Map<string, unknown>()
	const workspaceSettings = new Map<string, unknown>()
	let prompts = 0
	let chosen: string | undefined = '/packs/first'
	const disposable = { dispose() {} }
	const config = {
		get: (key: string, fallback: unknown) => workspaceSettings.get(key) ?? settings.get(key) ?? fallback,
		inspect: (key: string) => ({ workspaceValue: workspaceSettings.get(key) }),
		update: async (key: string, value: unknown, target: number) => { (target === 2 ? workspaceSettings : settings).set(key, value) },
	}
	const host = {
		EventEmitter: class { event = () => disposable; fire() {}; dispose() {} },
		ConfigurationTarget: { Global: 1, Workspace: 2 },
		Uri: { file: (fsPath: string) => ({ fsPath }) },
		window: {
			createOutputChannel: () => ({ ...disposable, appendLine() {} }),
			registerTreeDataProvider: () => disposable,
			showOpenDialog: async () => { prompts++; return chosen ? [{ fsPath: chosen }] : undefined },
			showErrorMessage: (message: string) => { throw new Error(message) },
		},
		commands: { registerCommand: () => disposable },
		workspace: { workspaceFolders: [{}], getConfiguration: () => config, onDidChangeConfiguration: () => disposable },
	}
	const modules = Module as unknown as { _load: (request: string, ...args: unknown[]) => unknown }
	const original = modules._load
	modules._load = (request, ...args) => request === 'vscode' ? host : original.call(Module, request, ...args)
	let Manager: typeof InstanceManager
	try { Manager = require('../src/assets/InstanceManager').InstanceManager } finally { modules._load = original }
	const context = () => {
		const state = new Map<string, unknown>()
		return { subscriptions: [], workspaceState: { get: (key: string) => state.get(key), update: async (key: string, value: unknown) => { state.set(key, value) } } } as unknown as vscode.ExtensionContext
	}
	const open = (ctx: vscode.ExtensionContext) => {
		const manager = new Manager(ctx)
		manager.reload = async () => {}
		return manager
	}
	const first = context()
	let manager = open(first)
	await manager.promptForDocument()
	assert.equal(prompts, 1)
	assert.deepEqual(first.workspaceState.get('nbtViewer.instance'), { directory: '/packs/first', version: '' })
	assert.equal(settings.has('selectedInstance'), false, 'workspace choice must not change other workspaces')
	await manager.promptForDocument(); assert.equal(prompts, 1)
	manager.dispose(); manager = open(first)
	await manager.promptForDocument(); assert.equal(prompts, 1, 'selection survives a new extension session')
	const other = open(context()); chosen = '/packs/second'
	await other.promptForDocument(); assert.equal(prompts, 2)
	await manager.promptForDocument(); assert.equal(prompts, 2)
	settings.set('askForInstanceOnOpen', 'always'); chosen = undefined
	await manager.promptForDocument(); assert.equal(prompts, 3)
	assert.deepEqual(first.workspaceState.get('nbtViewer.instance'), { directory: '/packs/first', version: '' }, 'cancel retains the saved pack')
	settings.set('askForInstanceOnOpen', 'never')
	const empty = open(context()); await empty.promptForDocument(); assert.equal(prompts, 3)
	settings.delete('askForInstanceOnOpen'); workspaceSettings.set('selectedInstance', '/packs/configured')
	await empty.promptForDocument(); assert.equal(prompts, 3, 'preselected workspace setting is reused')
	settings.set('askForInstanceOnOpen', 'always'); chosen = '/packs/switched'
	await manager.promptForDocument()
	assert.equal(workspaceSettings.get('selectedInstance'), '/packs/switched', 'manual switch updates an explicit workspace setting')
	assert.deepEqual(first.workspaceState.get('nbtViewer.instance'), { directory: '/packs/switched', version: '' })
	settings.delete('askForInstanceOnOpen')
	workspaceSettings.clear(); settings.set('selectedInstance', '/packs/legacy')
	await empty.promptForDocument(); assert.equal(prompts, 4, 'legacy user selection remains usable')
	host.workspace.workspaceFolders = []; settings.delete('selectedInstance'); chosen = '/packs/standalone'
	const standalone = open(context()); await standalone.promptForDocument()
	assert.equal(settings.get('selectedInstance'), '/packs/standalone', 'standalone files use user settings')
	await standalone.promptForDocument(); assert.equal(prompts, 5)
	manager.dispose(); other.dispose(); empty.dispose(); standalone.dispose()
})
