import type { NbtChunk } from 'deepslate'
import { NbtFile, NbtRegion, NbtType } from 'deepslate'
import * as vscode from 'vscode'
import { applyEdit, reverseEdit } from './common/Operations'
import type { Logger, NbtEdit } from './common/types'
import { Disposable } from './dispose'

export class NbtDocument extends Disposable implements vscode.CustomDocument {

	static async create(
		uri: vscode.Uri,
		backupId: string | undefined,
		logger: Logger,
	): Promise<NbtDocument | PromiseLike<NbtDocument>> {
		const dataFile = typeof backupId === 'string' ? vscode.Uri.parse(backupId) : uri
		logger.info(`Creating NBT document [uri=${JSON.stringify(dataFile)}]`)
		const fileData = await NbtDocument.readFile(dataFile, logger)
		return new NbtDocument(uri, fileData, logger)
	}

	private static async readFile(uri: vscode.Uri, logger: Logger): Promise<NbtFile | NbtRegion> {
		const array = await vscode.workspace.fs.readFile(uri)

		logger.info(`Read file [length=${array.length}, scheme=${uri.scheme}, extension=${uri.path.match(/(?:\.([^.]+))?$/)?.[1]}]`)

		if (uri.scheme === 'git' && array.length === 0) {
			return NbtFile.create()
		}

		if (uri.fsPath.endsWith('.mca')) {
			return NbtRegion.read(array)
		}

		const littleEndian = uri.fsPath.endsWith('.mcstructure')
		const file = NbtFile.read(array, { littleEndian })

		logger.info(`Parsed NBT [compression=${file.compression ?? 'none'}, littleEndian=${file.littleEndian ?? false}, bedrockHeader=${file.bedrockHeader ?? 'none'}]`)

		return file
	}


	private readonly _uri: vscode.Uri

	private _documentData: NbtFile | NbtRegion
	private readonly _isStructure: boolean
	private readonly _isMap: boolean
	private readonly _isReadOnly: boolean
	private _edits: NbtEdit[] = []
	private _savedEdits: NbtEdit[] = []

	private constructor(
		uri: vscode.Uri,
		initialContent: NbtFile | NbtRegion,
		private readonly logger: Logger,
	) {
		super()
		this._uri = uri
		this._documentData = initialContent
		this._isStructure = this.isStructureData()
		this._isMap = this.isMapData()

		this._isReadOnly = uri.scheme === 'git'
	}

	public get uri() { return this._uri }

	public get documentData() { return this._documentData }

	public get isStructure() { return this._isStructure }

	public get isMap() { return this._isMap }

	public get isReadOnly() { return this._isReadOnly }

	public get dataVersion() {
		const file = this._documentData
		if (file instanceof NbtRegion) {
			const firstChunk = file.getFirstChunk()
			return firstChunk?.getRoot().getNumber('DataVersion') ?? 0
		} else {
			return file.root.getNumber('DataVersion') ?? 0
		}
	}

	private readonly _onDidDispose = this._register(new vscode.EventEmitter<void>())
	public readonly onDidDispose = this._onDidDispose.event

	private readonly _onDidChangeDocument = this._register(new vscode.EventEmitter<NbtEdit>())
	public readonly onDidChangeContent = this._onDidChangeDocument.event

	private readonly _onDidChange = this._register(new vscode.EventEmitter<{
		readonly label: string,
		undo(): void,
		redo(): void,  
	}>())
	public readonly onDidChange = this._onDidChange.event

	dispose(): void {
		this._onDidDispose.fire()
		super.dispose()
	}

	makeEdit(edit: NbtEdit) {
		if (this._isReadOnly) {
			vscode.window.showWarningMessage('Cannot edit in read-only editor')
			return
		}

		this._edits.push(edit)
		applyEdit(this._documentData, edit, this.logger)
		const reversed = reverseEdit(edit)

		this._onDidChange.fire({
			label: 'Edit',
			undo: async () => {
				this._edits.pop()
				applyEdit(this._documentData, reversed, this.logger)
				this._onDidChangeDocument.fire(reversed)
			},
			redo: async () => {
				this._edits.push(edit)
				applyEdit(this._documentData, edit, this.logger)
				this._onDidChangeDocument.fire(edit)
			},
		})
		this._onDidChangeDocument.fire(edit)
	}

	private isStructureData() {
		if (this._documentData instanceof NbtRegion) return false
		const root = this._documentData.root
		return root.hasList('size', NbtType.Int, 3)
			&& root.hasList('blocks') && root.hasList('palette')
	}

	private isMapData() {
		return this._uri.fsPath.match(/(?:\\|\/)map_\d+\.dat$/) !== null
	}

	async getChunkData(x: number, z: number): Promise<NbtChunk> {
		if (!(this._documentData instanceof NbtRegion)) {
			throw new Error('File is not a region file')
		}

		const chunk = this._documentData.findChunk(x, z)
		if (!chunk) {
			throw new Error(`Cannot find chunk [${x}, ${z}]`)
		}
		return chunk
	}

	async save(cancellation: vscode.CancellationToken): Promise<void> {
		await this.saveAs(this.uri, cancellation)
		this._savedEdits = Array.from(this._edits)
	}

	async saveAs(targetResource: vscode.Uri, cancellation: vscode.CancellationToken): Promise<void> {
		if (this._savedEdits.length === this._edits.length) {
			return
		}
		if (this._isReadOnly) {
			return
		}

		const nbtFile = this._documentData
		if (cancellation.isCancellationRequested) {
			return
		}

		const fileData = nbtFile.write()

		await vscode.workspace.fs.writeFile(targetResource, fileData)
	}

	async revert(_cancellation: vscode.CancellationToken): Promise<void> {
		const diskContent = await NbtDocument.readFile(this.uri, this.logger)
		this._documentData = diskContent
		this._edits = this._savedEdits
		// TODO: notify listeners that document has reset
	}

	async backup(destination: vscode.Uri, cancellation: vscode.CancellationToken): Promise<vscode.CustomDocumentBackup> {
		await this.saveAs(destination, cancellation)
		return {
			id: destination.toString(),
			delete: async () => {
				try {
					await vscode.workspace.fs.delete(destination)
				} catch { }
			},
		}
	}
}
