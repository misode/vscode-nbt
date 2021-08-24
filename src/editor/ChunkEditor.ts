import type { NamedNbtTag } from 'deepslate'
import { getListTag, getOptional, getTag, Structure } from 'deepslate'
import { StructureEditor } from './StructureEditor'
import { toBigInt } from './Util'

export class ChunkEditor extends StructureEditor {
	
	protected updateStructure(data: NamedNbtTag) {
		this.gridActive = false
		this.data = data
		const level = getTag(this.data.value, 'Level', 'compound')
		const sections = getListTag(level, 'Sections', 'compound')

		const height = sections.length - 2

		this.structure = new Structure([16, height * 16, 16])
		for (const section of sections) {
			if (!section['Palette'] || !section['BlockStates']) {
				continue
			}
			const yOffset = getTag(section, 'Y', 'byte') * 16
			const palette = getListTag(section, 'Palette', 'compound')
			const blockStates = getTag(section, 'BlockStates', 'longArray')

			const bits = Math.max(4, Math.ceil(Math.log2(palette.length)))
			const bitMask = BigInt(Math.pow(2, bits) - 1)
			const perLong = Math.floor(64 / bits)

			let i = 0
			let data = BigInt(0)
			for (let j = 0; j < 4096; j += 1) {
				if (j % perLong === 0) {
					data = toBigInt(blockStates[i])
					i += 1
				}
				const index = Number((data >> BigInt(bits * (j % perLong))) & bitMask)
				const state = palette[index]
				if (state) {
					const pos: [number, number, number] = [j & 0xF, yOffset + (j >> 8), (j >> 4) & 0xF]
					const name = getTag(state, 'Name', 'string')
					const properties = Object.fromEntries(
						Object.entries(getOptional(() => getTag(state, 'Properties', 'compound'), {}))
							.filter(([_, v]) => v.type === 'string')
							.map(([k, v]) => [k, v.value as string]))
					this.structure.addBlock(pos, name, properties)
				}
			}
		}

		this.renderer.setStructure(this.structure)
		this.renderer2.setStructure(this.structure)
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
