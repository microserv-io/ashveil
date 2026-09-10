# Alderbank wandering wolf

The normal first-zone route includes one ambient wolf near the player start. It is a
noncombat prototype: it has no target, damage, aggro, player collision response, persistence,
or connection to the legacy simulation.

The wolf starts at `(-43, 20)`, walks at 0.5 metres per second inside a 3.5-metre
home circle, and stays grounded through the first-zone terrain and occupancy queries.
Its local seeded controller samples at most eight candidate destinations, validates
each direct route in intervals no larger than 0.2 metres, and waits for a finite retry
when no route is available. Movement uses fixed 1/60-second ticks and accepts at most
0.1 seconds from one rendered frame.

After three to seven seconds of non-attack simulation, including time spent unable to
move, it freezes its world position and facing while playing the one-second `attack`
clip into empty space. It then chooses a new walking route. Reset restores the initial
seed, location, destination, timers, action count, and animation pose. Overview pauses
both behavior and animation.

The committed runtime export and its pinned manifest live in
`public/creatures/wolf/`. The original Tripo mesh is retained at
`docs/art-pipeline/sources/wolf-tripo.glb`, and the editable recovered rig and animation
checkpoint is `scripts/art/creatures/wolf.blend`. The authored `run` clip remains in the
asset for review but this ambient behavior only walks and attacks.

The reviewed walk keeps its root in place while all four weighted paw patches travel
at least 0.14 metres fore and aft, lift off the ground, and move primarily along the
wolf's forward axis. Its two alternating contact phases use 13 keyed limb controls per
phase. The corrected rest bones sit within the mesh, the attack root moves forward,
and exactly two detached rear-paw quads (four triangles) were removed through
Blender's visible UI.
