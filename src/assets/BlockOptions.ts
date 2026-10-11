import type { BlockOptions, BlockstateJson, Condition } from './Types'

export function blockOptions(id: string, state?: BlockstateJson): BlockOptions {
	const properties: Record<string, string[]> = Object.create(null)
	const defaults: Record<string, string> = Object.create(null)
	const add = (key: string, expression: string) => {
		if (!/^[a-z0-9_]+$/.test(key) || Object.keys(properties).length >= 128) return
		const values = expression.split('|').filter(v => /^[a-z0-9_.-]+$/.test(v) && v.length <= 128)
		properties[key] = [...new Set([...(properties[key] ?? []), ...values])].slice(0, 256)
		if (values.length && defaults[key] === undefined) defaults[key] = values[0]
	}
	for (const key of Object.keys(state?.variants ?? {})) for (const pair of key.split(',')) {
		const [name, value] = pair.split('=')
		if (value) add(name, value)
	}
	const condition = (value: Condition) => {
		for (const [key, expression] of Object.entries(value)) {
			if (Array.isArray(expression)) expression.forEach(condition)
			else add(key, expression)
		}
	}
	for (const part of state?.multipart ?? []) if (part.when) condition(part.when)
	return { id, properties, defaults }
}
