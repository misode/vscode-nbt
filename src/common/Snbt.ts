import { fromBigInt, toBigInt } from '../editor/Util'

export class Snbt {

	static stringify(type: string, data: any, i: string = ''): string {
		const ii = i + '  '
		switch(type) {
			case 'compound': return Object.keys(data).length === 0 ? '{}'
				: `{\n${Object.entries<any>(data).map(([k, v]) =>
					`${ii}"${k}": ${Snbt.stringify(v.type, v.value, ii)}`
				).join(',\n')}\n${i}}`
			case 'list': return data.value.length === 0 ? '[]'
				: Snbt.isCompact(data.type)
					? `[${Snbt.stringifyEntries(data.type, data.value, '', ', ')}]`
					: `[\n${Snbt.stringifyEntries(data.type, data.value, ii, ',\n')}\n${i}]`
			case 'byteArray': return `[B;${Snbt.stringifyEntries('byte', data, ' ', ',')}]`
			case 'intArray': return `[I;${Snbt.stringifyEntries('int', data, ' ', ',')}]`
			case 'longArray': return `[L;${Snbt.stringifyEntries('long', data, ' ', ',')}]`
			case 'string': return `"${data.replace(/(\\|")/g, '\\$1')}"`
			case 'byte': return `${data}b`
			case 'double': return `${data}d`
			case 'float': return `${data}f`
			case 'short': return `${data}s`
			case 'int': return `${data}`
			case 'long': return `${Snbt.stringifyLong(data)}L`
			default: return 'null'
		}
	}

	static stringifyLong(value: [number, number]) {
		return `${toBigInt(value)}`
	}

	static parseLong(value: string): [number, number] {
		return fromBigInt(BigInt(value))
	}

	private static stringifyEntries(type: string, values: any[], ii: string, join: string) {
		return values.map(v =>
			`${ii}${Snbt.stringify(type, v, ii)}`
		).join(join)
	}

	private static isCompact(type: string) {
		return type === 'byte' || type === 'double' || type === 'float' || type === 'short' || type === 'int' || type === 'long'
	}
}
