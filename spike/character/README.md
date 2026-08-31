# Character rig review scene

This browser-only spike inspects the generated masculine diagnostic rig in the same
camera and lighting contract as the game. It is an evidence surface for GDD
decisions, not a production character viewer.

The required inputs are generated outside this scene:

- `docs/art-pipeline/tripo-style-test/output/base-models/masculine/rigged/masculine-rigged-diagnostic.glb`
- `docs/art-pipeline/tripo-style-test/output/base-models/masculine/rigged/report.json`

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
stress action, seven semantic skinned meshes, finite 1.8 m provisional bounds,
grounded origin, fitted-joint audit or evaluated pose-intent audit. The status panel
shows the fit contract/error and pose-specific reach, flexion, stride or yaw metric.
The page exposes `globalThis.characterReview` for browser-driven inspection.

The scene opens in the close front-inspection camera; the exact gameplay camera is
one click or `G` away. Controls: drag to orbit, wheel or pinch to zoom, Space to
play or pause, arrow keys to step poses, G/F/S/B for camera presets, K for skeleton,
W for wireframe, T for turntable, and R to reset the active camera preset.
