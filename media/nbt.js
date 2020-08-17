
(function () {
	const vscode = acquireVsCodeApi();

	class NbtEditor {
		constructor(parent) {
			this._initElements(parent);
		}
		
		_initElements(parent) {
			this.text = document.createElement('textarea')
			this.text.textContent = 'Loading...'
			parent.append(this.text)
		}

		_redraw() {
			this.text.textContent = JSON.stringify(this.nbtData, null, 2)
		}
		
		async reset(data) {
			this.nbtData = data
			this._redraw();
		}

		async getNbtData() {
			return JSON.parse(this.text.value)
		}
	}

	const editor = new NbtEditor(document.querySelector('.nbt-editor'));

	window.addEventListener('message', async e => {
		const { type, body, requestId } = e.data;
		switch (type) {
			case 'init':
				{
					if (body.untitled) {
						return;
					} else {
						await editor.reset(body.value);
						return;
					}
				}
			case 'update':
				{
					const data = body.content ? new Uint8Array(body.content.data) : undefined;
					await editor.reset(data)
					return;
				}
			case 'getFileData':
				{
					editor.getNbtData().then(data => {
						vscode.postMessage({ type: 'response', requestId, body: data });
					});
					return;
				}
		}
	});

	vscode.postMessage({ type: 'ready' });
}());
