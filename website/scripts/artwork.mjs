import { mkdir, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import sharp from 'sharp'

async function isNewer(target, source) {
  try {
    const [targetStat, sourceStat] = await Promise.all([stat(target), stat(source)])
    return targetStat.mtimeMs >= sourceStat.mtimeMs
  } catch {
    return false
  }
}

async function createImage(source, target, options) {
  if (await isNewer(target, source)) return
  await mkdir(dirname(target), { recursive: true })
  let pipeline = sharp(source).resize(options.width, options.height, {
    fit: options.fit || 'inside',
    withoutEnlargement: true,
    position: options.position || 'centre',
  })
  pipeline = options.format === 'jpeg'
    ? pipeline.jpeg({ quality: options.quality || 86, mozjpeg: true })
    : pipeline.webp({ quality: options.quality || 84, smartSubsample: true })
  await pipeline.toFile(target)
}

export async function optimizeArtwork(websiteRoot, publicDir) {
  const sourceDir = resolve(websiteRoot, 'assets/source')
  const mediaDir = resolve(publicDir, 'media')
  const images = [
    ['ember-and-bloom-world.png', 'ember-world'],
    ['where-the-colour-fades.png', 'where-colour-fades'],
  ]
  for (const [sourceName, outputName] of images) {
    const source = resolve(sourceDir, sourceName)
    await createImage(source, resolve(mediaDir, `${outputName}-960.webp`), { width: 960 })
    await createImage(source, resolve(mediaDir, `${outputName}-1600.webp`), { width: 1600 })
  }
  await createImage(
    resolve(sourceDir, 'ember-and-bloom-world.png'),
    resolve(mediaDir, 'ember-world-social.jpg'),
    { width: 1200, height: 630, fit: 'cover', position: 'centre', format: 'jpeg' },
  )
}
