import * as path from 'path';
import * as vscode from 'vscode';
import { disposeAll } from './dispose';
import { NbtDocument, NbtFile } from './NbtDocument';
import { getNonce } from './util';
import { WebviewCollection } from './WebviewCollection';

export class Structure3DProvider implements vscode.CustomEditorProvider<NbtDocument> {

    public static register(context: vscode.ExtensionContext): vscode.Disposable {
        return vscode.window.registerCustomEditorProvider(
            'nbtEditor.structure3D',
            new Structure3DProvider(context),
            {
                webviewOptions: {
                    retainContextWhenHidden: true
                },
                supportsMultipleEditorsPerDocument: false,
            });
    }

    private readonly webviews = new WebviewCollection();

    constructor(
        private readonly _context: vscode.ExtensionContext
    ) { }

    //#region CustomEditorProvider

    async openCustomDocument(
        uri: vscode.Uri,
        openContext: { backupId?: string },
        _token: vscode.CancellationToken
    ): Promise<NbtDocument> {
        const document: NbtDocument = await NbtDocument.create(uri, openContext.backupId, {
            getFileData: async () => {
                const webviewsForDocument = Array.from(this.webviews.get(document.uri));
                if (!webviewsForDocument.length) {
                    throw new Error('Could not find webview to save for');
                }
                const panel = webviewsForDocument[0];
                const response = await this.postMessageWithResponse<NbtFile>(panel, 'getFileData', {});
                return response;
            }
        });

        const listeners: vscode.Disposable[] = [];

        listeners.push(document.onDidChange(e => {
            this._onDidChangeCustomDocument.fire({ document });
        }));

        listeners.push(document.onDidChangeContent(e => {
            for (const webviewPanel of this.webviews.get(document.uri)) {
                this.postMessage(webviewPanel, 'update', { content: e.content, });
            }
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
        webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);

        webviewPanel.webview.onDidReceiveMessage(e => this.onMessage(e, document, webviewPanel));
    }

    private readonly _onDidChangeCustomDocument = new vscode.EventEmitter<vscode.CustomDocumentContentChangeEvent <NbtDocument>>();
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

    private getHtmlForWebview(webview: vscode.Webview): string {
        const scriptUri = webview.asWebviewUri(vscode.Uri.file(
            path.join(this._context.extensionPath, 'structure3d', 'out', 'structure3D.js')
        ));
        const styleUri = webview.asWebviewUri(vscode.Uri.file(
            path.join(this._context.extensionPath, 'media', 'structure3D.css')
        ));
        const atlasUrl = webview.asWebviewUri(vscode.Uri.file(
            path.join(this._context.extensionPath, 'media', 'generated', 'atlas.png')
        ))
        const assetsUrl = webview.asWebviewUri(vscode.Uri.file(
            path.join(this._context.extensionPath, 'media', 'generated', 'assets.js')
        ))

        const nonce = getNonce();

        return `
			<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">

				<!--
				Use a content security policy to only allow loading images from https or from our extension directory,
				and only allow scripts that have a specific nonce.
				-->
				<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} blob:; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">

				<meta name="viewport" content="width=device-width, initial-scale=1.0">

                <link href="${styleUri}" rel="stylesheet" />

				<title>NBT Editor</title>
			</head>
            <body>
            
                <canvas class="structure-3d" width="640" height="480"></canvas>
                <img class="block-atlas" nonce="${nonce}" src="${atlasUrl}" alt="">

                <script nonce="${nonce}" src="${assetsUrl}"></script>
                <script nonce="${nonce}" src="${scriptUri}"></script>
			</body>
			</html>`;
    }

	private _requestId = 1;
	private readonly _callbacks = new Map<number, (response: any) => void>();

	private postMessageWithResponse<R = unknown>(panel: vscode.WebviewPanel, type: string, body: any): Promise<R> {
		const requestId = this._requestId++;
		const p = new Promise<R>(resolve => this._callbacks.set(requestId, resolve));
		panel.webview.postMessage({ type, requestId, body });
		return p;
    }

    private postMessage(panel: vscode.WebviewPanel, type: string, body: any): void {
        panel.webview.postMessage({ type, body });
    }

    private broadcastMessage(document: NbtDocument, type: string, body: any): void {
        for (const webviewPanel of this.webviews.get(document.uri)) {
            this.postMessage(webviewPanel, type, body);
        }
    }

    private onMessage(message: any, document: NbtDocument, panel: vscode.WebviewPanel) {
        switch (message.type) {
            case 'ready':
                this.postMessage(panel, 'init', {
                    content: document.documentData
                });
                return;

            case 'dirty':
                document.markDirty();
                return;

            case 'response':
                const callback = this._callbacks.get(message.requestId);
                callback?.(message.body);
                return;
        }
    }
}
