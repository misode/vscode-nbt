import * as path from 'path';
import * as zlib from 'zlib';
import * as vscode from 'vscode';
import { Disposable } from './dispose';

interface Edit {
    readonly data: Uint8Array;
}

export class NbtEditorProvider implements vscode.WebviewCustomEditorProvider, vscode.WebviewCustomEditorEditingDelegate<Edit> {

    public static readonly viewType = 'nbtEditor.nbt';

    private readonly models = new Map<string, NbtModel>();
    private readonly editors = new Map<string, Set<NbtEditor>>();

    private activeEditor?: NbtEditor;

    public readonly editingDelegate?: vscode.WebviewCustomEditorEditingDelegate<Edit> = this;

    public constructor(private readonly extensionPath: string) { }

    public register(): vscode.Disposable {
        return vscode.window.registerWebviewCustomEditorProvider(NbtEditorProvider.viewType, this);
    }

    public async resolveWebviewEditor(resource: vscode.Uri, panel: vscode.WebviewPanel) {
        const model = await this.loadOrCreateModel(resource);
        const editor = new NbtEditor(this.extensionPath, model, resource, panel, {
            onEdit: (edit: Edit) => {
                model.pushEdits([edit]);
                this._onEdit.fire({ resource, edit });
                this.update(resource, editor);
            }
        });

        // Clean up models when there are no editors for them.
        editor.onDispose(() => {
            const entry = this.editors.get(resource.toString());
            if (!entry) {
                return
            }
            entry.delete(editor);
            if (entry.size === 0) {
                this.editors.delete(resource.toString());
                this.models.delete(resource.toString());
            }
        });

        let editorSet = this.editors.get(resource.toString());
        if (!editorSet) {
            editorSet = new Set();
            this.editors.set(resource.toString(), editorSet);
        }
        editorSet.add(editor);
    }

    private async loadOrCreateModel(resource: vscode.Uri): Promise<NbtModel> {
        const existing = this.models.get(resource.toString());
        if (existing) {
            return existing;
        }
        const newModel = await NbtModel.create(resource);
        this.models.set(resource.toString(), newModel);
        return newModel;
    }

    private getModel(resource: vscode.Uri): NbtModel {
        const entry = this.models.get(resource.toString());
        if (!entry) {
            throw new Error('no model');
        }
        return entry;
    }

    public async save(resource: vscode.Uri): Promise<void> {
        const model = this.getModel(resource);

        let pathToWrite = resource;
        if (resource.scheme === 'untitled') {
            pathToWrite = vscode.Uri.file(path.join(vscode.workspace.rootPath!, resource.path));
        }

        await vscode.workspace.fs.writeFile(pathToWrite, Buffer.from(model.getContent()));
    }

    public async saveAs(resource: vscode.Uri, targetResource: vscode.Uri): Promise<void> {
        const model = this.getModel(resource);
        await vscode.workspace.fs.writeFile(targetResource, Buffer.from(model.getContent()));
    }

    private readonly _onEdit = new vscode.EventEmitter<{ readonly resource: vscode.Uri, readonly edit: Edit }>();
    public readonly onEdit = this._onEdit.event;

    async applyEdits(resource: vscode.Uri, edits: readonly any[]): Promise<void> {
        const model = this.getModel(resource);
        model.pushEdits(edits);
        this.update(resource);
    }

    async undoEdits(resource: vscode.Uri, edits: readonly any[]): Promise<void> {
        const model = this.getModel(resource);
        model.popEdits(edits);
        this.update(resource);
    }

    private update(resource: vscode.Uri, trigger?: NbtEditor) {
        const editors = this.editors.get(resource.toString());
        if (!editors) {
            throw new Error(`No editors found for ${resource.toString()}`);
        }
        for (const editor of editors) {
            if (editor !== trigger) {
                editor.update();
            }
        }
    }
}

export class NbtModel {
    private readonly _edits: Edit[] = [];

    public static async create(resource: vscode.Uri): Promise<NbtModel> {
        const buffer = await vscode.workspace.fs.readFile(resource);

        // Detect whether the file is gzipped
        // See: https://gist.github.com/winny-/6043044#file-mc_change_spawn-py-L50-L56
        const gzipped = Buffer.from(buffer.slice(0, 2)).toString('hex') === '1f8b';
        if (gzipped) {
            return new NbtModel(await this.gunzip(buffer));
        } else {
            return new NbtModel(buffer);
        }
    }

    private constructor(private readonly initialValue: Uint8Array) { }

    static gzip(input: zlib.InputType): Promise<Buffer> {
        const promise = new Promise<Buffer>(function(resolve, reject) {
            zlib.gzip(input, (error: Error | null, result: Buffer) => {
                if(!error) resolve(result);
                else reject(error);
            });
        });
        return promise;
    }
    
    static gunzip(input: zlib.InputType): Promise<Buffer> {
        const promise = new Promise<Buffer>(function(resolve, reject) {
            zlib.gunzip(input, (error: Error | null, result: Buffer) => {
                if(!error) resolve(result);
                else reject(error);
            });
        });
        return promise;
    }

    public pushEdits(edits: readonly Edit[]): void {
        this._edits.push(...edits);
    }

    public popEdits(edits: readonly Edit[]): void {
        for (let i = 0; i < edits.length; ++i) {
            this._edits.pop();
        }
    }

    public getContent() {
        return this._edits.length ? this._edits[this._edits.length - 1].data : this.initialValue;
    }
}

export class NbtEditor extends Disposable {

    public static readonly viewType = 'nbtEditor.nbt';

    private readonly _onEdit = new vscode.EventEmitter<Edit>();
    public readonly onEdit = this._onEdit.event;

    public readonly _onDispose = this._register(new vscode.EventEmitter<void>());
    public readonly onDispose = this._onDispose.event;

    constructor(
        private readonly _extensionPath: string,
        private readonly model: NbtModel,
        private readonly uri: vscode.Uri,
        private readonly panel: vscode.WebviewPanel,
        private readonly delegate: {
            onEdit: (edit: Edit) => void
        }
    ) {
        super()

        panel.webview.options = {
            enableScripts: true,
        }
        panel.webview.html = this.html

        panel.webview.onDidReceiveMessage(message => {
            switch (message.type) {
                case 'stroke':
                    const edit: Edit = { data: new Uint8Array(message.value.data.data) }
                    this.delegate.onEdit(edit)
                    break
            }
        })
        this._register(panel.onDidDispose(() => { this.dispose() }))

        this.update()
        this.setInitialContent()
    }

    public dispose() {
        if (this.isDisposed) {
            return
        }

        this._onDispose.fire()
        super.dispose()
    }

    private async setInitialContent(): Promise<void> {
        setTimeout(() => {
            this.panel.webview.postMessage({
                type: 'init',
                value: this.panel.webview.asWebviewUri(this.uri).toString()
            });
        }, 100);
    }

    private get html() {
        const content = this.model.getContent();
        return /* html */`<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <meta http-equiv="X-UA-Compatible" content="ie=edge">
            <title>Document</title>
        </head>
        <body>
            <h3>NBT Editor</h3>
            <textarea style="width: 500px; height: 300px;">${Buffer.from(content).toString('hex')}</textarea>
        </body>
        </html>`
    }

    public async update() {
        if (this.isDisposed) {
            return
        }

        this.panel.webview.postMessage({
            type: 'setValue'
        })
    }
}