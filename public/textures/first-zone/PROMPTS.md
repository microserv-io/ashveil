# First-zone texture provenance

Generated on 6 September 2026 with the built-in `image_gen` tool; no CLI fallback.
All four images reference the project's existing
`website/assets/source/ember-and-bloom-world.png` for palette and painted surface
language only. That artwork's provenance is in `website/assets/source/README.md`.
The pastoral valley is a material-study assumption, not a settled zone map.

The tool returned 1254 × 1254 PNGs despite the requested 1024 × 1024 size.
These files preserve the returned pixels. They are base-color candidates, not
scanned PBR materials. Seamlessness requested in a prompt is not a guarantee;
inspect repeated surfaces before using them across a large terrain.

## meadow-grass.png

Use case: stylized-concept. Asset type: usable game environment base-color texture, SINGLE square 1024x1024 tile. Reference image is style/palette reference only, not edit target. Generate seamless tileable meadow grass ground albedo for Ashveil first pastoral valley material study. Full frame orthographic straight-down surface; soft painterly broad patches of moss and forest greens, muted olive tips, restrained ochre, occasional tiny earth gaps. Ground cover painted as soft clumps, not individual photoreal blades. Broad hand-painted color shapes match approved Ember & Bloom reference, simplified two-three tone detail, low contrast quiet surface for readable characters. Even neutral diffuse illumination, no cast shadows, no directional sun, no specular highlights or baked lighting, no vignette, no perspective, no objects, no flowers, no text, no borders, no grid. Uniform detail distribution with opposite edges continuing seamlessly in both axes. Output the single texture only, not a material sphere, scene, or contact sheet.

## worn-earth.png

Use case: stylized-concept. Asset type: usable game environment base-color texture, SINGLE square 1024x1024 tile. Input landscape is style/palette reference only. Create seamless tileable worn earthen ground albedo for Ashveil pastoral valley paths. Full frame orthographic straight-down surface: warm muted ochre clay and umber earth, broad softly painted compacted patches, small sparse flattened pale pebbles integrated into soil. No actual path boundary, grass borders or large landmarks; entire tile is earth to allow arbitrary path painting. Match Ember & Bloom broad painterly shapes, soft stylization, low contrast, little fine noise. Even neutral diffuse illumination, no cast shadows, no directional sunlight, no specular or baked light, no vignette, no perspective, no lettering borders grid or objects. Opposite edges must continue seamlessly both axes. Output only the single material tile not scene or sphere.

## ivory-limestone.png

Use case: stylized-concept. Asset type: usable game environment base-color texture SINGLE square 1024x1024 tile. Input artwork style reference only. Create seamless tileable warm ivory limestone surface albedo for Ashveil pastoral valley exposed rock and simple stone props. Entire frame orthographic flat rock surface, broad irregular softly angular cream-beige mineral planes, restrained cool grey seams and subtle warm ochre weathering. Low contrast shallow fine fissures, no deep black cracks, no brickwork or cobblestone layout, no grass, no large focal landmarks. Match Ember & Bloom simplified hand-painted two/three-tone surfaces, broad painterly strokes rather than photoreal grain. Even diffuse neutral light, no cast shadows, no directional highlights, no vignette, no perspective, text, border or grid. Opposite edges continue seamlessly in both axes. Output single material tile only.

## ash-ground.png

Use case: stylized-concept. Asset type: usable game environment base-color texture SINGLE square 1024x1024 tile. Input landscape is Ashveil style reference only. Generate seamless tileable ash-touched ground albedo: powdered pale warm grey and muted grey-sage earth, subdued flattened plant traces and faint soft irregular mineral shapes. This is living land losing colour, not burnt lava, soot, fire, snow or cracked desert. Broad hand-painted shapes matching Ember & Bloom pastoral surfaces, soft low contrast texture, no focal landmarks. Full frame orthographic straight-down surface with even neutral diffuse light. No cast shadows, highlights, directional lighting, vignette, perspective, text, borders, grid or standalone objects. Opposite edges should continue seamlessly both axes. Single texture only, not landscape or material sphere.
