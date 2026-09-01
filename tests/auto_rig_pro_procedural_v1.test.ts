import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  autoRigProProceduralV1ArtifactNames,
  parseAutoRigProProceduralV1Args,
} from '../scripts/art/auto-rig-pro-procedural-v1'

const pipelinePath = resolve('scripts/art/auto-rig-pro-procedural-v1.py')
const generatedOutput = resolve(
  'docs/art-pipeline/tripo-style-test/output/base-models/masculine/rigged-auto-rig-pro-procedural-v1',
)

describe('Auto-Rig Pro procedural v1 diagnostic', () => {
  it('pins the three exact 30 fps loop contracts', () => {
    const pipeline = readFileSync(pipelinePath, 'utf8')
    expect(pipeline).toContain('("idle", "Ashveil_Idle_InPlace", 120)')
    expect(pipeline).toContain('("walk", "Ashveil_Walk_InPlace", 30)')
    expect(pipeline).toContain('("sprint", "Ashveil_Sprint_InPlace", 18)')
    expect(pipeline).toContain('scene.render.fps = 30')
    expect(pipeline).toContain('explicitDuplicateEndpoint')
    expect(pipeline).toContain('action_key_time_gate(')
    expect(pipeline).toContain('keyTimes')
    expect(pipeline).toContain('frame=frame')
    expect(pipeline).toContain('copy_literal_duplicate_endpoint(')
    expect(pipeline).toContain('end.co.y = start.co.y')
    expect(pipeline).toContain('bone.matrix = matrix')
    expect(pipeline).toContain('bpy.context.view_layer.update()')
  })

  it('authors only whitelisted ARP controls with quaternion arm frames and IK legs from frame zero', () => {
    const pipeline = readFileSync(pipelinePath, 'utf8')
    expect(pipeline).toContain('AUTHORED_CONTROLS')
    expect(pipeline).toContain('c_foot_ik.')
    expect(pipeline).toContain('c_toes_ik.')
    expect(pipeline).toContain('c_leg_pole.')
    expect(pipeline).toContain('c_arm_fk.')
    expect(pipeline).toContain('c_forearm_fk.')
    expect(pipeline).toContain('quaternion_swing_twist(')
    expect(pipeline).toContain('explicit_elbow_hinge(')
    expect(pipeline).toContain('bind_forward -= up * bind_forward.dot(up)')
    expect(pipeline).toContain('min(toe_direction_dots) < 0.999')
    expect(pipeline).toContain('abs(forward.dot(up)) > 1e-6')
    expect(pipeline).not.toContain('rotation_euler')
    expect(pipeline).not.toContain('BASE.retarget(')
    expect(pipeline).not.toContain('ik_to_fk_leg(')
  })

  it('pins post-authored contact, anatomy, deformation, parity, and runtime gates', () => {
    const pipeline = readFileSync(pipelinePath, 'utf8')
    expect(pipeline).toContain('SKINNED_P95_LIMIT = 0.001')
    expect(pipeline).toContain('SKINNED_MAXIMUM_LIMIT = 0.002')
    expect(pipeline).toContain('PENETRATION_LIMIT = -0.002')
    expect(pipeline).toContain('WALK_CONTACT_DISTANCE_LIMIT = 0.003')
    expect(pipeline).toContain('STANCE_SLIDE_LIMIT = 0.005')
    expect(pipeline).toContain('WALK_MINIMUM_KNEE_FLEXION = 8.0')
    expect(pipeline).toContain('solve_support_sole_heights(')
    expect(pipeline).toContain('"support"')
    expect(pipeline).toContain('"toeOff"')
    expect(pipeline).toContain('0.110')
    expect(pipeline).toContain('stanceSlide')
    expect(pipeline).toContain('sprintFlight')
    expect(pipeline).toContain('reciprocalArms')
    expect(pipeline).toContain('evaluated_chest_local')
    expect(pipeline).toContain('clip_id == "idle" or reciprocalArms <= -0.5')
    expect(pipeline).toContain('handMotionSymmetric')
    expect(pipeline).toContain('handsDoNotCross')
    expect(pipeline).toContain('hand_motion_difference <= 0.005')
    expect(pipeline).toContain('hand_motion_difference / hand_motion_mean <= 0.30')
    expect(pipeline).toContain('idleNoHumeralTwist')
    expect(pipeline).toContain('humeralTwist')
    expect(pipeline).toContain('elbowHinge')
    expect(pipeline).toContain('"flexion": math.degrees(upper.angle(lower))')
    expect(pipeline).toContain('minimumKneeForwardDot')
    expect(pipeline).toContain('idleMotionPass')
    expect(pipeline).toContain('rootMotionAmplitudeMetres')
    expect(pipeline).toContain('spineRotationAmplitudeRadians')
    expect(pipeline).toContain('handMotionAmplitudeMetres')
    expect(pipeline).toContain('endpointTranslationMetres')
    expect(pipeline).toContain('endpointRotationDegrees')
    expect(pipeline).toContain('wrappedAngularVelocityErrorDegreesPerFrame')
    expect(pipeline).toContain('blenderGlbSkinnedParity')
    expect(pipeline).toContain('arp_ge_master_traj = False')
  })

  it('covers the complete accepted 29-joint deform inventory in loop validation', () => {
    const pipeline = readFileSync(pipelinePath, 'utf8')
    expect(pipeline).toContain('EXPECTED_DEFORM_BONES = (')
    expect(pipeline).toContain('actual_deform_bones != EXPECTED_DEFORM_BONES')
    expect(pipeline).toContain('DEFORM_BONES = set(EXPECTED_DEFORM_BONES)')
    const inventoryBlock = pipeline.match(/EXPECTED_DEFORM_BONES = \(([\s\S]*?)\n\)/)?.[1] ?? ''
    const inventory = [...inventoryBlock.matchAll(/"([^"]+)"/g)].map((match) => match[1])
    expect(inventory).toEqual([
      'arm_stretch.l',
      'arm_stretch.r',
      'c_arm_twist_offset.l',
      'c_arm_twist_offset.r',
      'foot.l',
      'foot.r',
      'forearm_stretch.l',
      'forearm_stretch.r',
      'forearm_twist.l',
      'forearm_twist.r',
      'hand.l',
      'hand.r',
      'head.x',
      'leg_stretch.l',
      'leg_stretch.r',
      'leg_twist.l',
      'leg_twist.r',
      'neck.x',
      'root.x',
      'shoulder.l',
      'shoulder.r',
      'spine_01.x',
      'spine_02.x',
      'thigh_stretch.l',
      'thigh_stretch.r',
      'thigh_twist.l',
      'thigh_twist.r',
      'toes_01.l',
      'toes_01.r',
    ])
    expect(pipeline).toContain('"count": len(actual_deform_bones)')
  })

  it('parses only accepted target and isolated output', () => {
    expect(
      parseAutoRigProProceduralV1Args([
        '--target',
        'target.blend',
        '--output',
        'output',
      ]),
    ).toEqual({ target: 'target.blend', output: 'output' })
  })

  it('retains artifacts only after every machine gate passes', () => {
    if (!existsSync(generatedOutput)) {
      expect(existsSync(resolve(generatedOutput, 'report.json'))).toBe(false)
      return
    }
    const report = JSON.parse(readFileSync(resolve(generatedOutput, 'report.json'), 'utf8'))
    expect(report.schemaVersion).toBe('ashveil.auto-rig-pro-procedural-v1')
    expect(report.objectiveAcceptance.pass).toBe(true)
    expect(report.humanReview.pass).toBe(false)
    expect(report.productionPass).toBe(false)
    expect(report.canonicalViewerPromoted).toBe(false)
    expect(report.artifacts).toHaveLength(autoRigProProceduralV1ArtifactNames.length - 1)
  })
})
