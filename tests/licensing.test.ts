import { readFile, stat } from 'node:fs/promises'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { copyLicenseNotices, LICENSE_NOTICE_FILES } from '../scripts/copy-license-notices.mjs'

const ROOT = resolve(new URL('..', import.meta.url).pathname)
const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('repository licensing', () => {
  it('preserves the prior MIT text for code and ordinary documentation', async () => {
    const codeLicense = await readFile(resolve(ROOT, 'LICENSE-CODE'), 'utf8')
    expect(codeLicense).toContain('MIT License')
    expect(codeLicense).toContain('Permission is hereby granted, free of charge')
    expect(codeLicense).toContain('THE SOFTWARE IS PROVIDED "AS IS"')
    expect(await readFile(resolve(ROOT, 'package.json'), 'utf8')).toContain('"license": "SEE LICENSE IN LICENSE"')
  })

  it('covers representative art and asset data while preserving named exceptions', async () => {
    const assetLicense = await readFile(resolve(ROOT, 'LICENSE-ASSETS'), 'utf8')
    const notices = await readFile(resolve(ROOT, 'THIRD_PARTY_NOTICES.md'), 'utf8')
    for (const phrase of [
      'GLB, glTF, mesh, rig, skeleton',
      'embedded and external textures',
      'Blender files',
      'concept art, logos, wordmarks',
      'fixture',
      'JSON fixtures',
      'compiled, browser-playable, downloadable, archived',
      'train or improve an artificial-intelligence',
    ]) expect(assetLicense).toContain(phrase)
    for (const path of [
      'public/bodies/masculine-clean-v1/masculine-clean-v1.glb',
      'public/bodies/masculine-clean-v1/masculine-clean-v1.manifest.json',
      'public/world/first-zone/scenery-kit.glb',
      'public/textures/first-zone/ash-ground.png',
      'docs/art-pipeline/sources/masculine-mannequin-tripo.glb',
      'docs/art-pipeline/concepts/hero/hooded-assassin-front.jpg',
      'website/assets/source/identity-studies.png',
      'src/render/procedural/fixtures/masculine.json',
    ]) {
      expect((await stat(resolve(ROOT, path))).isFile()).toBe(true)
      expect(assetLicense).toContain(path.includes('/') && path.split('/').length > 2
        ? `${path.split('/').slice(0, 2).join('/')}/`
        : path)
    }
    expect(notices).toContain('public/models/')
    expect(notices).toContain('b0ca9bd96a8072ab36a3a5464f00ed1e06a16d07')
    expect(notices).toContain('CC0 1.0 Universal')
    expect(notices).toContain('website/public/fonts/alegreya-variable.ttf')
    expect(notices).toContain('website/public/fonts/source-sans-3-variable.ttf')
    expect(notices).toContain('SIL Open Font License 1.1')
  })

  it('copies every full notice byte-for-byte for distributable builds', async () => {
    const output = await mkdtemp(resolve(tmpdir(), 'ashveil-licenses-'))
    temporaryDirectories.push(output)
    await copyLicenseNotices(output, ROOT)
    for (const name of LICENSE_NOTICE_FILES) {
      expect(await readFile(resolve(output, name))).toEqual(await readFile(resolve(ROOT, name)))
    }
    const packageSource = await readFile(resolve(ROOT, 'package.json'), 'utf8')
    const siteGenerator = await readFile(resolve(ROOT, 'website/scripts/generate.mjs'), 'utf8')
    expect(packageSource).toContain('copy-license-notices.mjs dist')
    expect(siteGenerator).toContain('copyLicenseNotices(publicDir, repositoryRoot)')
  })
})
