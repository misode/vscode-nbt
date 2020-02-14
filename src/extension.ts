import * as vscode from 'vscode';
import { NbtEditorProvider } from './nbtEditor';

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(new NbtEditorProvider(context.extensionPath).register());
}

export function deactivate() {}
