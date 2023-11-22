import type { NbtFile } from 'deepslate'
import { BlockState, NbtType, Structure } from 'deepslate'
import { vec3 } from 'gl-matrix'
import { StructureEditor } from './StructureEditor'

const VERSION_20w17a = 2529
const VERSION_21w43a = 2844

export class ChunkEditor extends StructureEditor {

	onInit(file: NbtFile) {
		this.updateStructure(file)
		vec3.copy(this.cPos, this.structure.getSize())
		vec3.mul(this.cPos, this.cPos, [-0.5, -1, -0.5])
		vec3.add(this.cPos, this.cPos, [0, 16, 0])
		this.cDist = 25
		this.showSidePanel()
		this.render()
	}

	protected loadStructure() {
		this.gridActive = false

		const dataVersion = this.file.root.getNumber('DataVersion')
		const N = dataVersion >= VERSION_21w43a
		const stretches = dataVersion < VERSION_20w17a

		const sections = N
			? this.file.root.getList('sections', NbtType.Compound)
			: this.file.root.getCompound('Level').getList('Sections', NbtType.Compound)

		const filledSections = sections.filter(section => {
			const palette = N
				? section.getCompound('block_states').getList('palette', NbtType.Compound)
				: section.has('Palette') && section.getList('Palette', NbtType.Compound)
			return palette &&
				palette.filter(state => state.getString('Name') !== 'minecraft:air')
					.length > 0
		})
		if (filledSections.length === 0) {
			throw new Error('Empty chunk')
		}
		const minY = 16 * Math.min(...filledSections.map(s => s.getNumber('Y')))
		const maxY = 16 * Math.max(...filledSections.map(s => s.getNumber('Y')))

		const K_palette = N ? 'palette' : 'Palette'
		const K_data = N ? 'data' : 'BlockStates'

		const structure = new Structure([16, maxY - minY + 16, 16])
		for (const section of filledSections) {
			const states = N ? section.getCompound('block_states') : section
			if (!states.has(K_palette) || !states.has(K_data)) {
				continue
			}
			const yOffset = section.getNumber('Y') * 16 - minY
			const palette = states.getList(K_palette, NbtType.Compound)
			const blockStates = states.getLongArray(K_data)
			const tempDataview = new DataView(new Uint8Array(8).buffer)
			const statesData = blockStates.map(long => {
				tempDataview.setInt32(0, Number(long.getAsPair()[0]))
				tempDataview.setInt32(4, Number(long.getAsPair()[1]))
				return tempDataview.getBigUint64(0)
			})

			const bits = Math.max(4, Math.ceil(Math.log2(palette.length)))
			const bigBits = BigInt(bits)
			const big64 = BigInt(64)
			const bitMask = BigInt(Math.pow(2, bits) - 1)
			let state = 0
			let data = statesData[state]
			let dataLength = big64

			for (let j = 0; j < 4096; j += 1) {
				if (dataLength < bits) {
					state += 1
					const newData = statesData[state]
					if (stretches) {
						data = (newData << dataLength) | data
						dataLength += big64
					} else {
						data = newData
						dataLength = big64
					}
				}
				const paletteId = data & bitMask
				const blockState = palette.get(Number(paletteId))
				if (blockState) {
					const pos: [number, number, number] = [j & 0xF, yOffset + (j >> 8), (j >> 4) & 0xF]
					const block = BlockState.fromNbt(blockState)
					structure.addBlock(pos, block.getName(), block.getProperties())
				}
				data >>= bigBits
				dataLength -= bigBits
			}
		}
		console.log(structure)
		return structure
	}

	menu() {
		return []
	}

	protected showSidePanel() {
		this.root.querySelector('.side-panel')?.remove()
		const block = this.selectedBlock ? this.structure.getBlock(this.selectedBlock) : null
		if (block) {
			super.showSidePanel()
		}
	}
}
