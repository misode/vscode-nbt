import { EditorPanel } from "./Editor";

export class RegionEditor implements EditorPanel {
  constructor(private root: Element) {}

  reveal() {
    this.root.innerHTML =
      `<div class="center">
        <span class="error">Region editor is not yet supported.</span>
      </div>`
  }

  update() {}
}
