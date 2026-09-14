import { describe, expect, it } from 'vitest'
import { elevateLookDirection } from '../src/world/camera-look'

describe('upward world camera look', () => {
  it('is continuous at the physical orbit pitch boundary', () => {
    const towardTarget = { x: -4, y: -3, z: -8 }
    const direction = elevateLookDirection(towardTarget, 0, 0.4)
    const length = Math.hypot(towardTarget.x, towardTarget.y, towardTarget.z)
    expect(direction.x).toBeCloseTo(towardTarget.x / length, 10)
    expect(direction.y).toBeCloseTo(towardTarget.y / length, 10)
    expect(direction.z).toBeCloseTo(towardTarget.z / length, 10)
  })

  it('preserves horizontal bearing and ignores collision-vector scale', () => {
    const first = elevateLookDirection({ x: 3, y: -2, z: 4 }, 0.7, 0)
    const scaled = elevateLookDirection({ x: 30, y: -20, z: 40 }, 0.7, 0)
    expect(first.x).toBeCloseTo(scaled.x, 10)
    expect(first.y).toBeCloseTo(scaled.y, 10)
    expect(first.z).toBeCloseTo(scaled.z, 10)
    expect(first.x / first.z).toBeCloseTo(3 / 4, 10)
    expect(first.y).toBeGreaterThan(-2 / Math.hypot(3, 2, 4))
  })

  it('uses a finite normalized yaw fallback for degenerate directions', () => {
    const yaw = 0.63
    const direction = elevateLookDirection({ x: 0, y: 2, z: 0 }, 0.8, yaw)
    expect(Object.values(direction).every(Number.isFinite)).toBe(true)
    expect(Math.hypot(direction.x, direction.y, direction.z)).toBeCloseTo(1, 10)
    expect(direction.x / Math.hypot(direction.x, direction.z)).toBeCloseTo(-Math.sin(yaw), 10)
    expect(direction.z / Math.hypot(direction.x, direction.z)).toBeCloseTo(-Math.cos(yaw), 10)
  })

  it('clamps below the zenith so forward movement never reverses', () => {
    const direction = elevateLookDirection({ x: 0, y: 0, z: -1 }, 100, 0)
    expect(Math.asin(direction.y)).toBeCloseTo(1.45, 10)
    expect(direction.z).toBeLessThan(0)
  })
})
