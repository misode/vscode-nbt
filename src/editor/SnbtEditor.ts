import { Snbt } from '../common/Snbt'
import type { NbtFile } from '../common/types'
import type { EditHandler, EditorPanel, VSCode } from './Editor'
import { locale } from './Locale'

export class SnbtEditor implements EditorPanel {
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
		textarea.readOnly = true
		content.append(textarea)
		this.root.append(content)
	}

	onInit(data: NbtFile) {
		if (data.region !== false) return
		this.snbt = Snbt.stringify('compound', data.data.value)
		const textarea = this.root.querySelector('.snbt-editor')
		if (textarea) {
			textarea.textContent = this.snbt
		}
	}

	onUpdate(data: NbtFile) {
		this.onInit(data)
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
