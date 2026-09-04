import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const sourceWidth = 1536
const sourceHeight = 1024
const sourceHash = 'b3edd4f90f1d503b735f5d74be35f4ca15f47784dc91cf195d24a6d74781071f'

const crops = [
  {
    filename: 'ashveil-wordmark.svg',
    title: 'Ashveil original selected wordmark artwork',
    description: 'Exact raster artwork from the selected Ember and Bloom identity study, presented in an SVG viewport.',
    viewBox: '1054 176 450 94',
  },
  {
    filename: 'ashveil-emblem.svg',
    title: 'Ashveil original selected botanical ember artwork',
    description: 'Exact raster artwork from the selected Ember and Bloom identity study, presented in an SVG viewport.',
    viewBox: '1160 278 208 220',
  },
]

function createWrapper(crop, encodedPng) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${crop.viewBox}" role="img" aria-labelledby="title desc">
  <title id="title">${crop.title}</title>
  <desc id="desc">${crop.description}</desc>
  <!-- Original source SHA-256: ${sourceHash}. This container crops the selected board without redrawing it. -->
  <image width="${sourceWidth}" height="${sourceHeight}" href="data:image/png;base64,${encodedPng}"/>
</svg>
`
}

export async function generateBrandAssets(websiteRoot, publicDir) {
  const source = await readFile(resolve(websiteRoot, 'assets/source/identity-studies.png'))
  const encodedPng = source.toString('base64')
  const outputDir = resolve(publicDir, 'brand')
  await mkdir(outputDir, { recursive: true })
  await Promise.all(crops.map((crop) => writeFile(
    resolve(outputDir, crop.filename),
    createWrapper(crop, encodedPng),
  )))
}
