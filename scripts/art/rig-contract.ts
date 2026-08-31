export interface JointFitRecord {
  name: string
  targetWorld: number[]
  actualWorld: number[]
  errorVectorMetres: number[]
  errorMetres: number
  thresholdMetres: number
  sourceObjects: string[]
  sampleCount: number
  confidence: number
}

export function assertJointFitRecords(records: JointFitRecord[]): void {
  for (const record of records) {
    const values = [...record.targetWorld, ...record.actualWorld, ...record.errorVectorMetres]
    if (values.length !== 9 || values.some((value) => !Number.isFinite(value))) {
      throw new Error(`${record.name} has non-finite joint evidence.`)
    }
    if (record.sampleCount < 12 || record.sourceObjects.length === 0 || record.confidence <= 0) {
      throw new Error(`${record.name} lacks measurement provenance.`)
    }
    const errorVector = record.actualWorld.map((value, index) => value - record.targetWorld[index]!)
    const error = Math.hypot(...errorVector)
    if (
      errorVector.some((value, index) => Math.abs(value - record.errorVectorMetres[index]!) > 1e-5) ||
      Math.abs(error - record.errorMetres) > 1e-5 ||
      error > record.thresholdMetres
    ) {
      throw new Error(`${record.name} does not match its independently frozen target.`)
    }
  }
}

interface StrideLeg {
  hipWorld: number[]
  kneeWorld: number[]
  ankleWorld: number[]
  kneeLateralDriftMetres: number
  sameSideMarginMetres: number
  signedSagittalBend: number
  flexionDegrees: number
}

export interface StrideIntentRecord {
  leadLeg: string
  trailLeg: string
  pelvisWorldDelta: number[]
  leadFootWorldDelta: number[]
  trailFootDisplacementMetres: number
  leadSolePatchLiftMetres: number
  trailSolePatchPenetrationMetres: number
  trailFootGroundErrorMetres: number
  knees: Record<'L' | 'R', StrideLeg>
}

export function assertStrideIntent(stride: StrideIntentRecord): void {
  if (stride.leadLeg !== 'leg.L' || stride.trailLeg !== 'leg.R') {
    throw new Error('Stride lead/trail identity changed.')
  }
  if (
    stride.pelvisWorldDelta[2]! > -0.02 ||
    stride.pelvisWorldDelta[2]! < -0.04 ||
    Math.abs(stride.pelvisWorldDelta[1]!) > 0.02 ||
    stride.leadFootWorldDelta[1]! > -0.12 ||
    stride.leadFootWorldDelta[2]! < 0.04 ||
    stride.trailFootDisplacementMetres > 0.035 ||
    stride.leadSolePatchLiftMetres < 0.025 ||
    stride.trailSolePatchPenetrationMetres > 0.01 ||
    stride.trailFootGroundErrorMetres > 0.015
  ) {
    throw new Error('Stride displacement or ground contact changed.')
  }
  for (const [side, leg] of Object.entries(stride.knees) as ['L' | 'R', StrideLeg][]) {
    const sign = side === 'L' ? 1 : -1
    if (
      leg.hipWorld[0]! * sign <= 0 ||
      leg.kneeWorld[0]! * sign <= 0 ||
      leg.ankleWorld[0]! * sign <= 0 ||
      leg.sameSideMarginMetres <= 0.035 ||
      Math.abs(leg.kneeLateralDriftMetres) > 0.05 ||
      leg.signedSagittalBend <= 0 ||
      leg.flexionDegrees < 5 ||
      leg.flexionDegrees > 145
    ) {
      throw new Error(`${side} knee violates the sagittal-plane contract.`)
    }
  }
}

export interface PoseOrientationEvidence {
  pose: string
  axialTwists: Record<string, number>
  chainGapsMetres: Record<string, number>
}

export function mirrorNormalizedTwist(side: 'L' | 'R', degrees: number): number {
  return side === 'L' ? degrees : -degrees
}

export function assertPoseOrientationEvidence(evidence: PoseOrientationEvidence): void {
  for (const [bone, twist] of Object.entries(evidence.axialTwists)) {
    if (!Number.isFinite(twist) || Math.abs(twist) > 60) {
      throw new Error(`${evidence.pose} ${bone} has uncommanded axial twist ${twist}.`)
    }
  }
  if (evidence.pose === 'overhead-reach') {
    for (const segment of ['upper_arm', 'forearm']) {
      const difference = Math.abs(
        mirrorNormalizedTwist('L', evidence.axialTwists[`${segment}.L`]!) -
          mirrorNormalizedTwist('R', evidence.axialTwists[`${segment}.R`]!),
      )
      if (difference > 15) {
        throw new Error(`overhead-reach ${segment} bilateral twist differs by ${difference}.`)
      }
    }
  }
  for (const [chain, gap] of Object.entries(evidence.chainGapsMetres)) {
    if (!Number.isFinite(gap) || gap > 0.001) {
      throw new Error(`${evidence.pose} ${chain} chain gap is ${gap} metres.`)
    }
  }
}
