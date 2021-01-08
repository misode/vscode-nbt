import { Structure } from "@webmc/core"
import { StructureRenderer } from "@webmc/render"
import { ResourceManager } from "./ResourceManager";

declare function acquireVsCodeApi(): any
declare const stringifiedAssets: string
const vscode = acquireVsCodeApi();

const structure = new Structure([1, 1, 1])

main()

async function main() {

  
  const canvas = document.querySelector('.structure-3d') as HTMLCanvasElement
  const gl = canvas.getContext('webgl');
  
  if (!gl) {
    throw new Error('Unable to initialize WebGL. Your browser or machine may not support it.')
  }
  
  const assets = JSON.parse(stringifiedAssets)
  const resources = new ResourceManager()
  const img = (document.querySelector('.block-atlas') as HTMLImageElement)
  resources.loadBlockDefinitions(assets.blockstates)
  resources.loadBlockModels(assets.models)
  resources.loadBlockAtlas(img, assets.textures)

  const blockAtlas = resources.getBlockAtlas()
  console.log(blockAtlas.getUV('block/acacia_door_bottom'))

  // @ts-ignore
  let renderer = new StructureRenderer(gl, resources, resources, blockAtlas, structure)

  let xRotation = 0.8
  let yRotation = 0.5
  let viewDist = 4.0

  function render() {
    yRotation = yRotation % (Math.PI * 2)
    xRotation = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, xRotation))
    viewDist = Math.max(1, Math.min(20, viewDist))
    renderer.drawStructure(xRotation, yRotation, viewDist);
  }
  requestAnimationFrame(render);

  
  let dragPos: [number, number] | null = null
  canvas.addEventListener('mousedown', evt => {
    dragPos = [evt.clientX, evt.clientY]
  })
  canvas.addEventListener('mousemove', evt => {
    if (dragPos) {
      yRotation += (evt.clientX - dragPos[0]) / 100
      xRotation += (evt.clientY - dragPos[1]) / 100
      dragPos = [evt.clientX, evt.clientY]
      requestAnimationFrame(render);
    }
  })
  canvas.addEventListener('mouseup', () => {
    dragPos = null
  })
  canvas.addEventListener('wheel', evt => {
    viewDist += evt.deltaY / 100
    requestAnimationFrame(render);
  })

  window.addEventListener('resize', () => {
    const displayWidth = canvas.clientWidth;
    const displayHeight = canvas.clientHeight;

    if (canvas.width !== displayWidth || canvas.height !== displayHeight) {
      canvas.width = displayWidth;
      canvas.height = displayHeight;

      renderer.setViewport(0, 0, canvas.width, canvas.height)
      requestAnimationFrame(render);
    }
  })


  let nbtData: any

  async function setData(data: any) {
    nbtData = data
    const structure = await Structure.fromNbt(data.data)
    // @ts-ignore
    renderer = new StructureRenderer(gl, resources, resources, blockAtlas, structure)
    requestAnimationFrame(render)
  }

  async function getData() {
    return nbtData
  }

  window.addEventListener('message', async e => {
		const { type, body, requestId } = e.data;
		switch (type) {
			case 'init':
        setData(body.content)
				return;

			case 'update':
        setData(body.content)
				return;

			case 'getFileData':
				getData().then(data => {
					vscode.postMessage({ type: 'response', requestId, body: data });
				});
				return;
		}
  });
  
  vscode.postMessage({ type: 'ready' })
}
