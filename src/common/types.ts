import { NamedNbtTag, NbtChunk } from '@webmc/nbt';

export type SimpleNbtFile = {
	region: false
	gzipped: boolean
	littleEndian?: boolean
	data: NamedNbtTag
}

export type RegionNbtFile = {
	region: true
	chunks: (NbtChunk & {
		dirty?: boolean
	})[]
}

export type NbtFile = SimpleNbtFile | RegionNbtFile

export type NbtEditOp = {
	type: 'set'
	path: (number | string)[]
	new: any
	old: any
} | {
	type: 'remove' | 'add'
	path: (number | string)[]
	value: any
	valueType: string
} | {
	type: 'move'
	path: (number | string)[]
	target: (number | string)[]
}

export type NbtEdit = {
	ops: NbtEditOp[]
}

export type EditorMessage = {
	type: 'ready'
} | {
	type: 'response'
	requestId: number
	body: any
} | {
	type: 'error'
	body: string
} | {
	type: 'edit'
	body: NbtEdit
} | {
	type: 'getChunkData'
	body: {
		x: number
		z: number
	}
}

export type ViewMessage = {
  type: 'init'
  body: {
		type: 'default' | 'region' | 'structure'
		readOnly: boolean
    content: NbtFile
  }
} | {
  type: 'update'
  body: NbtEdit
} | {
  type: 'chunk'
  body: NbtChunk
}
