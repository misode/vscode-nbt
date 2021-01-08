import { Editor } from "./Editor";

export class RegionEditor implements Editor {

  constructor() {
    document.querySelector('.nbt-editor').innerHTML =
      `<div class="nbt-center">
        <span class="nbt-error">Region editor is not yet supported.</span>
      </div>`
  }

  public async onUpdate(data: any) {}
}
