import { installActiveZone } from './zone-active'
import { compileZone } from './zone-compiler'
import { DEFAULT_ZONE } from './zone-default'
import { loadZoneDraft } from './zone-draft'

function showDraftFailure(reason: string): void {
  const notice = document.createElement('aside')
  notice.id = 'zone-draft-error'
  notice.setAttribute('role', 'alert')
  notice.className = 'fixed left-1/2 top-4 z-[100] w-[min(92vw,38rem)] -translate-x-1/2 rounded-xl border border-red-300/35 bg-stone-950/95 px-5 py-4 text-sm text-stone-100 shadow-2xl backdrop-blur'
  const title = document.createElement('strong')
  title.className = 'block font-serif text-base text-red-200'
  title.textContent = 'Saved terrain draft could not be played'
  const detail = document.createElement('p')
  detail.className = 'mt-1 break-words text-stone-300'
  detail.textContent = reason
  const link = document.createElement('a')
  link.className = 'mt-3 inline-flex rounded-lg border border-amber-100/25 bg-amber-100/10 px-3 py-2 font-medium text-amber-50 hover:bg-amber-100/20'
  link.href = `${import.meta.env.BASE_URL}`
  link.textContent = 'Return to the default Alderbank'
  notice.append(title, detail, link)
  document.body.append(notice)
}

async function bootstrap(): Promise<void> {
  let compiled
  if (new URLSearchParams(location.search).get('zoneDraft') === '1') {
    let draft
    try { draft = loadZoneDraft(window.localStorage) } catch (error) {
      draft = { kind: 'invalid' as const, reason: error instanceof Error ? error.message : String(error) }
    }
    if (draft.kind === 'valid') compiled = draft.compiled
    else {
      compiled = compileZone(DEFAULT_ZONE)
      showDraftFailure(draft.kind === 'missing' ? 'No saved terrain draft was found. The committed Alderbank definition is open instead.' : draft.reason)
    }
  } else {
    compiled = compileZone(DEFAULT_ZONE)
  }
  installActiveZone(compiled)
  await import('./main')
}

void bootstrap().catch((error: unknown) => {
  const app = document.querySelector<HTMLElement>('#app')
  if (app) app.textContent = error instanceof Error ? error.message : String(error)
  console.error(error)
})
