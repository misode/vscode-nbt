# Resource compatibility and adapter boundary

The renderer uses assets, not a Minecraft game runtime. It never runs Java or JavaScript from mods.

| Resource type | Behavior |
| --- | --- |
| Standard blockstate variants and multipart | Property selection, logical AND/OR, deterministic weighted selection, block rotations, UV locking for axis-aligned faces |
| JSON models | Cross-namespace parents, texture aliases, multiple non-cubic elements, element rotations/rescale, UV rectangles/rotation, tint indices, face culling |
| PNG textures | Lazy selective loading, transparent cutout and alpha blending, first frame of vertically animated sprites |
| Forge/NeoForge/Fabric/Quilt installations | Loader discovery and static asset loading; assets themselves are loader-independent |
| Create, Mekanism, Thermal, AE2 | Standard JSON assets follow the same pipeline; this is not a claim that every block in these mods is supported |
| AE2 cable-bus NBT | Cable types/colors and saved connections; compatible cable neighbour inference when visual data is missing; selected static part attachments. Tested with AE2 Forge 15.4.10 / Minecraft 1.20.1 |
| Custom `loader` models (OBJ, composite, custom baked models) | Diagnosed and rendered with checkerboard fallback unless an adapter is registered |
| Runtime-generated models, connected textures, block entity renderers | Cannot be reconstructed from static assets; missing static geometry uses a fallback |

`ModelAdapter` in `src/assets/Validation.ts` has `id`, `supports(model)` and `convert(model)` methods. An adapter must return validated standard JSON geometry, and must not execute mod code. `flattenModels` accepts an adapter list. No generic custom-loader adapters are shipped. The separate AE2 NBT adapter in `src/assets/Ae2.ts` reads supported cable/part NBT and instantiates geometry from the selected JAR. It does not run Minecraft or mod code. Smart-channel lighting, facades, accurate machine-specific connection shapes, part spin and unsupported releases/part layouts remain incomplete.

Known renderer limits:

Build tools currently write single-palette Java structure NBT. The block list is based on static assets and vanilla registries, not a running game's complete block registry. Properties inferred from mod blockstates can omit game-only values. AE2 cable brushes initialize cable-bus data; other machine block entities require their own NBT configuration through the existing editor. Schematic, region and multiple-palette files retain their existing viewing/editing support.

- Face shading is inherited from Deepslate, not full Minecraft ambient occlusion. `ambientocclusion` is inherited but does not enable an AO algorithm.
- No biome/world-aware colors. Mod tint indices use the configurable RGB fallback; vanilla tints remain built in.
- Transparent faces blend using the existing chunk renderer; per-face back-to-front sorting is not implemented.
- Mod solid-face occlusion cannot be inferred reliably from assets; conservative flags prevent adjacent pipes/cables being incorrectly culled.
- No PBR, shaders, resource-pack format-specific overlays, animated texture timing, or `.mcmeta` frame order. Non-square unanimated sprites currently use the first square region.
- Texture atlases are bounded at 4096 square or the GPU limit, with overflow diagnosed. 8192 distinct block IDs, 2048 requested texture dependencies, 32 MiB serialized asset budget, 8 MiB individual resource limit, 2 MiB JSON limit, 64 levels of inheritance. PNG decoding is limited to 4 million pixels per image.
- Resource data uses a 64 MiB LRU cache. Geometry uses a separate bounded cache (2048 entries / 100000 faces). These are cache limits, not a promise of total process memory usage.
- Huge structures retain upstream's opt-in large-structure warning and synchronous mesh construction. Archive indexing and image decoding are asynchronous, but mesh generation can still pause a webview for a large structure.
- Portable or relocated launchers may need **Browse for a Minecraft instance** or `nbtViewer.instancePaths`.
- Fabric/Quilt nested dependency JARs and mod-internal ZIP resource packs are not recursively scanned. Only installed top-level JAR resources are indexed.
- KubeJS-generated assets need to be exposed as an additional directory resource pack; Java runtime generation is unsupported.
- Windows discovery and WebGL were exercised here. Linux/macOS discovery is covered by path fixtures, not live installations.
