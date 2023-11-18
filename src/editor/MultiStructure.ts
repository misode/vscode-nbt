import { BlockPos, PlacedBlock, Structure, StructureProvider } from "deepslate";

export type StructureRegion = {
	pos: BlockPos,
	structure: StructureProvider,
	name?: string,
}

export class MultiStructure implements StructureProvider {
	constructor(
		private readonly size: BlockPos,
		private readonly regions: StructureRegion[],
	) {}

	getSize(): BlockPos {
		return this.size
	}

	getBlock(pos: BlockPos): PlacedBlock | null {
		for (const region of this.regions) {
			if (MultiStructure.posInRegion(pos, region)) {
				const block = region.structure.getBlock(BlockPos.subtract(pos, region.pos))
				if (block !== null) {
					return block
				}
			}
		}
		return null
	}

	getBlocks(): PlacedBlock[] {
		return this.regions.flatMap(r => {
			try {
				return r.structure.getBlocks().map(b => ({
					pos: BlockPos.add(r.pos, b.pos),
					state: b.state,
					...b.nbt ? { nbt: b.nbt } : {},
				}))
			} catch (e) {
				if (e instanceof Error) {
					console.log((r.structure as Structure)['blocks'])
					e.message = e.message.replace(' in structure ', ` in structure region "${r.name}" `)
				}
				throw e
			}
		})
	}

	private static posInRegion(pos: BlockPos, region: StructureRegion) {
		const size = region.structure.getSize()
		return pos[0] >= region.pos[0] && pos[0] < region.pos[0] + size[0]
			&& pos[1] >= region.pos[1] && pos[1] < region.pos[1] + size[1]
			&& pos[2] >= region.pos[2] && pos[2] < region.pos[2] + size[2]
	}
}
