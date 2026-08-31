# Character rig review scene

This browser-only spike currently inspects the isolated Auto-Rig Pro masculine
benchmark in the same camera and lighting contract as the game. It is an evidence
surface for GDD decisions, not a production character viewer.

The required inputs are generated outside this scene:

- `docs/art-pipeline/tripo-style-test/output/base-models/masculine/rigged-auto-rig-pro/masculine-auto-rig-pro-diagnostic.glb`
- `docs/art-pipeline/tripo-style-test/output/base-models/masculine/rigged-auto-rig-pro/report.json`

Build or run the isolated scene after those artifacts exist:

```text
npm run art:character-review:build
npm run art:character-review
```

The configured server uses port `5276` and listens on all interfaces. On the current
development machine it is available at `http://100.103.10.11:5276`. The optional
Knight comparison loads from `public/models/player.glb`; its absence does not
invalidate the generated rig.

The review fails visibly when the generated asset lacks its skin, joints, named
benchmark action, seven semantic skinned meshes, finite 1.8 m provisional bounds,
grounded origin or measured diagnostic report. The ARP status panel reports its
bone inventory, scapula finding, bind deviation and deformation disposition. The
page exposes `globalThis.characterReview` for browser-driven inspection.

The scene opens in the close front-inspection camera; the exact gameplay camera is
one click or `G` away. Controls: drag to orbit, wheel or pinch to zoom, Space to
play or pause, arrow keys to step poses, G/F/S/B for camera presets, K for skeleton,
W for wireframe, T for turntable, and R to reset the active camera preset.

The always-visible `Game look` control switches to a deterministic look-development
vignette without changing the rig, pose, animation time or inspection overlays. Its
first activation selects the gameplay camera and current runtime scale. The scene
uses a painterly cream-stone texture, simple teal and saffron proxy details, and a
pearl-grey ash boundary rather than a black mask. Character colours are reversible
runtime material clones. This is a palette blockout on a bare mannequin, not evidence
that a finished outfit, cosmetics, textures or production fog-of-war are ready.

The Animation clip selector exposes the GLB's stress benchmark, in-place walk and
in-place sprint. Stress playback remains one-shot and retains named pose stepping;
walk and sprint loop and replace the pose label with the nearest measured contact
phase from the diagnostic report. Each clip supplies its own frame range and 30 fps
timeline. Switching clips resets animation playback without changing the active look,
camera, scale, skeleton, wireframe, turntable or semantic-mesh visibility.
