import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(import.meta.dirname, '..')

describe('quest architecture', () => {
  it('keeps every quest core module host agnostic', () => {
    for (const file of typescriptFiles(join(ROOT, 'src', 'quests'))) {
      const source = readFileSync(file, 'utf8')
      expect(source, file).not.toMatch(/from ['"][^'"]*\b(world|persistence|sim|session|render|ui|net)\b|from ['"]three['"]|\b(document|window|indexedDB|localStorage|Date\.now|performance\.)\b/)
    }
  })

  it('allows persistence to depend on quest truth but no game or presentation layer', () => {
    for (const file of typescriptFiles(join(ROOT, 'src', 'persistence'))) {
      const source = readFileSync(file, 'utf8')
      expect(source, file).not.toMatch(/from ['"][^'"]*\b(world|sim|session|render|ui|net)\b|from ['"]three['"]/)
    }
  })
})

function typescriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? typescriptFiles(path) : entry.name.endsWith('.ts') ? [path] : []
  })
}
