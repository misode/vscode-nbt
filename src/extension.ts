import * as vscode from 'vscode';
import { NbtEditorProvider } from './NbtEditor';

export let output: vscode.OutputChannel

export function activate(context: vscode.ExtensionContext) {
	output = vscode.window.createOutputChannel('NBT Viewer')
	context.subscriptions.push(NbtEditorProvider.register(context))
}
