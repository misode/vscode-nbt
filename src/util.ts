export function getNonce() {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}

export function hasGzipHeader(data: Uint8Array) {
	var head = new Uint8Array(data.slice(0, 2));
	return head.length === 2 && head[0] === 0x1f && head[1] === 0x8b;
}
