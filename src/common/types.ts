import type { JsonValue } from 'deepslate'
import type { AssetBundle } from '../assets/Types'

export interface Logger {
	error(data: any, ...args: any[]): void
	info(data: any, ...args: any[]): void
	log(data: any, ...args: any[]): void
	warn(data: any, ...args: any[]): void
}

export type NbtEdit = {
	type: 'composite',
	edits: NbtEdit[],
} | {
	type: 'chunk',
	x: number,
	z: number,
	edit: NbtEdit,
} | {
	type: 'set',
	path: (number | string)[],
	new: JsonValue,
	old: JsonValue,
} | {
	type: 'remove' | 'add',
	path: (number | string)[],
	value: JsonValue,
} | {
	type: 'move',
	path: (number | string)[],
	source: (number | string)[],
}

export type EditorMessage = { requestId?: number } & ({
	type: 'getResources',
	body: { ids: string[], models: string[], textures: string[], generation: number },
} | {
	type: 'resourceDiagnostics',
	body: string[],
} | {
	type: 'ready',
} | {
	type: 'response',
	requestId: number,
	body: any,
} | {
	type: 'error',
	body: string,
} | {
	type: 'edit',
	body: NbtEdit,
} | {
	type: 'getChunkData',
	body: {
		x: number,
		z: number,
	},
})

export type ViewMessage = { requestId?: number } & ({
	type: 'resources',
	body?: AssetBundle,
	generation: number,
	error?: string,
} | {
	type: 'resourcesChanged',
} | {
	type: 'init',
	body: {
		type: 'default' | 'structure' | 'map' | 'region',
		readOnly: boolean,
		content: JsonValue,
	},
} | {
	type: 'update',
	body: NbtEdit,
} | {
	type: 'chunk',
	body: {
		x: number,
		z: number,
		size: number,
		content: JsonValue,
	},
} | {
	type: 'response',
	body?: unknown,
	error?: string,
})
