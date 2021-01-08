import * as AmdZip from "adm-zip"
import fetch from "node-fetch"
import * as fs from "fs"
import { PNG } from "pngjs";

generate()

async function generate() {
  const manifest = await (await fetch('https://launchermeta.mojang.com/mc/game/version_manifest.json')).json()
  const latestReleaseUrl = manifest.versions.find((v: any) => v.id === manifest.latest.release).url
  const version = await (await fetch(latestReleaseUrl)).json()
  const clientJarUrl = version.downloads.client.url
  const client = await (await fetch(clientJarUrl)).buffer()
  const zip = new AmdZip(client)
  const out = {
    blockstates: {} as any,
    models: {} as any,
    textures: {} as any
  }
  const textures: [string, Buffer][] = []

  await Promise.all(zip.getEntries().map(entry => {
    if (entry.entryName.startsWith('assets/minecraft/blockstates')) {
      return new Promise<void>(res => entry.getDataAsync(data => {
        out.blockstates[entry.name.replace(/\.json$/, '')] = JSON.parse(data.toString())
        res()
      }))
    }
    if (entry.entryName.startsWith('assets/minecraft/models/block')) {
      return new Promise<void>(res => entry.getDataAsync(data => {
        out.models['block/' + entry.name.replace(/\.json$/, '')] = JSON.parse(data.toString())
        res()
      }))
    }
    if (entry.entryName.startsWith('assets/minecraft/textures/block') && entry.name.endsWith('.png')) {
      return new Promise<void>(res => entry.getDataAsync(data => {
        textures.push([
          'block/' + entry.name.replace(/\.png$/, ''),
          data
        ])
        res()
      }))
    }
  }))

  const atlasSize = Math.pow(2, Math.ceil(Math.log(Math.sqrt(textures.length + 1))/Math.log(2)))
  const atlas = new PNG({ width: atlasSize * 16, height: atlasSize * 16, filterType: 4 })
  
  for (let y = 0; y < 16; y += 1) {
    for (let x = 0; x < 16; x += 1) {
      const i = (atlasSize * 16 * y + x) << 2;
      const c = ((x >> 3) + (y >> 3)) % 2
      atlas.data[i] = c * 255
      atlas.data[i + 1] = 0
      atlas.data[i + 2] = c * 255
      atlas.data[i + 3] = 255
    }
  }
  
  let index = 1
  textures.sort()
  await Promise.all(textures.map(async ([id, buffer]) => {
    const u = (index % atlasSize)
    const v = Math.floor(index / atlasSize)
    index += 1
    out.textures[id] = [u / atlasSize, v / atlasSize]

    return new Promise<void>(res => {
      new PNG().parse(buffer, function(err, png) {
        png.bitblt(atlas, 0, 0, 16, 16, u * 16, v * 16)
        res()
      })
    })
  }))

  await fs.promises.mkdir('./media/generated', { recursive: true })
  await fs.promises.writeFile('./media/generated/assets.js', `const stringifiedAssets = '${JSON.stringify(out)}'`)
  atlas.pack().pipe(fs.createWriteStream('./media/generated/atlas.png'))
}
