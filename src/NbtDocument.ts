import * as vscode from 'vscode';
import { Disposable } from './dispose';
import { hasGzipHeader, isRegionFile, zlibUnzip } from './util';
const {gzip, ungzip} = require('node-gzip');
const nbt = require('nbt')

interface NbtDocumentDelegate {
    getFileData(): Promise<NbtFile>;
}

export type SimpleNbtFile = {
    gzipped: boolean,
    data: NamedNbtCompound
}

export type AnvilNbtFile = {
    chunks: NbtChunk[]
}

export type NbtFile = {
    anvil: false
} & SimpleNbtFile | {
    anvil: true
} & AnvilNbtFile

export type NbtChunk = {
    x: number,
    z: number,
    timestamp: Uint8Array,
    compression: number,
    loaded: boolean
    data?: Uint8Array | NamedNbtCompound
}

type NamedNbtCompound = {
    name: string,
    value: any
}

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

        if (isRegionFile(uri)) {
            const chunks = this.readRegionHeader(array)
            return { anvil: true, chunks }
        }

        const gzipped = hasGzipHeader(array)
        if (gzipped) {
            array = await ungzip(array)
        }

        const data = nbt.parseUncompressed(array)
        return {
            anvil: false,
            gzipped,
            data
        }
    }

    private static readRegionHeader(array: Uint8Array): NbtChunk[] {
        const chunks: NbtChunk[] = [];
        for (let x = 0; x < 32; x += 1) {
            for (let z = 0; z < 32; z += 1) {
                const i = 4 * ((x & 31) + (z & 31) * 32);
                const sectors = array[i + 3];
                if (sectors === 0) continue;

                const offset = (array[i] << 16) + (array[i + 1] << 8) + array[i + 2];
                const timestamp = array.slice(i + 4096, i + 4100);

                const j = offset * 4096;
                const length = (array[j] << 24) + (array[j + 1] << 16) + (array[j + 2] << 8) + array[j + 3] 
                const compression = array[j + 4]
                const data = array.slice(j + 5, j + 4 + length)

                chunks.push({ x, z, timestamp, compression, loaded: false, data });
            }
        }
        return chunks;
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

    async getChunkData(index: number): Promise<NbtChunk> {
        if (!this._documentData.anvil) {
            throw {};
        }

        const chunk = this._documentData.chunks[index];
        if (chunk.loaded) return chunk;

        let data = chunk.data as Uint8Array;
        if (chunk.compression === 1) {
            data = await ungzip(data);
        } else if (chunk.compression === 2) {
            data = await zlibUnzip(data);
        }

        chunk.data = nbt.parseUncompressed(data);
        chunk.loaded = true;
        return chunk;
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
        const buffer = nbt.writeUncompressed(nbtFile.data)
        const fileData = new Uint8Array(nbtFile.gzipped ? await gzip(buffer) : buffer)
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
