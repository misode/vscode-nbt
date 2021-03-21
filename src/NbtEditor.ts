import { NbtChunk } from '@webmc/nbt';
import * as path from 'path';
import * as vscode from 'vscode';
import { disposeAll } from './dispose';
import { NbtDocument } from './NbtDocument';
import { EditorMessage, ViewMessage } from './common/types';
import { WebviewCollection } from './WebviewCollection';

export class NbtEditorProvider implements vscode.CustomEditorProvider<NbtDocument> {

    public static register(context: vscode.ExtensionContext): vscode.Disposable {
        return vscode.window.registerCustomEditorProvider(
            'nbtEditor.nbt',
            new NbtEditorProvider(context),
            {
                webviewOptions: {
                    retainContextWhenHidden: true
                },
                supportsMultipleEditorsPerDocument: true,
            });
    }

    private readonly webviews = new WebviewCollection();

    constructor(
        private readonly _context: vscode.ExtensionContext
    ) { }

    //#region CustomEditorProvider

    async openCustomDocument(
        uri: vscode.Uri,
        openContext: vscode.CustomDocumentOpenContext,
        _token: vscode.CancellationToken
    ): Promise<NbtDocument> {
        const document: NbtDocument = await NbtDocument.create(uri, openContext.backupId);

        const listeners: vscode.Disposable[] = [];

        listeners.push(document.onDidChange(e => {
            this._onDidChangeCustomDocument.fire({ document, ...e });
        }));

        listeners.push(document.onDidChangeContent(e => {
            this.broadcastMessage(document, { type: 'update', body: e })
        }));

        document.onDidDispose(() => disposeAll(listeners));

        return document;
    }

    async resolveCustomEditor(
        document: NbtDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): Promise<void> {
        this.webviews.add(document.uri, webviewPanel);

        webviewPanel.webview.options = {
            enableScripts: true,
        };
        webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview, document.isStructure);

        webviewPanel.webview.onDidReceiveMessage(e => this.onMessage(e, document, webviewPanel));
    }

    private readonly _onDidChangeCustomDocument = new vscode.EventEmitter<vscode.CustomDocumentEditEvent<NbtDocument>>();
    public readonly onDidChangeCustomDocument = this._onDidChangeCustomDocument.event;

    public saveCustomDocument(document: NbtDocument, cancellation: vscode.CancellationToken): Thenable<void> {
        return document.save(cancellation);
    }

    public saveCustomDocumentAs(document: NbtDocument, destination: vscode.Uri, cancellation: vscode.CancellationToken): Thenable<void> {
        return document.saveAs(destination, cancellation);
    }

    public revertCustomDocument(document: NbtDocument, cancellation: vscode.CancellationToken): Thenable<void> {
        return document.revert(cancellation);
    }

    public backupCustomDocument(document: NbtDocument, context: vscode.CustomDocumentBackupContext, cancellation: vscode.CancellationToken): Thenable<vscode.CustomDocumentBackup> {
        return document.backup(context.destination, cancellation);
    }

    //#endregion

    private getNonce() {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }

    private getHtmlForWebview(webview: vscode.Webview, isStructure: boolean): string {
        const uri = (...folders: string[]) => webview.asWebviewUri(vscode.Uri.file(
            path.join(this._context.extensionPath, 'editor', ...folders)
        ));
        const scriptUri = uri('out', 'editor.js');
        const styleUri = uri('res', 'editor.css');
        const atlasUrl = uri('res', 'generated', 'atlas.png');
        const assetsUrl = uri('res', 'generated', 'assets.js');
		const codiconsUri = uri('node_modules', 'vscode-codicons', 'dist', 'codicon.css');
		const codiconsFontUri =uri('node_modules', 'vscode-codicons', 'dist', 'codicon.ttf');

        const nonce = this.getNonce();

        return `
			<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">

				<!--
				Use a content security policy to only allow loading images from https or from our extension directory,
				and only allow scripts that have a specific nonce.
				-->
				<meta http-equiv="Content-Security-Policy" content="default-src 'none'; font-src ${codiconsFontUri}; img-src ${webview.cspSource} blob:; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">

				<meta name="viewport" content="width=device-width, initial-scale=1.0">

				<link href="${styleUri}" rel="stylesheet" />
				<link href="${codiconsUri}" rel="stylesheet" />

				<title>NBT Editor</title>
			</head>
            <body>
                <div class="nbt-editor"></div>
                <div class="panel-menu"></div>
                <div class="find-widget">
                    <div class="type-select"><select></select></div>
                    <input class="name-input" placeholder="Name">
                    <input class="value-input" placeholder="Value">
                    <div class="matches">No results</div>
                    <div class="button previous-match" title="Previous match (Shift+Enter)">
                        <i class="codicon codicon-arrow-up"></i>
                    </div>
                    <div class="button next-match" title="Next match (Enter)">
                        <i class="codicon codicon-arrow-down"></i>
                    </div>
                    <div class="button close-widget" title="Close (Escape)">
                        <i class="codicon codicon-close"></i>
                    </div>
                </div>

                ${isStructure ? `
                    <img class="block-atlas" nonce="${nonce}" src="${atlasUrl}" alt="">
                    <script nonce="${nonce}" src="${assetsUrl}"></script>
                ` : ''}

				<script nonce="${nonce}" src="${scriptUri}"></script>
			</body>
			</html>`;
    }

    private postMessage(panel: vscode.WebviewPanel, message: ViewMessage): void {
        panel.webview.postMessage(message);
    }

    private broadcastMessage(document: NbtDocument, message: ViewMessage): void {
        for (const webviewPanel of this.webviews.get(document.uri)) {
            this.postMessage(webviewPanel, message);
        }
    }

    private onMessage(message: EditorMessage, document: NbtDocument, panel: vscode.WebviewPanel) {
        switch (message.type) {
            case 'ready':
                if (document.documentData.region) {
                    const chunks = document.documentData.chunks
                        .map(c => ({ x: c.x, z: c.z } as NbtChunk))
                    this.postMessage(panel, {
                        type: 'init',
                        body: {
                            type: 'region',
                            readOnly: document.isReadOnly,
                            content: {
                                region: true,
                                chunks: chunks
                            }
                        }                      
                    });
                } else {
                    this.postMessage(panel, {
                        type: 'init',
                        body: {
                            type: document.isStructure ? 'structure' : document.isMap ? 'map' : 'default',
                            readOnly: document.isReadOnly,
                            content: document.documentData
                        }
                    });
                }
                return;

            case 'edit':
                try {
                    document.makeEdit(message.body)
                } catch (e) {
                    vscode.window.showErrorMessage(`Failed to apply edit: ${e.message}`)
                }
                return;

            case 'getChunkData':
                document.getChunkData(message.body.x, message.body.z).then(data => {
                    this.postMessage(panel, { type: 'chunk', body: data } );
                });
                return;

            case 'error':
                vscode.window.showErrorMessage(`Error in webview: ${message.body}`)
                return;
        }
    }
}
