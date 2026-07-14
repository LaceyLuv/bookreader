import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const frontendDir = path.resolve(scriptDir, '..')
const tauriDir = path.join(frontendDir, 'src-tauri')

function fileSha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex')
}

function loadGuideMapping(config) {
  const resources = config.bundle?.resources
  if (!resources || Array.isArray(resources) || typeof resources !== 'object') {
    throw new Error('tauri.conf.json must map the shortcut guide through bundle.resources.')
  }

  const candidates = Object.entries(resources).filter(([source, target]) => (
    path.extname(source).toLowerCase() === '.txt'
    && path.extname(String(target)).toLowerCase() === '.txt'
    && path.basename(String(target), '.txt').startsWith(`${config.productName}_`)
  ))
  if (candidates.length !== 1) {
    throw new Error(`Expected exactly one product shortcut guide resource, found ${candidates.length}.`)
  }
  return candidates[0]
}

export function resolveShortcutGuidePaths({ configPath = path.join(tauriDir, 'tauri.conf.json') } = {}) {
  const config = JSON.parse(readFileSync(configPath, 'utf8'))
  const [sourceRelative, bundledName] = loadGuideMapping(config)
  const sourcePath = path.resolve(path.dirname(configPath), sourceRelative)
  const extension = path.extname(bundledName)
  const stem = path.basename(bundledName, extension)
  const suffix = stem.slice(config.productName.length)
  const releaseName = `${config.productName}_${config.version}${suffix}${extension}`
  const outputDir = path.join(path.dirname(configPath), 'target', 'release', 'bundle', 'nsis')

  return {
    sourcePath,
    outputPath: path.join(outputDir, releaseName),
    releaseName,
  }
}

export function packageShortcutGuide(options = {}) {
  const paths = resolveShortcutGuidePaths(options)
  const source = statSync(paths.sourcePath)
  if (!source.isFile() || source.size === 0) {
    throw new Error(`Shortcut guide must be a non-empty file: ${paths.sourcePath}`)
  }

  mkdirSync(path.dirname(paths.outputPath), { recursive: true })
  copyFileSync(paths.sourcePath, paths.outputPath)

  const output = statSync(paths.outputPath)
  if (!output.isFile() || output.size !== source.size || fileSha256(paths.outputPath) !== fileSha256(paths.sourcePath)) {
    throw new Error(`Shortcut guide copy verification failed: ${paths.outputPath}`)
  }
  return paths
}

const isMain = process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url

if (isMain) {
  const { outputPath } = packageShortcutGuide()
  process.stdout.write(`[release] shortcut guide copied: ${outputPath}\n`)
}
