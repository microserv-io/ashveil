import type { Actor } from '../sim/types'
import { createActorView, disposeActorView, resetActorView, viewKey, type ActorView } from './actorview'

/**
 * Recycles bodies instead of building them.
 *
 * Cloning a rigged model and binding its clips to a fresh mixer is the single
 * largest source of garbage in the frame — it dominated a heap profile of a real
 * fight — and monsters arrive and die constantly. The allocation is what matters:
 * it is not one slow frame but a collection pause landing on some later frame,
 * which is exactly the kind of hitch that is hard to trace back to its cause.
 */

/** Corpses would otherwise pile up for a whole run; past this the body is let go. */
const MAX_IDLE_PER_KIND = 12

export class ActorViewPool {
  private readonly idle = new Map<string, ActorView[]>()

  acquire(actor: Actor): ActorView {
    const reused = this.idle.get(viewKey(actor))?.pop()
    if (!reused) return createActorView(actor)
    resetActorView(reused)
    return reused
  }

  release(view: ActorView): void {
    let bucket = this.idle.get(view.key)
    if (!bucket) {
      bucket = []
      this.idle.set(view.key, bucket)
    }
    if (bucket.length >= MAX_IDLE_PER_KIND) {
      disposeActorView(view)
      return
    }
    view.group.visible = false
    bucket.push(view)
  }

  /** An area change throws away the whole cast, bodies included. */
  clear(): void {
    for (const bucket of this.idle.values()) for (const view of bucket) disposeActorView(view)
    this.idle.clear()
  }
}
