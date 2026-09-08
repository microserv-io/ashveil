import { copyFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

export const LICENSE_NOTICE_FILES = [
  'LICENSE',
  'LICENSE-CODE',
  'LICENSE-ASSETS',
  'THIRD_PARTY_NOTICES.md',
]

export async function copyLicenseNotices(outputDir, repositoryRoot = resolve(import.meta.dirname, '..')) {
  await mkdir(outputDir, { recursive: true })
  await Promise.all(LICENSE_NOTICE_FILES.map((name) => copyFile(resolve(repositoryRoot, name), resolve(outputDir, name))))
}

if (import.meta.filename === process.argv[1]) {
  const destination = process.argv[2]
  if (!destination) throw new Error('Usage: node scripts/copy-license-notices.mjs <output-directory>')
  await copyLicenseNotices(resolve(destination))
}
