import * as vscode from 'vscode';
import { NbtEditorProvider } from './NbtEditor';
import { Structure3DProvider } from './Structure3D';

export function activate(context: vscode.ExtensionContext) {
	if (+vscode.version.match(/1\.(\d+)/)![1] >= 45) {
		context.subscriptions.push(NbtEditorProvider.register(context));
		context.subscriptions.push(Structure3DProvider.register(context));
	}
}
