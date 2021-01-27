import { NamedNbtTag } from "@webmc/nbt";

export class NbtPath {
  private arr: (string | number)[]

  constructor(arr: (string | number)[] = []) {
    this.arr = arr;
  }

  public pop(count = 1) {
    return new NbtPath(this.arr.slice(0, -count))
  }

  public shift(count = 1) {
    return new NbtPath(this.arr.slice(count))
  }

  public push(...el: (string | number)[]) {
    return new NbtPath([...this.arr, ...el])
  }

  public head() {
    return this.arr[0]
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

  public getFrom(data: NamedNbtTag) {
    console.log(this.arr, data)
    let value = data.value as any
    let type = 'compound'

    for (const el of this.arr) {
      if (type === 'compound' && typeof el === 'string') {
        type = value[el].type
        value = value[el].value
      } else if (type === 'list' && typeof el === 'number') {
        type = value.type
        value = value.value[el]
      } else if (type.endsWith('Array') && typeof el === 'number') {
        type = type.slice(-5)
        value = value[el]
      } else {
        throw new Error(`Invalid path ${this.toString()}`)
      }
      if (value === undefined) {
        throw new Error(`Invalid path ${this.toString()}`)
      }
    }
    return { type, value }
  }
}
