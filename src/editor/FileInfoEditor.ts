import type { NbtFile } from '../common/types'
import type { EditHandler, VSCode } from './Editor'
import { TreeEditor } from './TreeEditor'

export class FileInfoEditor extends TreeEditor {

	constructor(root: Element, vscode: VSCode, editHandler: EditHandler, readOnly: boolean) {
		super(root, vscode, editHandler, true)
	}

	onFile(file: NbtFile) {
		if (!file.region) {
			this.data = {
				name: '',
				value: {
					RootName: {
						type: 'string',
						value: file.name,
					},
					Endianness: {
						type: 'string',
						value: file.littleEndian ? 'little' : 'big',
					},
					Compression: {
						type: 'string',
						value: file.compression ?? 'none',
					},
					...file.bedrockHeader ? {
						BedrockHeader: {
							type: 'int',
							value: file.bedrockHeader,
						},
					} : {},
				},
			}
		}
	}

	onInit() {
		super.onInit(this.data)
	}

	onUpdate() {
	}

	menu() {
		return []
	}
}
