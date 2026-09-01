import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import * as THREE from 'three'
import {
  assertCharacterAssetSummary,
  CURRENT_PLAYER_RUNTIME_SCALE,
  GAMEPLAY_CAMERA_FOV,
  GAMEPLAY_CAMERA_OFFSET,
  NATIVE_SCALE,
  POSE_FRAMES,
  REQUIRED_SEMANTIC_MESHES,
  type CharacterAssetSummary,
} from '../spike/character/review-contract'
import { resetRootYaw, sampleTimeForFrame } from '../spike/character/view-contract'
import { assertRigReport, type RigReport } from '../spike/character/asset-inspection'
import {
  initialReviewPanelOpen,
  REVIEW_PANEL_MOBILE_QUERY,
} from '../spike/character/review-ui'
import {
  GameLookOwner,
  GAME_LOOK_GROUND_SIZE,
  GAME_LOOK_REVEAL_RADIUS,
  nextLookMode,
  type LookMode,
} from '../spike/character/game-look'
import {
  activateReviewAction,
  assertReviewClipInventory,
  buildReviewClips,
  loopConfiguration,
  nearestContactPhase,
  type ReviewAction,
} from '../spike/character/animation-review'
import {
  buildTransferV2ReviewClips,
  initialReviewSource,
  type TransferV2Report,
} from '../spike/character/review-source'

function validSummary(): CharacterAssetSummary {
  return {
    skins: 1,
    joints: 20,
    clips: [{ name: 'Ashveil_RigStress', duration: 50 / 30 }],
    semanticMeshes: Object.fromEntries(
      REQUIRED_SEMANTIC_MESHES.map((name) => [name, { skinned: true }]),
    ),
    bounds: { minimum: [-0.48, 0, -0.16], maximum: [0.48, 1.8, 0.16] },
  }
}

describe('character review contract', () => {
  it('pins gameplay camera, scale, and diagnostic pose frames', () => {
    expect(GAMEPLAY_CAMERA_FOV).toBe(38)
    expect(GAMEPLAY_CAMERA_OFFSET).toEqual([0, 19, 14.5])
    expect(NATIVE_SCALE).toBe(1)
    expect(CURRENT_PLAYER_RUNTIME_SCALE).toBeCloseTo(0.44 * 1.93)
    expect(POSE_FRAMES).toEqual({
      bind: 0,
      'overhead-reach': 10,
      'cross-body-reach': 20,
      'deep-elbow-bend': 30,
      'long-stride': 40,
      'head-turn': 50,
    })
  })

  it('accepts the complete diagnostic asset shape', () => {
    expect(() => assertCharacterAssetSummary(validSummary())).not.toThrow()
  })

  it('rejects missing rig data and unskinned semantic components', () => {
    const summary = validSummary()
    summary.skins = 0
    summary.joints = 0
    summary.semanticMeshes.Body = { skinned: false }

    expect(() => assertCharacterAssetSummary(summary)).toThrow(/skin.*joints.*Body/s)
  })

  it('rejects invalid clips and ungrounded or unexpected bounds', () => {
    const summary = validSummary()
    summary.clips = [
      { name: 'Ashveil_RigStress', duration: 0 },
      { name: 'Ashveil_RigStress', duration: 1 },
    ]
    summary.bounds = { minimum: [-1, 0.1, -1], maximum: [1, 1.2, 1] }

    expect(() => assertCharacterAssetSummary(summary)).toThrow(
      /unique.*positive duration.*native height.*grounded/s,
    )
  })

  it('samples just after float32 pose keys and clamps the final pose past duration', () => {
    const duration = 50 / 30
    expect(sampleTimeForFrame(10, 30, duration)).toBeGreaterThan(10 / 30)
    expect(sampleTimeForFrame(20, 30, duration)).toBeGreaterThan(20 / 30)
    expect(sampleTimeForFrame(50, 30, duration)).toBeGreaterThan(duration)
  })

  it('normalizes character root yaw for unambiguous camera comparisons', () => {
    const model = { rotation: { y: 1.25 } }
    const knight = { rotation: { y: -0.5 } }

    resetRootYaw(model, knight)

    expect(model.rotation.y).toBe(0)
    expect(knight.rotation.y).toBe(0)
  })

  it('starts the review controls open on desktop and collapsed on narrow screens', () => {
    expect(REVIEW_PANEL_MOBILE_QUERY).toBe('(max-width: 640px)')
    expect(initialReviewPanelOpen(false)).toBe(true)
    expect(initialReviewPanelOpen(true)).toBe(false)

    const html = readFileSync(new URL('../spike/character/index.html', import.meta.url), 'utf8')
    expect(html).toMatch(/id="review-panel"[^>]*hidden/)
    expect(html).toMatch(/id="review-panel-toggle"/)
    expect(html).toMatch(/aria-controls="review-panel"/)
    expect(html).toMatch(/aria-expanded="false"/)
    expect(html).toMatch(/aria-label="Show review controls"/)
    expect(html).toMatch(/id="look-mode-toggle"/)
    expect(html).toMatch(/aria-pressed="false"/)
    expect(html).toMatch(/aria-label="Show Game look"/)
    expect(html).toMatch(/id="animation-select"/)
    expect(html).toMatch(/for="animation-select">Animation clip/)
    expect(html).toMatch(/id="asset-source-select"/)
    expect(html).toMatch(/aria-label="Review asset source"/)
    expect(html).toMatch(/value="canonical">Canonical review/)
    expect(html).toMatch(/value="wip-transfer-v2">WIP transfer v2/)
  })

  it('defaults to canonical and exposes the isolated transfer v2 route', () => {
    expect(initialReviewSource('').id).toBe('canonical')
    expect(initialReviewSource('?source=unknown').id).toBe('canonical')
    expect(initialReviewSource('?source=wip-transfer-v2').id).toBe('wip-transfer-v2')
  })

  it('derives the WIP clip inventory and exact timing from its report', () => {
    const report = JSON.parse(
      readFileSync(
        new URL(
          '../docs/art-pipeline/tripo-style-test/output/base-models/masculine/rigged-auto-rig-pro-transfer-v2/report.json',
          import.meta.url,
        ),
        'utf8',
      ),
    ) as TransferV2Report
    const exported = report.retargetSkeletal.clips.map((clip) => ({
      name: clip.outputName,
      duration: clip.durationSeconds,
    }))
    const clips = buildTransferV2ReviewClips(report, exported)
    expect(clips.map(({ name, frameEnd, framesPerSecond, durationSeconds }) => ({
      name,
      frameEnd,
      framesPerSecond,
      durationSeconds,
    }))).toEqual([
      { name: 'Ashveil_Walk_InPlace', frameEnd: 60, framesPerSecond: 30, durationSeconds: 2 },
      { name: 'Ashveil_Sprint_InPlace', frameEnd: 60, framesPerSecond: 30, durationSeconds: 2 },
    ])
    expect(() => buildTransferV2ReviewClips(report, exported.slice(1))).toThrow(/inventory/)
    expect(() =>
      buildTransferV2ReviewClips(report, exported.map((clip) => ({ ...clip, duration: 3 }))),
    ).toThrow(/duration/)
  })

  it('builds the unique stress, walk, and sprint review contract with exact durations', () => {
    const report = JSON.parse(
      readFileSync(
        new URL(
          '../docs/art-pipeline/tripo-style-test/output/base-models/masculine/rigged-auto-rig-pro/report.json',
          import.meta.url,
        ),
        'utf8',
      ),
    )
    const reviewClips = buildReviewClips(report)
    expect(reviewClips.map(({ name, durationSeconds }) => ({ name, durationSeconds }))).toEqual([
      { name: 'Ashveil_ARP_Benchmark', durationSeconds: 50 / 30 },
      { name: 'Ashveil_Walk_InPlace', durationSeconds: 1 },
      { name: 'Ashveil_Sprint_InPlace', durationSeconds: 0.6 },
    ])
    const actual = reviewClips.map(({ name, durationSeconds }) => ({ name, duration: durationSeconds }))
    expect(() => assertReviewClipInventory(reviewClips, actual)).not.toThrow()
    expect(() => assertReviewClipInventory(reviewClips, [...actual, actual[0]!])).toThrow(/unique/)
    expect(() =>
      assertReviewClipInventory(reviewClips, actual.map((clip) => ({ ...clip, duration: clip.duration + 0.1 }))),
    ).toThrow(/duration/)
  })

  it('configures stress once and locomotion to repeat', () => {
    expect(loopConfiguration('stress')).toEqual({ mode: THREE.LoopOnce, repetitions: 1, clamp: true })
    expect(loopConfiguration('locomotion')).toEqual({
      mode: THREE.LoopRepeat,
      repetitions: Infinity,
      clamp: false,
    })
  })

  it('stops and resets the previous action before activating the selected clip', () => {
    const previous = recordedAction('previous')
    const selected = recordedAction('selected')
    activateReviewAction(previous.action, selected.action, loopConfiguration('locomotion'))
    expect(previous.calls).toEqual(['stopFading', 'fadeOut:0.12', 'stop', 'reset'])
    expect(selected.calls).toEqual([
      'stopFading',
      'reset',
      `setLoop:${THREE.LoopRepeat}:Infinity`,
      'setEffectiveWeight:1',
      'play',
    ])
    expect(selected.action.paused).toBe(true)
    expect(selected.action.clampWhenFinished).toBe(false)
  })

  it('reports the nearest locomotion contact phase', () => {
    const schedule = [
      { frame: 0, phase: 'left_contact' },
      { frame: 8, phase: 'pass' },
      { frame: 15, phase: 'right_contact' },
    ]
    expect(nearestContactPhase(schedule, 2)).toEqual(schedule[0])
    expect(nearestContactPhase(schedule, 11)).toEqual(schedule[1])
    expect(nearestContactPhase(schedule, 14)).toEqual(schedule[2])
  })

  it('toggles between diagnostic and game look deterministically', () => {
    expect(nextLookMode('diagnostic')).toBe('game')
    expect(nextLookMode('game')).toBe('diagnostic')
    expect(['diagnostic', 'game'] satisfies LookMode[]).toHaveLength(2)
  })

  it('pins the selected look-development texture lineage and runtime derivative', () => {
    const source = readFileSync(
      new URL(
        '../docs/art-pipeline/tripo-style-test/output/look-dev/textures/ashveil-cream-stone-v2-source.png',
        import.meta.url,
      ),
    )
    const runtime = readFileSync(
      new URL('../spike/character/assets/ashveil-cream-stone-v2.webp', import.meta.url),
    )
    expect(createHash('sha256').update(source).digest('hex')).toBe(
      '91d39bafb6abedd63b7f89b30c86cc1da527378db1e8043af762f1fca7d91f6c',
    )
    expect(createHash('sha256').update(runtime).digest('hex')).toBe(
      '4f449880a573c13e881994cb0c2f28e9f1c96854c49478aa16d58538f4c01e27',
    )
  })

  it('owns one idempotent game-look group and restores exact diagnostic materials', () => {
    const scene = new THREE.Scene()
    const diagnosticGround = new THREE.Group()
    scene.add(diagnosticGround)
    const originalBackground = new THREE.Color(0x0b0d12)
    const originalFog = new THREE.Fog(0x0b0d12, 30, 62)
    scene.background = originalBackground
    scene.fog = originalFog

    const undersuit = new THREE.MeshStandardMaterial({ color: 0xcccccc, wireframe: false })
    undersuit.name = 'Base_Undersuit'
    const skin = new THREE.MeshStandardMaterial({ color: 0xcccccc, wireframe: false })
    skin.name = 'Base_Skin'
    const body = new THREE.Mesh(new THREE.BoxGeometry(), undersuit)
    body.name = 'Body'
    const eye = new THREE.Mesh(new THREE.BoxGeometry(), skin)
    eye.name = 'Eye_NegativeX'
    const texture = new THREE.Texture()
    const owner = new GameLookOwner({
      scene,
      diagnosticGround,
      characterMeshes: [body, eye],
      floorTexture: texture,
    })
    const childCount = scene.children.length

    owner.setMode('game')
    owner.setMode('game')
    expect(scene.children).toHaveLength(childCount)
    expect(owner.environment.visible).toBe(true)
    expect(diagnosticGround.visible).toBe(false)
    expect(scene.fog).toMatchObject({ near: 28, far: 55 })
    expect(body.material).not.toBe(undersuit)
    expect(eye.material).not.toBe(skin)
    expect(texture.wrapS).toBe(THREE.MirroredRepeatWrapping)
    expect(texture.wrapT).toBe(THREE.MirroredRepeatWrapping)
    expect(texture.repeat.toArray()).toEqual([8.5, 8.5])
    expect(GAME_LOOK_GROUND_SIZE).toBe(40)
    expect(GAME_LOOK_REVEAL_RADIUS).toEqual({ start: 3, end: 4.8 })
    const ground = owner.environment.getObjectByName('Game_Look_Cream_Stone') as THREE.Mesh
    expect((ground.geometry as THREE.PlaneGeometry).parameters).toMatchObject({ width: 40, height: 40 })

    owner.setWireframe(true)
    expect((body.material as THREE.MeshStandardMaterial).wireframe).toBe(true)
    owner.setMode('diagnostic')
    expect(body.material).toBe(undersuit)
    expect(eye.material).toBe(skin)
    expect(diagnosticGround.visible).toBe(true)
    expect(scene.background).toBe(originalBackground)
    expect(scene.fog).toBe(originalFog)

    owner.dispose()
    expect(scene.children).not.toContain(owner.environment)
  })

  it('accepts measured ARP diagnostics without treating them as production-ready', () => {
    const report = JSON.parse(
      readFileSync(
        new URL(
          '../docs/art-pipeline/tripo-style-test/output/base-models/masculine/rigged-auto-rig-pro/report.json',
          import.meta.url,
        ),
        'utf8',
      ),
    ) as RigReport

    expect(() => assertRigReport(report)).not.toThrow()
    expect(report.export?.runtimeRig).toMatchObject({
      fullAuthoringRigExported: true,
      runtimeReductionPending: true,
      runtimeClean: false,
      jointCount: 211,
      deformFlaggedJointCount: 29,
      deformOnlyJointCount: 27,
      controlJointCount: 65,
      referenceJointCount: 27,
      mechanismJointCount: 92,
    })
    expect(report.export?.runtimeRig.controlJoints.every((name) => name.startsWith('c_'))).toBe(true)
    expect(JSON.stringify(report)).not.toContain('authoringRigLeakage')
    expect(JSON.stringify(report)).not.toContain('rigifyControlLeakage')
    report.export!.runtimeRig.runtimeReductionPending = false
    expect(() => assertRigReport(report)).toThrow(/pending runtime reduction/)
    report.export!.runtimeRig.runtimeReductionPending = true
    report.productionAcceptance.pass = true
    expect(() => assertRigReport(report)).toThrow(/must remain diagnostic/)
    report.productionAcceptance.pass = false
    report.locomotion!.productionLocomotionPass = true
    expect(() => assertRigReport(report)).toThrow(/control-authoring prototype/)
  })
})

function recordedAction(name: string): { action: ReviewAction; calls: string[] } {
  const calls: string[] = []
  const action: ReviewAction = {
    name,
    paused: false,
    enabled: false,
    clampWhenFinished: false,
    stopFading: () => calls.push('stopFading'),
    fadeOut: (duration) => calls.push(`fadeOut:${duration}`),
    stop: () => calls.push('stop'),
    reset: () => calls.push('reset'),
    setLoop: (mode, repetitions) => calls.push(`setLoop:${mode}:${repetitions}`),
    setEffectiveWeight: (weight) => calls.push(`setEffectiveWeight:${weight}`),
    play: () => calls.push('play'),
  }
  return { action, calls }
}
