import * as vscode from 'vscode';
import { Disposable } from './dispose';
import * as nbt from '@webmc/nbt';

interface NbtDocumentDelegate {
    getFileData(): Promise<NbtFile>;
}

export type SimpleNbtFile = {
    gzipped: boolean,
    data: nbt.NamedNbtTag
}

export type AnvilNbtFile = {
    chunks: nbt.NbtChunk[]
}

export type NbtFile = {
    anvil: false
} & SimpleNbtFile | {
    anvil: true
} & AnvilNbtFile


export class NbtDocument extends Disposable implements vscode.CustomDocument {

    static async create(
        uri: vscode.Uri,
        backupId: string | undefined,
        delegate: NbtDocumentDelegate,
    ): Promise<NbtDocument | PromiseLike<NbtDocument>> {
        const dataFile = typeof backupId === 'string' ? vscode.Uri.parse(backupId) : uri;
        const fileData = await NbtDocument.readFile(dataFile);
        return new NbtDocument(uri, fileData, delegate);
    }

    private static async readFile(uri: vscode.Uri): Promise<NbtFile> {
        let array = await vscode.workspace.fs.readFile(uri);

        if (uri.fsPath.endsWith('.mca')) {
            return {
                anvil: true,
                chunks: nbt.readRegionHeader(array)
            }
        }

        const { compressed, result } = nbt.read(array)
        return {
            anvil: false,
            gzipped: compressed,
            data: result
        }
    }


    private readonly _uri: vscode.Uri;

    private _documentData: NbtFile;

    private _isStructure: boolean;

    private readonly _delegate: NbtDocumentDelegate;

    private constructor(
        uri: vscode.Uri,
        initialContent: NbtFile,
        delegate: NbtDocumentDelegate
    ) {
        super();
        this._uri = uri;
        this._documentData = initialContent;
        this._isStructure = this.isStructureData()
        this._delegate = delegate;
    }

    public get uri() { return this._uri; }

    public get documentData() { return this._documentData; }

    public get isStructure() { return this._isStructure; }

    private readonly _onDidDispose = this._register(new vscode.EventEmitter<void>());
    public readonly onDidDispose = this._onDidDispose.event;

    private readonly _onDidChangeDocument = this._register(new vscode.EventEmitter<{
        content: NbtFile
    }>());
    public readonly onDidChangeContent = this._onDidChangeDocument.event;

    private readonly _onDidChange = this._register(new vscode.EventEmitter());
    public readonly onDidChange = this._onDidChange.event;

    dispose(): void {
        this._onDidDispose.fire();
        super.dispose();
    }

    public isStructureData() {
        if (this._documentData.anvil) return false
        const root = this._documentData.data.value
        return root['size']?.type === 'list'
            && root['size'].value.type === 'int'
            && root['size'].value.value.length === 3
            && root['blocks']?.type === 'list'
            && root['palette']?.type === 'list'
    }

    async getChunkData(index: number): Promise<nbt.NbtChunk> {
        if (!this._documentData.anvil) {
            throw new Error('File is not a region file');
        }

        const chunks = this._documentData.chunks;
        return nbt.readChunk(chunks, chunks[index].x, chunks[index].z)
    }

    markDirty() {
        this._onDidChange.fire({
            label: 'edit'
        });
    }

    async save(cancellation: vscode.CancellationToken): Promise<void> {
        await this.saveAs(this.uri, cancellation);
    }

    async saveAs(targetResource: vscode.Uri, cancellation: vscode.CancellationToken): Promise<void> {
        const nbtFile = await this._delegate.getFileData();
        if (cancellation.isCancellationRequested) {
            return;
        }
        if (nbtFile.anvil) {
            vscode.window.showWarningMessage('Saving region files is not supported.')
            return
        }
        const fileData = new Uint8Array(nbt.write(nbtFile.data, nbtFile.gzipped))
        await vscode.workspace.fs.writeFile(targetResource, fileData);
    }

    async revert(_cancellation: vscode.CancellationToken): Promise<void> {
        const diskContent = await NbtDocument.readFile(this.uri);
        this._documentData = diskContent;
        this._onDidChangeDocument.fire({
            content: diskContent
        });
    }

    async backup(destination: vscode.Uri, cancellation: vscode.CancellationToken): Promise<vscode.CustomDocumentBackup> {
        await this.saveAs(destination, cancellation);
        return {
            id: destination.toString(),
            delete: async () => {
                try {
                    await vscode.workspace.fs.delete(destination);
                } catch { }
            }
        };
    }
}
