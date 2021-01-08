import { RegionEditor } from "./RegionEditor";
import { Structure3D } from "./Structure3D";
import { TreeEditor } from "./TreeEditor";

declare function acquireVsCodeApi(): any
const vscode = acquireVsCodeApi();

export interface Editor {
  onUpdate(data: any): Promise<void>
}

let nbtData: any
let editor: Editor | null = null

main()

function main() {

  window.addEventListener('message', async e => {
		const { type, body, requestId } = e.data;
		switch (type) {
			case 'init':
				if (body.structure) {
					editor = new Structure3D()
				} else if (body.content.anvil) {
					editor = new RegionEditor()
				} else {
					editor = new TreeEditor()
				}
				editor.onUpdate(body.content)
				return;

			case 'update':
        editor?.onUpdate(body.content)
				return;

			case 'getFileData':
				vscode.postMessage({ type: 'response', requestId, body: nbtData });
				return;
		}
  });

  vscode.postMessage({ type: 'ready' })
}
