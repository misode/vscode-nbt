import * as vscode from 'vscode';
import * as zlib from 'zlib';

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

export function isRegionFile(uri: vscode.Uri) {
	return uri.fsPath.endsWith('.mca')
}

export function zlibUnzip(buffer: zlib.InputType): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		zlib.unzip(buffer, (error, result) => {
			if (error) {
				reject(error)
			}
			resolve(result)
		})
	})
}


export function zlibZip(buffer: zlib.InputType): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		zlib.deflate(buffer, (error, result) => {
			if (error) {
				reject(error)
			}
			resolve(result)
		})
	})
}
