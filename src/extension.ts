import * as vscode from 'vscode';
import { NbtEditorProvider } from './nbtEditor';

export function activate(context: vscode.ExtensionContext) {
	if (+vscode.version.match(/1\.(\d+)/)![1] >= 45) {
		context.subscriptions.push(NbtEditorProvider.register(context));
	}
}
