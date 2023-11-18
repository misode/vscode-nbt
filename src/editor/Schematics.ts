import { BlockPos, BlockState, NbtCompound, NbtType, Structure } from "deepslate";
import { MultiStructure, StructureRegion } from "./MultiStructure";

export function spongeToStructure(root: NbtCompound) {
	const width = root.getNumber('Width')
	const height = root.getNumber('Height')
	const length = root.getNumber('Length')

	const schemPalette = root.getCompound('Palette')
	const palette: BlockState[] = []
	for (const key of schemPalette.keys()) {
		const id = schemPalette.getNumber(key)
		const stateStart = key.indexOf('[')
		if (stateStart === -1) {
			palette[id] = new BlockState(key)
		} else {
			const blockId = key.substring(0, stateStart)
			const states = key.substring(stateStart + 1, key.length - 1).split(',')
			const properties = Object.fromEntries(states.map(e => e.split('=') as [string, string]))
			palette[id] = new BlockState(blockId, properties)
		}
	}

	const blockData = root.getByteArray('BlockData')
	const blocks: { pos: BlockPos, state: number, nbt?: NbtCompound }[] = []
	let i = 0
	for (let x = 0; x < width; x += 1) {
		for (let z = 0; z < length; z += 1) {
			for (let y = 0; y < height; y += 1) {
				// TODO: support palettes larger than 128
				const id = blockData.get(i)?.getAsNumber() ?? 0
				i += 1
				blocks.push({
					pos: [x, y, z],
					state: id,
				})
			}
		}
	}
	
	return new Structure([width, height, length], palette, blocks)
}

export function litematicToStructure(root: NbtCompound) {
	function getTriple(tag: NbtCompound): BlockPos {
		return [tag.getNumber('x'), tag.getNumber('y'), tag.getNumber('z')]
	}
	const enclosingSize = root.getCompound('Metadata').getCompound('EnclosingSize')
	const [width, height, length] = getTriple(enclosingSize)

	const regions: StructureRegion[] = []
	root.getCompound('Regions').forEach((name, region) => {
		if (!region.isCompound()) return
		const pos = getTriple(region.getCompound('Position'))
		const size = getTriple(region.getCompound('Size'))
		for (let i = 0; i < 3; i += 1) {
			if (size[i] < 0) {
				pos[i] += size[i]
				size[i] = -size[i]
			}
		}
		const volume = size[0] * size[1] * size[2]
		const stretches = true

		const palette = region.getList('BlockStatePalette', NbtType.Compound).map(BlockState.fromNbt)
		const blockStates = region.getLongArray('BlockStates')
		const tempDataview = new DataView(new Uint8Array(8).buffer)
		const statesData = blockStates.map(long => {
			tempDataview.setInt32(0, Number(long.getAsPair()[0]))
			tempDataview.setInt32(4, Number(long.getAsPair()[1]))
			return tempDataview.getBigUint64(0)
		})

		const bits = Math.ceil(Math.log2(palette.length)) // unlike chunks, bits is not at least 4
		const bigBits = BigInt(bits)
		const big0 = BigInt(0)
		const big64 = BigInt(64)
		const bitMask = BigInt(Math.pow(2, bits) - 1)
		let state = 0
		let data = statesData[state]
		let dataLength = big64

		const arr: number[] = []
		for (let j = 0; j < volume; j += 1) {
			if (dataLength < bits) {
				state += 1
				let newData = statesData[state]
				if (newData === undefined) {
					console.error(`Out of bounds states access ${state}`)
					newData = big0
				}
				if (stretches) {
					data = (newData << dataLength) | data
					dataLength += big64
				} else {
					data = newData
					dataLength = big64
				}
			}

			let paletteId = Number(data & bitMask)
			if (paletteId > palette.length - 1) {
				console.error(`Invalid palette ID ${paletteId}`)
				paletteId = 0
			}
			arr.push(paletteId)
			data >>= bigBits
			dataLength -= bigBits
		}
		const blocks: { pos: BlockPos, state: number }[] = []
		for (let x = 0; x < size[0]; x += 1) {
			for (let y = 0; y < size[1]; y += 1) {
				for (let z = 0; z < size[2]; z += 1) {
					const index = (y * size[0] * size[2]) + z * size[0] + x
					blocks.push({ pos: [x, y, z], state: arr[index] })
				}
			}
		}
		const structure = new Structure(size, palette, blocks)
		regions.push({ pos, structure, name })
	})

	const minPos: BlockPos = [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]
	for (const region of regions) {
		for (let i = 0; i < 3; i += 1) {
			minPos[i] = Math.min(minPos[i], region.pos[i])
		}
	}
	for (const region of regions) {
		for (let i = 0; i < 3; i += 1) {
			region.pos[i] -= minPos[i]
		}
	}

	return new MultiStructure([width, height, length], regions)
}
