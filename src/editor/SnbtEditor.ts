import type { NbtFile } from 'deepslate'
import { NbtTag } from 'deepslate'
import type { EditHandler, EditorPanel, VSCode } from './Editor'
import { locale } from './Locale'

export class SnbtEditor implements EditorPanel {
	private file: NbtFile
	private snbt: string

	constructor(private readonly root: Element, private readonly vscode: VSCode, private readonly editHandler: EditHandler, private readonly readOnly: boolean) {
		this.snbt = ''
	}

	reveal() {
		const content = document.createElement('div')
		content.classList.add('nbt-content')
		const textarea = document.createElement('textarea')
		textarea.classList.add('snbt-editor')
		textarea.textContent = this.snbt
		textarea.rows = (this.snbt.match(/\n/g)?.length ?? 0) + 1
		textarea.addEventListener('change', () => {
			const newRoot = NbtTag.fromString(textarea.value)
			this.editHandler({ type: 'set', path: [], old: this.file.root.toJsonWithId(), new: newRoot.toJsonWithId() })
		})
		content.append(textarea)
		this.root.append(content)
	}

	onInit(file: NbtFile) {
		this.file = file
		this.snbt = file.root.toPrettyString('  ')
		const textarea = this.root.querySelector('.snbt-editor')
		if (textarea) {
			textarea.textContent = this.snbt
		}
	}

	onUpdate(file: NbtFile) {
		this.onInit(file)
	}

	menu() {
		const copyButton = document.createElement('div')
		copyButton.classList.add('btn')
		copyButton.textContent = locale('copy')
		copyButton.addEventListener('click', () => {
			const textarea = this.root.querySelector('.snbt-editor') as HTMLTextAreaElement
			textarea.select()
			document.execCommand('copy')
		})

		return [copyButton]
	}
}
