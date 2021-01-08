export class NbtPath {
  private arr: (string | number)[]

	constructor(arr: (string | number)[] = []) {
		this.arr = arr;
  }

	public pop(count = 1) {
		return new NbtPath(this.arr.slice(0, -count))
  }

  public push(...el: (string | number)[]) {
		return new NbtPath([...this.arr, ...el])
  }

	public last() {
		return this.arr[this.arr.length - 1]
  }

	public length() {
		return this.arr.length
  }

	public toString() {
		return this.arr
			.map(e => (typeof e === 'string') ? `.${e}` : `[${e}]`)
			.join('')
			.replace(/^\./, '')
	}
}
