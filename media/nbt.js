// @ts-check

(function () {
	// @ts-ignore
	const vscode = acquireVsCodeApi();

	class NbtEditor {
		constructor( /** @type {HTMLElement} */ parent) {
			this._initElements(parent);
		}
		
		_initElements(/** @type {HTMLElement} */ parent) {
			this.text = document.createElement('textarea')
			this.text.textContent = 'Loading...'
			parent.append(this.text)
		}

		_redraw() {
			this.text.textContent = this.nbtData.length.toString()
		}

		/**
		 * @param {Uint8Array | undefined} data
		 */
		async reset(data) {
			this.nbtData = data
			this._redraw();
		}

		/** @return {Promise<Uint8Array>} */
		async getNbtData() {
			return this.nbtData
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
						const data = new Uint8Array(body.value.data);
						await editor.reset(data);
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
						vscode.postMessage({ type: 'response', requestId, body: Array.from(data) });
					});
					return;
				}
		}
	});

	vscode.postMessage({ type: 'ready' });
}());
