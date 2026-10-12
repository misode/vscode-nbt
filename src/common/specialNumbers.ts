import { NbtType } from 'deepslate'

const SPECIAL_NUMBERS: Record<string, number> = {
	NaN: Number.NaN,
	Infinity: Number.POSITIVE_INFINITY,
	'-Infinity': Number.NEGATIVE_INFINITY,
}

/**
 * VS Code webview messages are JSON. JSON has no NaN or Infinity, so those
 * floats would arrive as null and be read back as 0. Encode them as strings
 * before posting, and decode them only on float and double tags.
 */
export function encodeSpecialNumbers<T>(value: T): T {
	if (typeof value === 'number') {
		if (Number.isNaN(value)) return 'NaN' as unknown as T
		if (value === Number.POSITIVE_INFINITY) return 'Infinity' as unknown as T
		if (value === Number.NEGATIVE_INFINITY) return '-Infinity' as unknown as T
		return value
	}
	if (Array.isArray(value)) {
		let changed = false
		const next = value.map(item => {
			const encoded = encodeSpecialNumbers(item)
			if (encoded !== item) changed = true
			return encoded
		})
		return (changed ? next : value) as unknown as T
	}
	if (value !== null && typeof value === 'object') {
		const entries = Object.entries(value as Record<string, unknown>)
		let changed = false
		const next: Record<string, unknown> = {}
		for (const [key, item] of entries) {
			const encoded = encodeSpecialNumbers(item)
			if (encoded !== item) changed = true
			next[key] = encoded
		}
		return (changed ? next : value) as T
	}
	return value
}

export function decodeSpecialNumbers<T>(value: T): T {
	return decodeNode(value) as T
}

function decodeNode(value: unknown): unknown {
	if (Array.isArray(value)) {
		let changed = false
		const next = value.map(item => {
			const decoded = decodeNode(item)
			if (decoded !== item) changed = true
			return decoded
		})
		return changed ? next : value
	}
	if (value === null || typeof value !== 'object') return value

	const record = value as Record<string, unknown>
	const numeric = record.type === NbtType.Float || record.type === NbtType.Double
	let changed = false
	const next: Record<string, unknown> = {}
	for (const [key, item] of Object.entries(record)) {
		const decoded = numeric && (key === 'value' || key === 'items')
			? decodeNumeric(item)
			: decodeNode(item)
		if (decoded !== item) changed = true
		next[key] = decoded
	}
	return changed ? next : value
}

function decodeNumeric(value: unknown): unknown {
	if (typeof value === 'string' && value in SPECIAL_NUMBERS) {
		return SPECIAL_NUMBERS[value]
	}
	if (Array.isArray(value)) {
		let changed = false
		const next = value.map(item => {
			const decoded = typeof item === 'string' && item in SPECIAL_NUMBERS
				? SPECIAL_NUMBERS[item]
				: decodeNode(item)
			if (decoded !== item) changed = true
			return decoded
		})
		return changed ? next : value
	}
	return decodeNode(value)
}
