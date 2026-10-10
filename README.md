# NBT Viewer
VSCode extension to view Minecraft NBT files. For structure files, this shows a 3D block view.

This fork extends [Misode's NBT Viewer](https://github.com/misode/vscode-nbt) with local Minecraft instance, mod JAR and resource pack assets in its existing 3D viewer. Upstream NBT editing and supported file formats remain available. Requires VS Code 1.85 or later.

## Select an instance

1. Open the Command Palette and run **NBT Viewer: Select Minecraft Instance**.
2. Choose a discovered installation or **Browse for a Minecraft instance…**. Select the launcher instance folder or its `.minecraft` / `minecraft` directory.
3. Open a structure and use its existing **3D** panel. Models and textures load from that instance.

Discovery checks common Official Launcher, CurseForge, Prism Launcher, MultiMC, ATLauncher, Modrinth App and GDLauncher roots on Windows, Linux and macOS. Custom/portable locations can be added to `nbtViewer.instancePaths`. Forge, NeoForge, Fabric and Quilt metadata is detected where available. Ambiguous mod metadata is reported rather than inventing a loader.

Opening an NBT document asks for a modpack only when no pack is selected (`nbtViewer.askForInstanceOnOpen: whenMissing`, the default). Selections are remembered privately for the current workspace and survive VS Code restarts. Other workspaces can use different packs. Use **Select Minecraft Instance** to switch the current workspace's pack. Set the prompt option to `always` to ask on every open, or `never` to skip prompting. An existing explicit `always` setting remains honored; change it to `whenMissing` to reuse your selection. Cancel keeps the selected pack. Workspace settings for `nbtViewer.selectedInstance` / `selectedVersion` override the remembered selection; existing user settings remain a fallback. Without an open workspace, selections are saved in user settings. No Minecraft files are written.

## Resource packs and controls

Enabled packs are read from the instance's `options.txt`. Additional ZIP/directory packs can be added to `nbtViewer.resourcePacks`. Priority from low to high: local vanilla client archive, installed mod JARs in sorted filename order, enabled resource packs in `options.txt` order, additional packs in settings order. Last asset wins. Upstream versioned vanilla assets fill gaps where a local client JAR is unavailable.

Use **Modded assets** to toggle vanilla-only rendering, **Reload assets** to refresh the open structure, and the block search box to outline matching namespaces/IDs (first 200 matches). Click a block to inspect its ID, NBT blockstate properties and missing-model warnings. Camera/navigation controls remain upstream's: drag left to rotate, drag middle/right to pan, wheel to zoom, WASD plus Space/Shift to move.

The Explorer **NBT Resources** panel shows selected instance/version/loader, mod count, namespaces, packs, indexing status, cache counters and host resource errors. Browser model/texture failures are included in **NBT Viewer: Show Resource Diagnostics** and the structure status. Commands also include **Scan Installed Mods**, **Reload Modded Resources**, and **Clear Asset Cache**. File watchers invalidate changed archives and packs; manual reload rescans metadata and sources.

## Build an NBT structure

Run **NBT Viewer: New NBT Structure** from the Command Palette, choose the Minecraft version and save the new file. The **New NBT structure** button in an existing 3D view reuses that file's data version. New structures start at 16 × 16 × 16; edit **Size** in the viewer to change the bounds.

Open **Build** in the 3D view. Search the selected instance's block IDs or filter by namespace, choose a block and set its available properties. **Place** adds a block against the face you click, or on the floor of an empty structure. **Replace** changes the clicked block and **Erase** removes it. Coordinates also let you set or remove a specific position. **Select** returns to inspection. Save with **Ctrl+S**, undo with **Ctrl+Z**, and redo through VS Code's usual command.

The list combines vanilla registry blocks with the selected pack's indexed blockstates, including AE2 cable brushes with initialized cable-bus NBT. Mod property choices come from static blockstate assets and may omit properties used only by game logic. Other block entities do not receive automatically generated inventories or machine configuration. Build tools edit Java structure NBT with one palette; schematic, region and multiple-palette files retain their existing viewers and editors.

Click the scene to enable movement keys. Movement and dragging stop when focus leaves the canvas, the viewer is hidden, or a pointer gesture is cancelled, so typing in the block search does not move the camera.

Block searches reuse the last filtered result across pages, and recently loaded mod property choices are cached (64 blocks). Changing resources clears the selected brush and cached choices. Identical placements leave the document and undo history untouched. Existing AE2 cable configuration is preserved when recolouring. Picking resolves framebuffer coordinate rounding using the click ray, including high coordinates.

## Supported assets and limitations

Standard `assets/<namespace>/blockstates/*.json`, `models/**/*.json`, and `textures/**/*.png` are indexed directly from JAR/ZIP archives or directory packs without bulk extraction. Cross-namespace references, parent overrides, variants, weighted choices and multipart models are supported. Static models from mod ecosystems use the same path.

AE2 cable buses have an NBT-aware adapter for glass, covered, smart and dense cables, including colors and saved connections. Ordinary world saves can omit visual data; the adapter then infers compatible cable neighbours. Supported attachments include import/export/storage buses, interfaces, pattern providers, terminals, cable anchors, quartz fiber and energy acceptors. Facades, exact machine connections, smart-channel overlays and unknown part formats remain incomplete and are diagnosed. Tested against AE2 Forge 15.4.10 on Minecraft 1.20.1; this is not a promise of every AE2 release.

The archive scanner buffers bounded central-directory metadata and reuses unchanged archive indexes and payloads in the current extension session. A local 390-mod pack with 142,728 indexed resources took approximately 1.8 seconds to index and 0.3 seconds to reload unchanged, versus 26–29 seconds in 0.10.0. These are local measurements, not guaranteed timings; rendering and vanilla downloads are separate.

Custom loaders, Java renderers and runtime-generated geometry need adapters and are not universally supported. Unsupported models display a checkerboard cube and diagnostics. See [the compatibility matrix and limits](docs/COMPATIBILITY.md). No modpack files or resources are uploaded; the original vanilla mcmeta downloads remain the only asset-related network behavior.

## Troubleshooting

- Instance missing: browse directly, or add a launcher root to `nbtViewer.instancePaths`.
- Incorrect version: set `nbtViewer.selectedVersion` to the installed version/profile and reload.
- Checkerboard block: inspect Resource Diagnostics for missing assets, unsupported loaders, malformed JSON, inheritance cycles or atlas capacity. A runtime renderer cannot be reconstructed just by selecting an instance.
- Pack not applied: enable it in Minecraft or add its absolute ZIP/directory path to `nbtViewer.resourcePacks`, then reload. Higher priority overrides lower priority.
- Stale resources: run **Reload Modded Resources** or **Clear Asset Cache**.
- Initial vanilla download failed: the upstream mcmeta fallback needs connectivity once. Cached vanilla assets and local mod resources are reused locally.

## Development, tests and local installation

Use Node.js 22+ for development and the lockfile:

```sh
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npx playwright install chromium
npm run test:render
npm run package
```

On Windows browser tests default to installed Edge; set `NBT_BROWSER_CHANNEL=chromium` to use Playwright Chromium. `npm run dev` watches the two existing Rollup entry points. Run the extension in a VS Code Extension Development Host using this folder.

Packaging produces `vscode-nbt-0.11.2.vsix`. In VS Code run **Extensions: Install from VSIX…**, choose the file, reload VS Code, then select an instance. Disable the upstream NBT Viewer while testing this fork because the editor ID is intentionally preserved. Packaging does not publish to the Marketplace. This fork is not an official upstream release.

See [implementation notes](docs/IMPLEMENTATION.md) and [reproducible test fixtures](docs/TESTING.md). The MIT license and upstream attribution are retained.

![](https://user-images.githubusercontent.com/17352009/104337363-b4aeb000-54f5-11eb-93a2-47ce2e3e4fea.png)

## Credits

* [AmberW](https://github.com/AmberWat) for the NBT icons
* [SPGoding](https://github.com/SPGoding) for the downloading and caching logic from [Spyglass](https://github.com/SpyglassMC/Spyglass)

## Disclaimer
While this extension has been tested, it can technically corrupt your files. Always be careful and backup important files.
