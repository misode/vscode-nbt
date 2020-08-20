
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
			this.content.innerHTML = this._drawTag(new NbtPath(), 'compound', this.nbtFile.data.value);
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

		_drawTag(path, type, data) {
			const expanded = this._canExpand(type) && this._isExpanded(path)
			return `<div class="nbt-tag${this._canExpand(type)  ? ' collapse' : ''}">
				${this._canExpand(type) ? this._drawCollapse(path) : ''}
				${this._drawIcon(type)}
				${this._drawKey(path)}
				${this._drawTagHeader(path, type, data)}
			</div>
			${expanded ? `<div class="nbt-body">
				${this._drawTagBody(path, type, data)}
			</div>` : ''}`
		}

		_canExpand(type) {
			return type === 'compound' || type === 'list' || type === 'byteArray' || type === 'intArray' || type === 'longArray'
		}

		_drawTagHeader(path, type, data) {
			try {
				switch(type) {
					case 'compound': return this._drawEntries(Object.keys(data));
					case 'list': return this._drawEntries(data.value);
					case 'byteArray': return this._drawEntries(data);
					case 'intArray': return this._drawEntries(data);
					case 'longArray': return this._drawEntries(data);
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

		_drawCollapse(path) {
			const expand = this._isExpanded(path)
			const click = this._on('click', () => {
				if (expand) this._collapse(path);
				else this._expand(path);
				this._redraw();
			})
			return `<span class="nbt-collapse"${click}>${expand ? '-' : '+'}</span>`;
		}

		_drawEntries(entries) {
			return `<span class="nbt-entries">${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}</span>`;
		}

		_drawCompound(path, data) {
			return Object.keys(data).map(k => `<div>
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
			// 			input.outerHTML = this._drawString(path, input.value);
			// 			this._addEvents();
			// 		})
			// 	})
			// 	el.outerHTML = `<input type="text" value="${data}" ${edit}>`;
			// 	this._addEvents();
			// })
			return `<span>${JSON.stringify(data)}</span>`;
		}

		_drawNumber(path, data, suffix) {
			return `<span>${data}${suffix || ''}</span>`;
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
		}

		async reset(data) {
			if (data.anvil) {
				console.log(data);
				this.nbtFile = {anvil: false, gzipped: false, data: {name: '', value: {}}}
				data.chunks.forEach(c => {
					this.nbtFile.data.value[`Chunk [${c.x}, ${c.z}]`] = {
						type: 'compound',
						value: {}
					}
				})
			} else {
				this.nbtFile = data;
			}
			console.log(this.nbtFile)
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
