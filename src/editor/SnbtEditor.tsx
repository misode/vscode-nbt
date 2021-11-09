import type { NamedNbtTag } from 'deepslate'
import {h, render} from 'preact'
import { Snbt } from '../common/Snbt'
import type { EditHandler, EditorPanel, VSCode } from './Editor'
import { locale } from './Locale'

export class SnbtEditor implements EditorPanel {
	private snbt: string

	constructor(private readonly root: Element, private readonly vscode: VSCode, private readonly editHandler: EditHandler, private readonly readOnly: boolean) {
		this.snbt = ''
	}

	reveal() {
		render(<Main snbt={this.snbt} />, this.root)
	}

	onInit(data: NamedNbtTag) {
		this.snbt = Snbt.stringify('compound', data.value)
		this.reveal()
	}

	onUpdate(data: NamedNbtTag) {
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

function Main({ snbt }) {
	const lines = snbt.match(/\n/g)?.length ?? 0
	return <div class="nbt-content">
		<textarea class="snbt-editor" rows={lines + 1} readonly>
			{snbt}
		</textarea>
	</div>
}
