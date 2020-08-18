
(function () {
	const vscode = acquireVsCodeApi();

	const dec2hex = (dec) => ('0' + dec.toString(16)).substr(-2)

	function hexId(length = 12) {
		var arr = new Uint8Array(length / 2)
		window.crypto.getRandomValues(arr)
		return Array.from(arr, dec2hex).join('')
	}

	class NbtPath {
		constructor(arr) {
			this.arr = arr || [];
		}
		pop() {
			return new NbtPath(this.arr.slice(0, -1))
		}
		push(el) {
			return new NbtPath([...this.arr, el])
		}
		last() {
			return this.arr[this.arr.length - 1]
		}
		length() {
			return this.arr.length
		}
		toString() {
			return this.arr
				.map(e => (typeof e === 'string') ? `.${e}` : `[${e}]`)
				.join('')
				.replace(/^\./, '')
		}
	}

	class NbtEditor {
		constructor(parent) {
			this.events = {}
			this._initElements(parent);
		}
		
		_initElements(parent) {
			this.content = document.createElement('div');
			this.content.className = 'nbt-content';
			parent.append(this.content);
		}

		_redraw() {
			this.content.innerHTML = this._drawTag(new NbtPath(), 'compound', this.nbtFile.data.value);
			Object.keys(this.events).forEach(id => {
				const el = this.content.querySelector(`[data-id="${id}"]`);
				if (el === undefined) return
				this.events[id](el)
			})
		}

		_drawTag(path, type, data) {
			return this._drawIcon(type) + this._drawKey(path) + this._tagTypeSwitch(path, type, data)
		}

		_tagTypeSwitch(path, type, data) {
			try {
				switch(type) {
					case 'compound': return this._drawCompound(path, data);
					case 'list': return this._drawList(path, data);
					case 'string': return this._drawString(path, data);
					case 'byte': return this._drawNumber(path, data, 'b');
					case 'double': return this._drawNumber(path, data, 'd');
					case 'float': return this._drawNumber(path, data, 'f');
					case 'short': return this._drawNumber(path, data, 's');
					case 'int': return this._drawNumber(path, data);
					case 'long': return this._drawLong(path, data);
					default: return `<span>${type}</span>`;
				}
			} catch (e) {
				console.error(e)
				return `<span>Error "${e.message}"</span>`
			}
		}

		_drawIcon(type) {
			return `<span class="nbt-icon ${type}-icon"></span>`
		}

		_drawKey(path) {
			const el = path.last()
			if (el === undefined || typeof el === 'number') return ''
			return `<span class="nbt-key">${path.last()}: </span>`
		}

		_drawEntries(entries) {
			return `<span class="nbt-entries">${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}</span>`
		}

		_drawCompound(path, data) {
			return `${this._drawEntries(Object.keys(data))}
			<div class="nbt-compound">
				${Object.keys(data).map(k => `<div>
					${this._drawTag(path.push(k), data[k].type, data[k].value)}
				</div>`).join('')}
			</div>`;
		}

		_drawList(path, data) {
			return `${this._drawEntries(Object.keys(data.value))}
			<div class="nbt-list">
				${data.value.map((v, i) => `<div>
					${this._drawTag(path.push(i), data.type, v)}
				</div>`).join('')}
			</div>`;
		}

		_drawString(path, data) {
			const id = hexId()
			this.events[id] = () => {
				console.log("HELLO :)")
			}
			return `<span data-id="${id}">${JSON.stringify(data)}</span>`;
		}

		_drawNumber(path, data, suffix) {
			return `<span>${data}${suffix || ''}</span>`;
		}

		_drawLong(path, data) {
			return `<span>[${data}]</span>`
		}
		
		async reset(data) {
			this.nbtFile = data;
			this._redraw();
		}

		async getNbtData() {
			return this.nbtFile;
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
