
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
			this.expanded = [""]
			this._initElements(parent);
		}
		
		_initElements(parent) {
			this.content = document.createElement('div');
			this.content.className = 'nbt-content';
			parent.append(this.content);
		}

		_onLoad(callback) {
			const id = hexId()
			this.events[id] = (el) => {
				callback(el)
			}
			return `data-id="${id}"`
		}

		_on(event, callback) {
			return this._onLoad((el) => {
				el.addEventListener(event, (evt) => {
					callback(el)
					evt.stopPropagation()
				})
			})
		}

		_redraw() {
			var t0 = performance.now()
			if (this.nbtFile.anvil) {
				this.content.innerHTML = this._drawAnvil(new NbtPath(), this.nbtFile.chunks);
			} else {
				this.content.innerHTML = this._drawTag(new NbtPath(), 'compound', this.nbtFile.data.value);
			}
			this._addEvents()
			var t1 = performance.now()
			console.log(`Redraw: ${t1-t0} ms`)
		}

		_addEvents() {
			Object.keys(this.events).forEach(id => {
				const el = this.content.querySelector(`[data-id="${id}"]`);
				if (el !== undefined) this.events[id](el)
			})
			this.events = {}
		}

		_isExpanded(path) {
			return this.expanded.includes(path.toString())
		}

		_collapse(path) {
			const index = this.expanded.indexOf(path.toString());
			if (index > -1) {
				this.expanded.splice(index, 1);
			}
		}

		_expand(path) {
			this.expanded.push(path.toString())
		}

		_drawAnvil(path, chunks) {
			return chunks.map((c, i) => `<div>
				${this._drawChunk(path.push(i), c)}
			</div>`).join('')
		}

		_drawChunk(path, chunk) {
			const expanded = chunk.loaded && this._isExpanded(path);
			return `<div class="nbt-tag collapse">
				${chunk.loaded ? this._drawCollapse(path, 'compound', chunk.data.value) : this._drawChunkExpand(path)}
				${this._drawIcon('compound')}
				<span class="nbt-key">Chunk [${chunk.x}, ${chunk.z}]</span>
			</div>
			<div class="nbt-body">
				${expanded ? this._drawCompound(path, chunk.data.value) : ''}
			</div>`
		}

		_drawChunkExpand(path) {
			const click = this._on('click', () => {
				this._expand(path);
				vscode.postMessage({ type: 'getChunkData', index: path.last() })
			})
			return `<span class="nbt-collapse" ${click}>+</span>`;
		}

		_drawTag(path, type, data) {
			const expanded = this._canExpand(type) && this._isExpanded(path)
			return `<div class="nbt-tag${this._canExpand(type)  ? ' collapse' : ''}">
				${this._canExpand(type) ? this._drawCollapse(path, type, data) : ''}
				${this._drawIcon(type)}
				${this._drawKey(path)}
				${this._drawTagHeader(path, type, data)}
			</div>
			<div class="nbt-body">
				${expanded ? this._drawTagBody(path, type, data) : ''}
			</div>`
		}

		_canExpand(type) {
			return type === 'compound' || type === 'list' || type === 'byteArray' || type === 'intArray' || type === 'longArray'
		}

		_drawTagHeader(path, type, data) {
			try {
				switch(type) {
					case 'compound': return this._drawEntries(Object.keys(data));
					case 'list': return this._drawEntries(data.value);
					case 'byteArray':
					case 'intArray':
					case 'longArray': return this._drawEntries(data);
					case 'string': return this._drawString(path, data);
					case 'byte':
					case 'double':
					case 'float':
					case 'short':
					case 'int': return this._drawNumber(path, data, type);
					case 'long': return this._drawLong(path, data);
					default: return `<span>${type}</span>`;
				}
			} catch (e) {
				console.error(e)
				return `<span>Error "${e.message}"</span>`
			}
		}

		_drawTagBody(path, type, data) {
			try {
				switch(type) {
					case 'compound': return this._drawCompound(path, data);
					case 'list': return this._drawList(path, data);
					case 'byteArray': return this._drawArray(path, data, 'byte');
					case 'intArray': return this._drawArray(path, data, 'int');
					case 'longArray': return this._drawArray(path, data, 'long');
					default: return '';
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

		_drawCollapse(path, type, data) {
			const click = this._on('click', (el) => {
				const body = el.parentElement.nextElementSibling;
				if (this._isExpanded(path)) {
					this._collapse(path);
					body.innerHTML = '';
					el.textContent = '+';
				} else {
					this._expand(path);
					body.innerHTML = this._drawTagBody(path, type, data)
					this._addEvents();
					el.textContent = '-';
				}
			})
			return `<span class="nbt-collapse" ${click}>${this._isExpanded(path) ? '-' : '+'}</span>`;
		}

		_drawEntries(entries) {
			return `<span class="nbt-entries">${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}</span>`;
		}

		_drawCompound(path, data) {
			return Object.keys(data).sort().map(k => `<div>
				${this._drawTag(path.push(k), data[k].type, data[k].value)}
			</div>`).join('')
		}

		_drawList(path, data) {
			return data.value.map((v, i) => `<div>
				${this._drawTag(path.push(i), data.type, v)}
			</div>`).join('')
		}

		_drawArray(path, data, type) {
			return data.map((v, i) => `<div>
				${this._drawTag(path.push(i), type, v)}
			</div>`).join('')
		}

		_drawString(path, data) {
			// const click = this._on('click', el => {
			// 	const edit = this._onLoad(input => {
			// 		input.focus();
			// 		input.setSelectionRange(data.length, data.length)
			// 		input.addEventListener('blur', () => {
			// 			this._setTag(path, input.value);
			// 			this._redraw();
			// 		})
			// 	})
			// 	el.outerHTML = `<input type="text" value="${data}" ${edit}>`;
			// 	this._addEvents();
			// })
			return `<span ${click}>${JSON.stringify(data)}</span>`;
		}

		_drawNumber(path, data, type) {
			// const string = `${data}`;
			// const click = this._on('click', el => {
			// 	const edit = this._onLoad(input => {
			// 		input.focus();
			// 		input.setSelectionRange(string.length, string.length)
			// 		input.addEventListener('blur', () => {
			// 			console.log(input)
			// 			console.log(input.value)
			// 			const newValue = this._parseNumber(type, input.value, data);
			// 			console.log("CHANGE NUM", newValue)
			// 			this._setTag(path, newValue);
			// 			this._redraw();
			// 		})
			// 	})
			// 	el.outerHTML = `<input type="text" value="${data}" ${edit}>`;
			// 	this._addEvents();
			// })
			return `<span ${click}>${data}</span>`;
		}

		_parseNumber(type, input, old) {
			switch (type) {
				case 'byte':
				case 'short':
				case 'int': return parseInt(input);
				case 'float':
				case 'double': return parseFloat(input);
				default:
					return old
			}
		}

		_drawLong(path, data) {
			return `<span>[${data}]</span>`;
		}

		_setTag(path, value) {
			let node = this.nbtFile.data.value;
			let type = 'compound';
			for (const el of path.pop().arr) {
				if (type === 'compound') {
					type = node[el].type;
					node = node[el].value;
				} else if (type === 'list') {
					type = node.type;
					node = node.value[el];
				} else {
					return node;
				}
			}
			if (type === 'compound') {
				node[path.last()].value = value;
			} else if (type === 'list') {
				node.value[path.last()] = value;
			}
			vscode.postMessage({ type: 'dirty' });
		}

		async loadChunk(chunk) {
			const index = this.nbtFile.chunks.findIndex(c => c.x === chunk.x && c.z === chunk.z);
			this.nbtFile.chunks[index] = chunk;
			this._redraw();
		}

		async reset(data) {
			this.nbtFile = data;
			this._redraw();
		}

		async getData() {
			return this.nbtFile;
		}
	}

	const editor = new NbtEditor(document.querySelector('.nbt-editor'));

	window.addEventListener('message', async e => {
		const { type, body, requestId } = e.data;
		switch (type) {
			case 'init':
				editor.reset(body.content);
				return;

			case 'chunk':
				editor.loadChunk(body);
				return;

			case 'update':
				editor.reset(body.content);
				return;

			case 'getFileData':
				editor.getData().then(data => {
					vscode.postMessage({ type: 'response', requestId, body: data });
				});
				return;
		}
	});

	vscode.postMessage({ type: 'ready' });
}());
