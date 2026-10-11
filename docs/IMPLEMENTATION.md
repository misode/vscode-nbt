# How the changes fit together

The extension still builds two Rollup entry points: the Node extension host and the browser editor. The existing NBT document and edit operations remain responsible for saves, undo and redo. This change adds resource loading and structure tools around that path.

## Instance selection

`src/assets/Instances.ts` reads launcher profiles, installed mods, client archives and enabled resource packs. `InstanceManager.ts` keeps the selected instance in VS Code's private workspace state. Explicit workspace settings override it. Opening another NBT file reuses the choice; the default prompt appears only when no instance is selected.

## Resources from multiple mods

`ResourceIndex.ts` indexes all selected archives into one resource map keyed by namespace and path. A model in one mod can inherit from another mod or refer to its textures. Later resource packs override earlier sources. The index reads ZIP central directories and opens payload streams only for requested blockstates, models and textures. Unchanged archives reuse their metadata and bounded payload cache. File changes invalidate those entries.

`Validation.ts` validates model data, resolves parents and texture aliases, and selects variant/multipart models. Signed quarter-turn rotations are normalized, so -90 and 270 have the same result. This fixes the rejection of Mekanism models such as the supercharged coil. Unknown custom loaders are diagnosed rather than treated as ordinary geometry.

## Geometry and transparent faces

`ResourceManager.ts` combines local resources with the existing versioned vanilla assets. `ModdedDefinition.ts` and `CachedModel.ts` generate Deepslate meshes with deterministic weighted choices, UV locking and cached geometry. Mod solid-face occlusion is conservative because static models do not provide the game's occlusion rules.

`ReloadableRenderer.ts` uses Deepslate's shaders and generated faces. It classifies faces from atlas alpha, draws opaque faces first, then sorts transparent faces by camera depth without writing depth. This prevents glass drawn early in the NBT block order from hiding rods and other interior geometry. GPU batches stay below the 16-bit index limit. Camera changes re-sort transparent faces; edits and atlas changes invalidate the batches. Picking keeps the original depth-writing pass.

## Connected textures

The host reads .png.mcmeta alongside each requested texture and loads referenced CTM sheets through the same resource map. `src/assets/ConnectedTextures.ts` validates CTM v1 metadata. `src/editor/ConnectedTextures.ts` subdivides a full, axis-aligned block face into four corners and chooses each corner from the base sprite or the 2×2 connected sheet. Connection checks use the face's rotated texture axes, adjacent and diagonal blocks, optional block/property groups, and the connect_inside rule. Position-dependent UV changes happen after copying cached geometry.

The Connected textures button toggles this behavior without editing NBT. Supported format: CTM v1 type CTM. Other layouts, proxies and arbitrary runtime texture systems are not covered. Cropped and non-axis-aligned faces keep their base textures. The layout is described by the [CTM project's format diagram](https://github.com/Chisel-Team/ConnectedTexturesMod/blob/1.21/dev/src/main/java/team/chisel/ctm/client/util/CTMLogic.java); the TypeScript implementation is written for this viewer.

## Structure editing and input

`StructureEditing.ts` creates single-palette Java structures and reversible block edits. `BlockBuilder.ts` lists vanilla blockstates and installed mod blocks, infers static property choices, and sends edits through the existing document operations. It supports placement against a face or at coordinates, replacement and erasing. Read-only files and unsupported formats reject writes. Propertyless vanilla blocks such as white concrete come from blockstate assets even when the property report omits them.

`StructureEditor.ts` owns the camera, build controls and resource refreshes. Losing focus or cancelling a pointer gesture clears movement/drag state. The picking correction resolves quantized framebuffer coordinates using the click ray.

## AE2 and the runtime boundary

`Ae2.ts` is a separate NBT adapter for cable-bus shapes and selected parts. It reads saved connections and cable data, then uses geometry from the installed archive. Ordinary static models from other mods do not depend on this adapter. Facades, channel effects, game-specific model loaders and Java block-entity renderers still require additional work; selecting a pack does not provide a Minecraft runtime.

See [TESTING.md](TESTING.md) for reproducible checks and [COMPATIBILITY.md](COMPATIBILITY.md) for limits.
