import { vec3 } from 'gl-matrix'

const dec2hex = (dec: number) => ('0' + dec.toString(16)).substr(-2)

export function hexId(length = 12) {
	var arr = new Uint8Array(length / 2)
	window.crypto.getRandomValues(arr)
	return Array.from(arr, dec2hex).join('')
}

export function clamp(a: number, b: number, c: number) {
	return Math.max(b, Math.min(c, a))
}

export function clampVec3(a: vec3, b: vec3, c: vec3) {
	a[0] = clamp(a[0], b[0], c[0])
	a[1] = clamp(a[1], b[1], c[1])
	a[2] = clamp(a[2], b[2], c[2])
}

export function negVec3(a: vec3) {
	return vec3.fromValues(-a[0], -a[1], -a[2])
}

export function getInt(el: HTMLElement | null) {
	const value = parseInt((el as HTMLInputElement)?.value)
	return isNaN(value) ? undefined : value
}

const dataView = new DataView(new Uint8Array(8).buffer)

export function toBigInt(value: [number, number]): bigint {
	dataView.setInt32(0, Number(value[0]))
	dataView.setInt32(4, Number(value[1]))
	return dataView.getBigInt64(0)
}

export function fromBigInt(value: bigint): [number, number] {
	dataView.setBigInt64(0, value)
	return [dataView.getInt32(0), dataView.getInt32(4)]
}
