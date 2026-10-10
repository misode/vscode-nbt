# Modded resource implementation

## Verified upstream architecture

- Rollup builds the Node extension (`src/extension.ts`) and browser editor (`src/editor/Editor.ts`) separately. TypeScript 4.4; Deepslate 0.26; WebGL 1.
- `NbtDocument` and the existing schematic converters preserve NBT editing, region, Bedrock, schematic, Sponge and Litematic support.
- `mcmeta.ts` downloads versioned vanilla block reports, JSON models and a texture atlas. `NbtEditor` serves them under the webview CSP.
- `StructureEditor` has two Deepslate renderers (visible geometry and picking), camera controls, block selection and property display.
- `ResourceManager` implements Deepslate's definition/model/atlas/flags providers. Deepslate supports elements, rotations, UVs, aliases and cull faces, but selects the first weighted variant, omits UV locking, and has unbounded inheritance/alias traversal.
- There were no upstream automated tests. Baseline production build and TypeScript check pass. Lint has one existing type-import warning in Operations.ts.
- Upstream issues #92, #88, #73 and #66 request mod/resource pack support. Existing unrelated parser issues are outside this change.

## Incremental plan

1. Discover launcher roots, instance metadata, loader, mods, vanilla client archives and ordered enabled resource packs. Keep reads local and non-destructive.
2. Index archive directories asynchronously using yauzl (central directory and selective streams, no bulk extraction). Bound sizes, paths, entry counts and caches; support directory resource packs without symlinks.
3. Load only requested blockstates, parent closure and texture dependencies. Route typed, bounded messages through NbtEditor, never filesystem paths from the webview.
4. Merge instance assets into the existing ResourceManager; safely flatten models, fix variants/weights/UV lock, render explicit missing-model cubes, retain Deepslate geometry and controls.
5. Add resource commands, settings, diagnostics tree, reload notifications, vanilla toggle and block search. Invalidate indexes after filesystem changes and reject obsolete requests.
6. Exercise discovery, archives, overrides, resolver, mesh generation and malformed inputs with local synthetic fixtures. Run lint, strict checks for new modules, tests, production build and VSIX packaging. Document static-format limits and actual verification.

## Compatibility boundary

JSON geometry can reconstruct static mod assets. Java renderers, runtime connected textures, block entities, OBJ/custom loaders and dynamically generated models require adapters and must be visibly diagnosed. No mod code is executed. Existing renderer uses face shading rather than Minecraft's full ambient occlusion. Animated PNGs use a static frame.
