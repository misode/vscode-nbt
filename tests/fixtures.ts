import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import { deflateRawSync, deflateSync } from 'node:zlib'
import type { MinecraftInstance, ModelJson } from '../src/assets/Types'

function crc32(bytes: Buffer): number {
	let crc = 0xffffffff
	for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = crc >>> 1 ^ (crc & 1 ? 0xedb88320 : 0) }
	return (crc ^ 0xffffffff) >>> 0
}
export async function zip(file: string, entries: Record<string, string | Buffer>): Promise<void> {
	const locals: Buffer[] = []
	const central: Buffer[] = []
	let offset = 0
	for (const [name, content] of Object.entries(entries)) {
		const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content)
		const packed = deflateRawSync(bytes)
		const filename = Buffer.from(name)
		const header = Buffer.alloc(30)
		header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(8, 8); header.writeUInt32LE(crc32(bytes), 14); header.writeUInt32LE(packed.length, 18); header.writeUInt32LE(bytes.length, 22); header.writeUInt16LE(filename.length, 26)
		locals.push(header, filename, packed)
		const directory = Buffer.alloc(46)
		directory.writeUInt32LE(0x02014b50, 0); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6); directory.writeUInt16LE(8, 10); directory.writeUInt32LE(crc32(bytes), 16); directory.writeUInt32LE(packed.length, 20); directory.writeUInt32LE(bytes.length, 24); directory.writeUInt16LE(filename.length, 28); directory.writeUInt32LE(offset, 42)
		central.push(directory, filename)
		offset += header.length + filename.length + packed.length
	}
	const end = Buffer.alloc(22)
	end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(entries).length, 8); end.writeUInt16LE(Object.keys(entries).length, 10); end.writeUInt32LE(Buffer.concat(central).length, 12); end.writeUInt32LE(offset, 16)
	await fs.mkdir(path.dirname(file), { recursive: true })
	await fs.writeFile(file, Buffer.concat([...locals, ...central, end]))
}
export function makePng(color: [number, number, number, number]): Buffer {
	const chunk = (name: string, data: Buffer) => {
		const type = Buffer.from(name)
		const header = Buffer.alloc(4); header.writeUInt32BE(data.length)
		const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(Buffer.concat([type, data])))
		return Buffer.concat([header, type, data, checksum])
	}
	const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(16, 0); ihdr.writeUInt32BE(16, 4); ihdr[8] = 8; ihdr[9] = 6
	const pixels = Buffer.alloc(16 * (16 * 4 + 1))
	for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) for (let c = 0; c < 4; c++) pixels[y * 65 + 1 + x * 4 + c] = color[c]
	return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))])
}
export const png = makePng([32, 220, 64, 255])
export const cube: ModelJson = { textures: { all: 'demo:block/casing' }, elements: [{ from: [0, 0, 0], to: [16, 16, 16], faces: Object.fromEntries(['up', 'down', 'north', 'south', 'east', 'west'].map(face => [face, { texture: '#all', cullface: face }])) }] }
export function instance(directory: string, mods: string[] = [], resourcePacks: string[] = []): MinecraftInstance { return { id: directory, directory, name: 'Fixture', launcher: 'Custom', loader: 'Fabric', version: '1.20.1', mods, resourcePacks, clientJars: [] } }
export const resources = {
	'assets/demo/blockstates/casing.json': JSON.stringify({ variants: { '': { model: 'demo:block/casing' } } }),
	'assets/demo/models/block/casing.json': JSON.stringify({ parent: 'other:block/base', textures: { all: 'demo:block/casing' } }),
	'assets/other/models/block/base.json': JSON.stringify(cube),
	'assets/demo/textures/block/casing.png': png,
}
