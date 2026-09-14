# Alderbank prop and house brief

Tripo-generated assets can supply the next scenery pass. The terrain blockout uses
the existing kit while its routes and placement footprints are tested. New models
should replace named placements without changing quest IDs or the zone layout.

Use the [environment reference](concepts/opening-chapter/environment-kit.png) and
the [starting-zone map](concepts/opening-chapter/starting-zone-map-v1.png) together:
ivory limestone, aged structural timber, warm plaster, terracotta roofs and restrained
teal cloth. The approved character establishes human scale. Map roof icons are
pictorial markers, not building dimensions.

## Useful first batch

| Place | Assets | Useful variation |
|---|---|---|
| Refuge | Crates, covered supplies, bedding, drying frames, cooking station, notice board | Full/empty crates, different cloth arrangements, weathering |
| Safe landing | Mooring posts, rope coils, reeds, driftwood, broken ferry pieces | Upright/leaning posts, several driftwood silhouettes |
| Wagon road | Covered wagon, loose wheel, sacks, barrels, roadside sign | Intact/damaged wagon dressing, different loads |
| Farm and orchard | Fence sections, gate, irrigation pieces, fruit baskets, beehives | Straight/corner/end fence pieces; open/closed gate |
| Lower Road | Ward stones, ruined masonry, trail markers, camp supplies | Intact/chipped/broken stone silhouettes |

Keep props separate from terrain and from one another unless they form an intentional
reusable set. Supply neutral lighting and materials without baked scene shadows.
Generated colour textures are colour maps; do not treat their brightness as height,
roughness or normal data.

## House family

Start with a small cottage, a larger refuge building and a farm/barn family. Useful
variation comes from interchangeable roof shapes, facade treatments, chimneys,
porches, awnings and small extensions, with consistent scale and construction style.
Changing the silhouette matters more than recolouring the same whole building.

The present collision disks are placement constraints, not a universal house size:
the refuge hall uses radius 6, cottages use 4–4.5, and farm buildings use 5 world units.
A candidate must be measured against its intended placement, including its porch and
low attachments. A larger footprint needs an intentional layout/collision update;
shrinking a whole house until its doors become unusable is not a fit solution.

For future interiors, retain a separate exterior shell, door opening, threshold and
door piece where possible. Keep a clear approach on both sides of a prospective
entrance, allow wall thickness, and avoid solid geometry behind an open doorway.
Record the doorway's local position and facing. Interior rooms, floors, stairs,
collision and loading behavior will need their own implementation; an exterior
model alone does not make a building enterable. Whether interiors are continuous
with the zone or loaded separately remains undecided.

## Handoff

Retain the generated source, source prompt/reference and exported GLB. The runtime
uses metres, +Y up and +Z forward; use a stable ground-level origin and applied
transforms. Keep useful modular parts separately named. Follow the existing
[scenery-kit export contract](../../scripts/art/scenery/README.md) for final runtime
integration, texture channels, footprint measurement and editable Blender sources.

Review candidates beside the actual character at gameplay camera distance. Check
doors, roof silhouette, grounding, UVs, material channels and collision clearance,
then create appropriate lower-detail variants before populating the whole zone.
The current kit's high-detail models are suitable for this limited blockout, not an
unmeasured density target for a full forest or settlement.
