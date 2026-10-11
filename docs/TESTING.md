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

Linux/macOS use Playwright Chromium by default; run its browser install command first. Browser tests use software WebGL for reproducibility. Set `NBT_AE2_JAR` to an installed AE2 JAR to add real glass/smart cable geometry and an energy-acceptor attachment to the WebGL regression. This was exercised with AE2 Forge 15.4.10 on Minecraft 1.20.1. Unit fixtures also check saved connections, neighbour inference, colors, dense cable IDs, attachment rotations, and unchanged archive/payload cache reuse. These checks do not establish universal mod/version compatibility. Live launcher detection outside Windows remains additional manual validation.

On a local 390-mod installation, the 0.10.0 scanner took 26.5 seconds initially and 29.0 seconds on reload. The updated scanner indexed the same 142,728 resources in 1.8 seconds and reloaded unchanged in 0.3 seconds. Measurements cover resource indexing, not vanilla downloads or rendering, and benefit from the operating system's file cache.

Manual extension check after installing the VSIX:

The instance-selection regression runs the production InstanceManager against a mocked VS Code host. It checks repeated opens, persistence across extension sessions, independent workspaces, explicit workspace settings and switching, cancellation, all three prompt modes, legacy user settings and standalone-file fallback. Asset scanning is bypassed in this test so it focuses on selection persistence.

1. Select a Minecraft instance or a test folder containing a `mods/` directory.
2. Open vanilla and modded `.nbt` / schematic structures. Confirm camera controls, block selection, properties and tree/SNBT editing.
3. Edit a resource pack texture, reload assets, and confirm the model changes without closing the structure.
4. Switch instances and inspect the NBT Resources tree and diagnostic output.
5. Verify runtime-only blocks are clearly labeled as fallback geometry.

Structure building has eight additional unit tests covering blank gzip files, palette reuse, reversible placement/replacement/removal, block-entity preservation, AE2 cable initialization, input validation, property inference, catalog paging/invalidation, ray intersection and quantized position recovery. Five additional browser tests exercise the production Build panel: choose a mod block and properties, place by coordinates and floor/face clicks, save/reopen, undo/redo, erase and reject out-of-bounds positions; stop camera movement/dragging after focus loss or cancellation; prevent writes in read-only documents; reuse block options without extra host requests, skip identical edits and refresh after hidden pack changes; erase the actual block at coordinate 129 using the production GPU picking path.

For a manual build check, run **NBT Viewer: New NBT Structure**, select the Minecraft version and save it. Select the modpack, open **3D → Build**, search a block, and place it on the floor or at coordinates. Add a neighbour by clicking a face, replace/erase it, save and reopen, then undo/redo. Hold a movement key and click a control or switch applications: the camera should stop. Also verify editing is disabled for read-only and unsupported build formats.

Development uses Node 22+ and the checked-in lockfile. The runtime's tar parser and tooling were updated because the upstream lockfile had known vulnerabilities. No archive extraction is used for mod assets. No Marketplace publication is part of the workflow.

## Verification added after the initial submission

The renderer regression puts an opaque, narrow rod behind semi-transparent glass, with the glass listed first in NBT. Reversing the list must produce identical pixels. This test fails against the 0.11.3 bundle and passes with the sorted transparency pass. The CTM browser test toggles connected textures off and on, checks the rendered pixels change and return, and verifies the NBT stays unchanged.

The multi-archive unit regression uses two separate mod JARs. Blocks with the same path keep separate namespace IDs, one model inherits from the other archive, each retains its own texture, signed rotations normalize correctly, and an unchanged reload reuses both archive indexes. CTM tests cover six face directions, preserved winding, shared geometry, block/property groups, metadata validation and sheets supplied by another archive.

A local optional browser check exercises installed models from six mods together. Set NBT_MODS_DIR to the mods directory of a compatible Minecraft 1.21.1 installation:

```powershell
$env:NBT_MODS_DIR = 'C:\path\to\instance\mods'
$env:NBT_BROWSER_CHANNEL = 'chromium'
npm run test:render
```

The check selects ten block IDs, places them in one structure using the actual Build panel, waits for successful resource loading without warnings, and saves/reopens the NBT. It uses a minimal vanilla-parent fixture; it is not a complete test of the entire vanilla asset set. No installed mod assets are committed. The default CI run skips this optional check and runs the synthetic archive/WebGL fixtures.

| Installed archive exercised | Blocks checked |
| --- | --- |
| Create 6.0.9 / MC 1.21.1 | andesite_casing, shaft |
| Mekanism 10.7.18.84 / MC 1.21.1 | steel_casing, supercharged_coil, basic_induction_cell, basic_induction_provider |
| AE2 19.2.17 | quartz_block |
| Immersive Engineering 12.4.2-194 / MC 1.21.1 | storage_steel |
| Industrial Foregoing 3.6.38 / MC 1.21 | machine_frame_pity |
| Extreme Reactors 2.4.28 / MC 1.21.1 | reinforced_reactorfuelrod |

This demonstrates static asset loading across six mods and CTM induction connections. It does not establish support for every block in those mods. For example, Mekanism's energy_cube custom loader still reports a fallback; it is not passed off as a successful model. The older AE2 15.4.10 cable check remains separately reproducible with NBT_AE2_JAR.

The GitHub Actions workflow runs typechecks, lint, unit tests, production build, the default browser suite and VSIX packaging on Node 22. Local validation also ran the optional six-mod browser check.
