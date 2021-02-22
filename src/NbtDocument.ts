import * as vscode from 'vscode';
import { Disposable } from './dispose';
import * as nbt from '@webmc/nbt';
import { NbtEdit, NbtFile } from './common/types';
import { applyEdit, reverseEdit } from './common/Operations';
import { output } from './extension';

export class NbtDocument extends Disposable implements vscode.CustomDocument {

    static async create(
        uri: vscode.Uri,
        backupId: string | undefined,
    ): Promise<NbtDocument | PromiseLike<NbtDocument>> {
        const dataFile = typeof backupId === 'string' ? vscode.Uri.parse(backupId) : uri;
        output.appendLine(`Creating NBT document [uri=${JSON.stringify(dataFile)}]`)
        const fileData = await NbtDocument.readFile(dataFile);
        return new NbtDocument(uri, fileData);
    }

    private static async readFile(uri: vscode.Uri): Promise<NbtFile> {
        const array = await vscode.workspace.fs.readFile(uri)

        output.appendLine(`Read file [length=${array.length}, scheme=${uri.scheme}, extension=${uri.path.match(/(?:\.([^.]+))?$/)?.[1]}]`)

        if (uri.scheme === 'git' && array.length === 0) {
            return {
                region: false,
                gzipped: false,
                data: { name: '', value: {} }
            }
        }

        if (uri.fsPath.endsWith('.mca')) {
            return {
                region: true,
                chunks: nbt.readRegion(array)
            }
        }

        const littleEndian = uri.fsPath.endsWith('.mcstructure')
        const { compressed, result } = nbt.read(array, littleEndian)

        output.appendLine(`Parsed NBT [compressed=${compressed}]`)

        return {
            region: false,
            gzipped: compressed,
            littleEndian,
            data: result
        }
    }


    private readonly _uri: vscode.Uri;

    private _documentData: NbtFile;
    private _isStructure: boolean;
    private _isReadOnly: boolean;
	private _edits: NbtEdit[] = [];
	private _savedEdits: NbtEdit[] = [];

    private constructor(
        uri: vscode.Uri,
        initialContent: NbtFile,
    ) {
        super();
        this._uri = uri;
        this._documentData = initialContent;
        this._isStructure = this.isStructureData();
        this._isReadOnly = uri.scheme === 'git' || this._documentData.region;
    }

    public get uri() { return this._uri; }

    public get documentData() { return this._documentData; }

    public get isStructure() { return this._isStructure; }

    public get isReadOnly() { return this._isReadOnly; }

    private readonly _onDidDispose = this._register(new vscode.EventEmitter<void>());
    public readonly onDidDispose = this._onDidDispose.event;

    private readonly _onDidChangeDocument = this._register(new vscode.EventEmitter<NbtEdit>());
    public readonly onDidChangeContent = this._onDidChangeDocument.event;

    private readonly _onDidChange = this._register(new vscode.EventEmitter<{
        readonly label: string;
        undo(): void;
        redo(): void;  
    }>());
    public readonly onDidChange = this._onDidChange.event;

    dispose(): void {
        this._onDidDispose.fire();
        super.dispose();
    }

    makeEdit(edit: NbtEdit) {
        if (this._isReadOnly) {
            vscode.window.showWarningMessage('Cannot edit in read-only editor')
            return
        }
        const logger = (s: string) => output.appendLine(s)

        this._edits.push(edit);
        applyEdit(this._documentData, edit, logger)
        const reversed = reverseEdit(edit)

		this._onDidChange.fire({
			label: 'Edit',
			undo: async () => {
                this._edits.pop();
                applyEdit(this._documentData, reversed, logger)
				this._onDidChangeDocument.fire(reversed);
			},
			redo: async () => {
                this._edits.push(edit);
                applyEdit(this._documentData, edit, logger);
				this._onDidChangeDocument.fire(edit);
			}
		});
        this._onDidChangeDocument.fire(edit);
    }

    private isStructureData() {
        if (this._documentData.region) return false
        const root = this._documentData.data.value
        return root['size']?.type === 'list'
            && root['size'].value.type === 'int'
            && root['size'].value.value.length === 3
            && root['blocks']?.type === 'list'
            && root['palette']?.type === 'list'
    }

    async getChunkData(x: number, z: number): Promise<nbt.NbtChunk> {
        if (!this._documentData.region) {
            throw new Error('File is not a region file');
        }

        const chunks = this._documentData.chunks;
        return nbt.readChunk(chunks, x, z)
    }

    async save(cancellation: vscode.CancellationToken): Promise<void> {
        await this.saveAs(this.uri, cancellation);
		this._savedEdits = Array.from(this._edits);
    }

    async saveAs(targetResource: vscode.Uri, cancellation: vscode.CancellationToken): Promise<void> {
        if (this._isReadOnly) {
            return;
        }

        const nbtFile = this._documentData
        if (cancellation.isCancellationRequested) {
            return;
        }

        if (nbtFile.region) {
            nbtFile.chunks.filter(c => c.dirty).forEach(c => {
                nbt.writeChunk(nbtFile.chunks, c.x, c.z, c.nbt!)
            })
        }

        const fileData = nbtFile.region
            ? nbt.writeRegion(nbtFile.chunks)
            : nbt.write(nbtFile.data, nbtFile.gzipped, nbtFile.littleEndian)

        await vscode.workspace.fs.writeFile(targetResource, fileData);
    }

    async revert(_cancellation: vscode.CancellationToken): Promise<void> {
        const diskContent = await NbtDocument.readFile(this.uri);
        this._documentData = diskContent;
		this._edits = this._savedEdits;
        this._onDidChangeDocument.fire({
            ops: [{
                type: 'set',
                path: [],
                old: null,
                new: this._documentData
            }]
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
