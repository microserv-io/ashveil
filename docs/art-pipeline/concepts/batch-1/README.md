# Brief: concept image batch 1 for Tripo (enemies, environment, props)

Write outputs only under
/Users/roccolangeweg/Repositories/microserv-io/ashveil/.claude/worktrees/3d-animation-pipeline-53090e/docs/art-pipeline/concepts/batch-1/
(create it). No code, no commits. Use your image generation capability; if it is not
available in this environment, stop and say so in one line.

## Style contract (from the GDD and the existing concepts)

Ashveil is a vivid, painterly mythic fantasy: warmth, nature and wonder under threat
from ash. Life is colourful, tactile and in motion; ash drains colour and stills
things. Not grimdark, not gory. The register of the existing sheets is clean
stylised painterly (smooth forms, confident shapes, readable colour blocking,
Arcane-like without imitating it). Study these before generating and match them:
- docs/art-pipeline/tripo-style-test/input/main-character.jpg (hero: hooded cream
  tunic, teal shoulder cloth, orange cape, brown leather, gold trim)
- docs/art-pipeline/tripo-style-test/input/ash-wolf.jpg
- docs/art-pipeline/tripo-style-test/input/ashward-gate.jpg
(these live in the workspace checkout /Users/roccolangeweg/Repositories/microserv-io/ashveil/workspaces/auto-rig-pro-spike/docs/art-pipeline/tripo-style-test/input/; read them from there).

## Tripo requirements (every image)

One subject per image, whole subject visible with margin, plain neutral light-grey
background, even soft studio lighting, no cast shadow on the ground beyond a faint
contact shadow, no text, no frame, no scene, no other objects, square 1024 or 1536
px. Characters in a relaxed A-pose, feet apart, mouth closed, looking straight
ahead. For each subject produce a three-view sheet as separate files: front, right
side, back, identical scale and camera height, named `<subject>-front.jpg`,
`<subject>-right.jpg`, `<subject>-back.jpg`. For environment and props produce a
three-quarter view and a front view.

## Subjects

Enemies (bipedal, so they ride the humanoid pipeline; read as distinct silhouettes
from an elevated camera; ash-grey palette with one warm accent each):
1. `ash-cultist`: lean robed figure, ash-grey layered robe, bone-white mask, ember
   orange sash, staff-less, hands empty.
2. `hollowed-soldier`: a once-human soldier turned to ash, cracked grey armour with
   dull gold edging, embers glowing in the cracks, sword sheathed at the hip, no
   shield.
3. `ash-ghoul`: hunched biped, long arms, sunken chest, grey skin with darker
   ash flakes, eyes faint teal glow; still clearly two-legged and two-armed.

Environment (modular kit pieces for the dungeon, matching each other in scale and
material: warm sandstone with painted teal and gold detail, ash creeping in at
edges):
4. `floor-tile`: a square 2 by 2 m flagstone tile, slightly worn, seen from a
   three-quarter above angle and from straight above.
5. `wall-segment`: a 2 m wide, 3 m tall straight wall piece with a carved band.
6. `wall-corner`: the matching outer corner piece.
7. `pillar`: a 3 m column with a capital, freestanding.
8. `doorway`: a 2 m wide arched doorway in a wall segment, open.
9. `stairs`: a short flight of four steps, 2 m wide.

Props (readable from above, one warm accent):
10. `brazier`: iron brazier with live embers.
11. `chest-wooden`: closed wooden chest with iron bands.
12. `chest-ornate`: closed ornate chest, gold and teal.
13. `crate`: wooden crate.
14. `urn`: tall clay urn with a painted band.
15. `rubble`: a pile of broken sandstone blocks.
16. `banner`: a hanging cloth banner on a short pole, teal with gold sigil.
17. `altar`: a low stone altar with candles unlit.

## Report

A list of every file written with its subject and view, and one line per subject
on any prompt choice you made that the brief left open. If any image came out with
text, a scene background or a cropped subject, regenerate it before reporting.
