import * as vscode from 'vscode';
import { Disposable } from './dispose';
import * as nbt from '@webmc/nbt';
import { NbtEdit, NbtFile, NbtPath } from './types';

export class NbtDocument extends Disposable implements vscode.CustomDocument {

    static async create(
        uri: vscode.Uri,
        backupId: string | undefined,
    ): Promise<NbtDocument | PromiseLike<NbtDocument>> {
        const dataFile = typeof backupId === 'string' ? vscode.Uri.parse(backupId) : uri;
        const fileData = await NbtDocument.readFile(dataFile);
        return new NbtDocument(uri, fileData);
    }

    private static async readFile(uri: vscode.Uri): Promise<NbtFile> {
        let array = await vscode.workspace.fs.readFile(uri);

        if (uri.fsPath.endsWith('.mca')) {
            return {
                region: true,
                chunks: nbt.readRegion(array)
            }
        }

        const { compressed, result } = nbt.read(array)
        return {
            region: false,
            gzipped: compressed,
            data: result
        }
    }


    private readonly _uri: vscode.Uri;

    private _documentData: NbtFile;
    private _isStructure: boolean;
	private _edits: NbtEdit[] = [];
	private _savedEdits: NbtEdit[] = [];

    private constructor(
        uri: vscode.Uri,
        initialContent: NbtFile,
    ) {
        super();
        this._uri = uri;
        this._documentData = initialContent;
        this._isStructure = this.isStructureData()
    }

    public get uri() { return this._uri; }

    public get documentData() { return this._documentData; }

    public get isStructure() { return this._isStructure; }

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
        this._edits.push(edit);
        this.applyEdit(edit)
        const reversedEdit = this.reverseEdit(edit)

		this._onDidChange.fire({
			label: 'Edit',
			undo: async () => {
                this._edits.pop();
                this.applyEdit(reversedEdit)
				this._onDidChangeDocument.fire(reversedEdit);
			},
			redo: async () => {
                this._edits.push(edit);
                this.applyEdit(edit);
				this._onDidChangeDocument.fire(edit);
			}
		});
        this._onDidChangeDocument.fire(edit);
    }

    private reverseEdit(edit: NbtEdit): NbtEdit {
        return {
            ops: [...edit.ops].reverse()
                .map(op => ({ ...op, new: op.old, old: op.new }))
        }
    }

    private applyEdit(edit: NbtEdit) {
        for (let i = 0; i < edit.ops.length; i += 1) {
            const op = edit.ops[i];
            switch(op.type) {
                case 'set': this.pathSet(op.path, op.new);
            }
        }
    }

    private pathSet(path: NbtPath, value: any) {
        let node: any
        let type = 'compound'
        let index = 0

        if (this._documentData.region) {
            if (typeof path[0] !== 'number') {
                throw new Error('Edit path should start with a number in region files')
            }
            const chunk = this._documentData.chunks[path[0]]
            if (!chunk.nbt) {
                throw new Error('Cannot edit chunk that has not been parsed')
            }
            node = chunk.nbt.value
            index = 1
        } else {
            node = this._documentData.data.value
        }

        for (; index < path.length - 1; index++) {
            const el = path[index]
            if (type === 'compound' && typeof el === 'string') {
                type = node[el].type
                node = node[el].value
            } else if (type === 'list' && typeof el === 'number') {
                type = node.type
                node = node.value[el]
            } else if (type.endsWith('Array') && typeof el === 'number') {
                type = type.slice(-5)
                node = node[el]
            } else {
                throw new Error(`Invalid edit path ${path} at index ${index}`)
            }
            if (node === undefined) {
                throw new Error(`Path ${path} not found in document`)
            }
        }

        const last = path[path.length -1]
        if (type === 'compound' && typeof last === 'string') {
            node[last].value = value
        } else if (type === 'list' && typeof last === 'number') {
            node = node.value[last] = value
        } else if (type.endsWith('Array') && typeof last === 'number') {
            node = node[last] = value
        }
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

    async getChunkData(index: number): Promise<nbt.NbtChunk> {
        if (!this._documentData.region) {
            throw new Error('File is not a region file');
        }

        const chunks = this._documentData.chunks;
        return nbt.readChunk(chunks, chunks[index].x, chunks[index].z)
    }

    async save(cancellation: vscode.CancellationToken): Promise<void> {
        await this.saveAs(this.uri, cancellation);
		this._savedEdits = Array.from(this._edits);
    }

    async saveAs(targetResource: vscode.Uri, cancellation: vscode.CancellationToken): Promise<void> {
        const nbtFile = this._documentData
        if (cancellation.isCancellationRequested) {
            return;
        }

        const fileData = nbtFile.region
            ? nbt.writeRegion(nbtFile.chunks)
            : nbt.write(nbtFile.data, nbtFile.gzipped)

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
