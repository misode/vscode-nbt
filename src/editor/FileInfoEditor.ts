import type { NbtFile } from 'deepslate'
import { NbtInt, NbtString } from 'deepslate'
import type { EditHandler, VSCode } from './Editor'
import { TreeEditor } from './TreeEditor'

export class FileInfoEditor extends TreeEditor {
	constructor(root: Element, vscode: VSCode, editHandler: EditHandler, readOnly: boolean) {
		super(root, vscode, editHandler, true)
	}

	onInit(file: NbtFile) {
		this.file.root.clear()
			.set('RootName', new NbtString(file.name))
			.set('Endianness', new NbtString(file.littleEndian ? 'little' : 'big'))
			.set('Compression', new NbtString(file.compression ?? 'none'))
		if (file.bedrockHeader) {
			this.file.root.set('BedrockHeader', new NbtInt(file.bedrockHeader))
		}
	}

	onUpdate(file: NbtFile) {
		this.onInit(file)
	}

	menu() {
		return []
	}
}
