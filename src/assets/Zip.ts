import { createReadStream, promises as fs } from 'fs'
import { Readable } from 'stream'
import * as yauzl from 'yauzl'

// Cache only the central directory while indexing. JAR payloads remain on disk
// and are streamed selectively; thousands of metadata reads become one read.
export async function openArchive(file: string, cacheDirectory = true): Promise<yauzl.ZipFile> {
	const plain = () => new Promise<yauzl.ZipFile>((resolve, reject) => yauzl.open(file, { lazyEntries: true, autoClose: false, validateEntrySizes: true }, (error, zip) => error || !zip ? reject(error ?? new Error('Cannot open ZIP')) : resolve(zip)))
	if (!cacheDirectory) return plain()
	const handle = await fs.open(file, 'r')
	let central: Buffer | undefined
	let offset = 0
	let size = 0
	try {
		size = (await handle.stat()).size
		const length = Math.min(size, 65557)
		const tail = Buffer.alloc(length)
		await handle.read(tail, 0, length, size - length)
		for (let i = length - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50 && i + 22 + tail.readUInt16LE(i + 20) === length) {
			const bytes = tail.readUInt32LE(i + 12)
			offset = tail.readUInt32LE(i + 16)
			if (bytes <= 16 * 1024 * 1024 && offset + bytes <= size && offset !== 0xffffffff) {
				central = Buffer.alloc(bytes)
				await handle.read(central, 0, bytes, offset)
			}
			break
		}
	} finally { await handle.close() }
	if (!central) return plain()
	const directory = central
	class Reader extends yauzl.RandomAccessReader {
		private reads = 0
		read(buffer: Buffer, target: number, length: number, position: number, callback: (error: Error | null, bytesRead?: number) => void): void {
			if (position >= offset && position + length <= offset + directory.length) {
				directory.copy(buffer, target, position - offset, position - offset + length)
				if (++this.reads % 256 === 0) setImmediate(() => callback(null, length))
				else queueMicrotask(() => callback(null, length))
			} else super.read(buffer, target, length, position, callback)
		}
		_readStreamForRange(start: number, end: number): Readable {
			return start >= offset && end <= offset + directory.length ? Readable.from([directory.subarray(start - offset, end - offset)]) : createReadStream(file, { start, end: end - 1 })
		}
		_close(callback: (error?: Error | null) => void): void { callback() }
	}
	return new Promise((resolve, reject) => yauzl.fromRandomAccessReader(new Reader(), size, { lazyEntries: true, autoClose: false, validateEntrySizes: true }, (error, zip) => error || !zip ? reject(error ?? new Error('Cannot open ZIP')) : resolve(zip)))
}
