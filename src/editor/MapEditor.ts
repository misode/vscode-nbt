import type { NamedNbtTag } from 'deepslate'
import { getTag } from 'deepslate'
import type { NbtEdit } from '../common/types'
import type { EditHandler, EditorPanel, VSCode } from './Editor'

export class MapEditor implements EditorPanel {
	protected data: NamedNbtTag

	constructor(protected root: Element, protected vscode: VSCode, protected editHandler: EditHandler, protected readOnly: boolean) {
		this.data = { name: '', value: {} }
	}

	reveal() {
		const content = document.createElement('div')
		content.classList.add('nbt-content')
		const canvas = document.createElement('canvas')
		canvas.classList.add('nbt-map')
		canvas.width = 128
		canvas.height = 128
		const ctx = canvas.getContext('2d')!
		this.paint(ctx)
		content.append(canvas)
		this.root.append(content)
	}

	onInit(data: NamedNbtTag) {
		this.data = data
	}

	onUpdate(data: NamedNbtTag, edit: NbtEdit) {
		this.onInit(data)
	}

	private paint(ctx: CanvasRenderingContext2D) {
		const img = ctx.createImageData(128, 128)
		const data = getTag(this.data.value, 'data', 'compound')
		const colors = getTag(data, 'colors', 'byteArray')
		for (let x = 0; x < 128; x += 1) {
			for (let z = 0; z < 128; z += 1) {
				const id = ((colors[x + z * 128] ?? 0) + 256) % 256
				const base = colorIds[id >> 2] ?? [0, 0, 0]
				const m = multipliers[id & 0b11] ?? 1
				const color = [base[0] * m, base[1] * m, base[2] * m]
				const i = x * 4 + z * 4 * 128
				img.data[i] = color[0]
				img.data[i+1] = color[1]
				img.data[i+2] = color[2]
				img.data[i+3] = id < 4 ? 0 : 255
			}
		}
		ctx.putImageData(img, 0, 0)
	}
}

const multipliers = [
	0.71,
	0.86, 
	1,
	0.53,
]

const colorIds = [
	[0, 0, 0],
	[127, 178, 56],
	[247, 233, 163],
	[199, 199, 199],
	[255, 0, 0],
	[160, 160, 255],
	[167, 167, 167],
	[0, 124, 0],
	[255, 255, 255],
	[164, 168, 184],
	[151, 109, 77],
	[112, 112, 112],
	[64, 64, 255],
	[143, 119, 72],
	[255, 252, 245],
	[216, 127, 51],
	[178, 76, 216],
	[102, 153, 216],
	[229, 229, 51],
	[127, 204, 25],
	[242, 127, 165],
	[76, 76, 76],
	[153, 153, 153],
	[76, 127, 153],
	[127, 63, 178],
	[51, 76, 178],
	[102, 76, 51],
	[102, 127, 51],
	[153, 51, 51],
	[25, 25, 25],
	[250, 238, 77],
	[92, 219, 213],
	[74, 128, 255],
	[0, 217, 58],
	[129, 86, 49],
	[112, 2, 0],
	[209, 177, 161],
	[159, 82, 36],
	[149, 87, 108],
	[112, 108, 138],
	[186, 133, 36],
	[103, 117, 53],
	[160, 77, 78],
	[57, 41, 35],
	[135, 107, 98],
	[87, 92, 92],
	[122, 73, 88],
	[76, 62, 92],
	[76, 50, 35],
	[76, 82, 42],
	[142, 60, 46],
	[37, 22, 16],
	[189, 48, 49],
	[148, 63, 97],
	[92, 25, 29],
	[22, 126, 134],
	[58, 142, 140],
	[86, 44, 62],
	[20, 180, 133],
	[100, 100, 100],
	[216, 175, 147],
	[127, 167, 150],
]
