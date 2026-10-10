# Reproducible verification

`npm test` runs real filesystem/ZIP and Deepslate mesh tests. ZIP fixtures are created in temporary directories, read through yauzl, and cleaned up afterward. They contain standard assets in multiple namespaces and deliberately malformed inputs. They do not redistribute proprietary mod textures.

Coverage includes launcher roots on all three platforms, Prism metadata, enabled pack selection, loader metadata for Forge/NeoForge/Fabric/Quilt, compressed JAR indexing, cross-namespace parents, ZIP/directory overrides, empty-key and property variants, deterministic weighted choices, multipart AND/OR, child texture overrides, texture aliases and sprite objects, cycles, custom loaders, UV rotation/locking, element rescale, missing textures/models, malformed JSON, path traversal, decompression limits, cache invalidation, cancellation and independent cached geometry.

`npm run build` builds the actual extension and webview. `npm run test:render` serves `out/editor.js` to a real Chromium/Edge WebGL context with the webview CSP. The test replaces only the VS Code message transport; the production editor, NBT classes, ResourceIndex, ResourceManager and renderer run unchanged. Its NBT structure contains vanilla stone, a modded casing, a rotated non-cubic pipe, slab, multipart model, missing block and custom-loader fallback. It checks colored pixels in the screenshot, GPU errors, search, the vanilla toggle and reload notifications. The screenshot is written to `test-results/`.

For Playwright's downloaded Chromium on Windows PowerShell:

```powershell
$env:NBT_BROWSER_CHANNEL = 'chromium'
npx playwright install chromium
npm run test:render
```

Linux/macOS use Playwright Chromium by default; run its browser install command first. Browser tests use software WebGL for reproducibility. These synthetic fixtures verify standard asset behavior, not complete compatibility with real versions of Create, Mekanism, Thermal or AE2. Live launcher detection outside Windows and a representative real modpack remain useful additional manual validation.

Manual extension check after installing the VSIX:

1. Select a Minecraft instance or a test folder containing a `mods/` directory.
2. Open vanilla and modded `.nbt` / schematic structures. Confirm camera controls, block selection, properties and tree/SNBT editing.
3. Edit a resource pack texture, reload assets, and confirm the model changes without closing the structure.
4. Switch instances and inspect the NBT Resources tree and diagnostic output.
5. Verify runtime-only blocks are clearly labeled as fallback geometry.

Development uses Node 22+ and the checked-in lockfile. The runtime's tar parser and tooling were updated because the upstream lockfile had known vulnerabilities. No archive extraction is used for mod assets. No Marketplace publication is part of the workflow.
