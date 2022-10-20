import { NbtRegion } from 'deepslate'
import * as path from 'path'
import * as vscode from 'vscode'
import type { EditorMessage, Logger, ViewMessage } from './common/types'
import { disposeAll } from './dispose'
import { getAssets, mcmetaRoot } from './mcmeta'
import { NbtDocument } from './NbtDocument'
import { WebviewCollection } from './WebviewCollection'

export class NbtEditorProvider implements vscode.CustomEditorProvider<NbtDocument> {

	public static register(context: vscode.ExtensionContext, logger: Logger): vscode.Disposable {
		return vscode.window.registerCustomEditorProvider(
			'nbtEditor.nbt',
			new NbtEditorProvider(context, logger),
			{
				webviewOptions: {
					retainContextWhenHidden: true,
				},
				supportsMultipleEditorsPerDocument: true,
			})
	}

	private readonly webviews = new WebviewCollection()

	constructor(
		private readonly _context: vscode.ExtensionContext,
		private readonly logger: Logger,
	) { }

	//#region CustomEditorProvider

	async openCustomDocument(
		uri: vscode.Uri,
		openContext: vscode.CustomDocumentOpenContext,
		_token: vscode.CancellationToken
	): Promise<NbtDocument> {
		const document: NbtDocument = await NbtDocument.create(uri, openContext.backupId, this.logger)

		const listeners: vscode.Disposable[] = []

		listeners.push(document.onDidChange(e => {
			this._onDidChangeCustomDocument.fire({ document, ...e })
		}))

		listeners.push(document.onDidChangeContent(e => {
			this.broadcastMessage(document, { type: 'update', body: e })
		}))

		document.onDidDispose(() => disposeAll(listeners))

		return document
	}

	async resolveCustomEditor(
		document: NbtDocument,
		webviewPanel: vscode.WebviewPanel,
		_token: vscode.CancellationToken
	): Promise<void> {
		this.webviews.add(document.uri, webviewPanel)

		const assets = await getAssets(document.dataVersion, this.logger)

		webviewPanel.webview.options = {
			enableScripts: true,
			localResourceRoots: [
				vscode.Uri.file(mcmetaRoot),
				vscode.Uri.file(this._context.extensionPath),
			],
		}
		webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview, assets.version, document.isStructure, document.documentData instanceof NbtRegion)

		webviewPanel.webview.onDidReceiveMessage(e => this.onMessage(e, document, webviewPanel))
	}

	private readonly _onDidChangeCustomDocument = new vscode.EventEmitter<vscode.CustomDocumentEditEvent<NbtDocument>>()
	public readonly onDidChangeCustomDocument = this._onDidChangeCustomDocument.event

	public saveCustomDocument(document: NbtDocument, cancellation: vscode.CancellationToken): Thenable<void> {
		return document.save(cancellation)
	}

	public saveCustomDocumentAs(document: NbtDocument, destination: vscode.Uri, cancellation: vscode.CancellationToken): Thenable<void> {
		return document.saveAs(destination, cancellation)
	}

	public revertCustomDocument(document: NbtDocument, cancellation: vscode.CancellationToken): Thenable<void> {
		return document.revert(cancellation)
	}

	public backupCustomDocument(document: NbtDocument, context: vscode.CustomDocumentBackupContext, cancellation: vscode.CancellationToken): Thenable<vscode.CustomDocumentBackup> {
		return document.backup(context.destination, cancellation)
	}

	//#endregion

	private getNonce() {
		let text = ''
		const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
		for (let i = 0; i < 32; i++) {
			text += possible.charAt(Math.floor(Math.random() * possible.length))
		}
		return text
	}

	private getHtmlForWebview(webview: vscode.Webview, version: string, isStructure: boolean, isRegion: boolean): string {
		const uri = (...folders: string[]) => webview.asWebviewUri(vscode.Uri.file(
			path.join(this._context.extensionPath, ...folders)
		))
		const scriptUri = uri('out', 'editor.js')
		const styleUri = uri('res', 'editor.css')
		const codiconsUri = uri('node_modules', 'vscode-codicons', 'dist', 'codicon.css')

		const mcmetaUri = (id: string) => webview.asWebviewUri(vscode.Uri.file(
			path.join(mcmetaRoot, `${version}-${id}`)
		))

		// const blocksUrl = mcmetaUri('blocks')
		const assetsUrl = mcmetaUri('assets')
		const uvmappingUrl = mcmetaUri('uvmapping')
		const blocksUrl = mcmetaUri('blocks')
		const atlasUrl = mcmetaUri('atlas')

		const nonce = this.getNonce()

		return `
			<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">

				<!--
				Use a content security policy to only allow loading images from https or from our extension directory,
				and only allow scripts that have a specific nonce.
				-->
				<meta http-equiv="Content-Security-Policy" content="default-src 'none'; font-src ${webview.cspSource}; img-src ${webview.cspSource} blob:; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">

				<meta name="viewport" content="width=device-width, initial-scale=1.0">

				<link href="${codiconsUri}" rel="stylesheet" />
				<link href="${styleUri}" rel="stylesheet" />

				<title>NBT Editor</title>
			</head>
				<body>
					${isRegion ? `
					<div class="region-menu">
						<div class="btn map-toggle">Map</div>
						Select Chunk:
						<label for="chunk-x">X</label>
						<input id="chunk-x" type="number">
						<label for="chunk-z">Z</label>
						<input id="chunk-z" type="number">
					</div>
					` : ''}
					<div class="panel-menu"></div>
					<div class="find-widget">
						<div class="button replace-expand codicon codicon-chevron-right" 	title="Toggle Replace mode"></div>
						<div class="find-part">
							<div class="type-select"><select></select></div>
							<input class="name-input" placeholder="Find Name">
							<input class="value-input" placeholder="Find Value">
							<div class="matches">No results</div>
							<div class="button previous-match disabled" title="Previous match (Shif+Enter)">
								<i class="codicon codicon-arrow-up"></i>
							</div>
							<div class="button next-match disabled" title="Next match (Enter)">
								<i class="codicon codicon-arrow-down"></i>
							</div>
							<div class="button close-widget" title="Close (Escape)">
								<i class="codicon codicon-close"></i>
							</div>
						</div>
						<div class="replace-part">
							<div class="type-select"><select></select></div>
							<input class="name-input" placeholder="Replace Name">
							<input class="value-input" placeholder="Replace Value">
							<div class="button replace disabled" title="Replace (Enter)">
								<i class="codicon codicon-replace"></i>
							</div>
							<div class="button replace-all disabled" title="Replace All (Ctrl+Alt+Enter">
								<i class="codicon codicon-replace-all"></i>
							</div>
						</div>
					</div>
					<div class="nbt-editor"></div>
					<div class="file-info"></div>
							
					${isStructure || isRegion ? `
						<img class="texture-atlas" nonce="${nonce}" src="${atlasUrl}" alt="">
						<script nonce="${nonce}" src="${assetsUrl}"></script>
						<script nonce="${nonce}" src="${uvmappingUrl}"></script>
						<script nonce="${nonce}" src="${blocksUrl}"></script>
					` : ''}

					<script nonce="${nonce}" src="${scriptUri}"></script>
				</body>
			</html>`
	}

	private postMessage(panel: vscode.WebviewPanel, message: ViewMessage): void {
		panel.webview.postMessage(message)
	}

	private broadcastMessage(document: NbtDocument, message: ViewMessage): void {
		for (const webviewPanel of this.webviews.get(document.uri)) {
			this.postMessage(webviewPanel, message)
		}
	}

	private onMessage(message: EditorMessage, document: NbtDocument, panel: vscode.WebviewPanel) {
		switch (message.type) {
			case 'ready':
				this.postMessage(panel, {
					type: 'init',
					body: {
						type: document.documentData instanceof NbtRegion ? 'region' :
							document.isStructure ? 'structure' : document.isMap ? 'map' : 'default',
						readOnly: document.isReadOnly,
						content: document.documentData instanceof NbtRegion
							? { chunks: document.documentData.map(c => ({ x: c.x, z: c.z, size: c.getRaw().length })) }
							: document.documentData.toJson(),
					},
				})
				return

			case 'edit':
				try {
					document.makeEdit(message.body)
				} catch (e) {
					vscode.window.showErrorMessage(`Failed to apply edit: ${e.message}`)
				}
				return

			case 'getChunkData':
				document.getChunkData(message.body.x, message.body.z).then(chunk => {
					this.postMessage(panel, {
						type: 'response',
						requestId: message.requestId,
						body: chunk.getRoot().toJson(),
					})
				})
				return

			case 'error':
				this.logger.error(message.body)
				vscode.window.showErrorMessage(`Error in webview: ${message.body}`)
				return
		}
	}
}
