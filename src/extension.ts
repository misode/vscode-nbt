import * as util from 'util'
import * as vscode from 'vscode'
import type { Logger } from './common/types'
import { NbtEditorProvider } from './NbtEditor'

export function activate(context: vscode.ExtensionContext) {
	const output = vscode.window.createOutputChannel('NBT Viewer')
	const logger: Logger = {
		error: (msg: any, ...args: any[]): void => output.appendLine(util.format(msg, ...args)),
		info: (msg: any, ...args: any[]): void => output.appendLine(util.format(msg, ...args)),
		log: (msg: any, ...args: any[]): void => output.appendLine(util.format(msg, ...args)),
		warn: (msg: any, ...args: any[]): void => output.appendLine(util.format(msg, ...args)),
	}

	context.subscriptions.push(NbtEditorProvider.register(context, logger))
}
