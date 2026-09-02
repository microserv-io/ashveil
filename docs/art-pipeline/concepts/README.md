# Concept art

Every image that fed a Tripo generation lives here, so a body or a prop can be
regenerated from the same reference. One subject per image, plain background,
JPEG at quality 92 (a 1536 px sheet is about 300 KB; the PNG originals were ten
times that and git carries every version forever).

| Folder | What | Tripo input |
|---|---|---|
| `hero/` | The hooded assassin, the player's launch look | single front view |
| `mannequins/` | The bald-scalp undersuit bodies the game rigs: masculine and feminine, front, right, back, and a mirrored left (the undersuit is symmetric) | four views |
| `creatures/` | Non-humanoid species, starting with the ash wolf | single view until a four-view sheet exists |
| `environment/` | Landmark pieces such as the Ashward gate | single view |
| `batch-1/` | Three bipedal enemies as four-view sets, six dungeon kit pieces and eight props as front views (three-quarter views are reference only) | see its README |

The raw Tripo outputs that were accepted are committed next to the fitter under
`docs/art-pipeline/sources/` on the pipeline branch, with their hashes in each
body's manifest.
