import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const PRODUCT_NAME = '글결'
const MAIN_BINARY_NAME = 'Gyeol'

function check(name, passed, detail) {
  return { name, passed: Boolean(passed), detail }
}

export function validatePolicyData(data, profile = 'development', env = {}) {
  const checks = []
  const versions = Object.values(data.versions)
  checks.push(check('version_semver', versions.every((value) => SEMVER.test(value)), 'All application versions must be SemVer.'))
  checks.push(check('versions_aligned', new Set(versions).size === 1, `Configured versions: ${versions.join(', ')}`))

  const config = data.tauriConfig
  const windows = config.bundle?.windows || {}
  checks.push(check('product_name_frozen', config.productName === PRODUCT_NAME, `productName must remain ${PRODUCT_NAME}.`))
  checks.push(check('main_binary_name_frozen', config.mainBinaryName === MAIN_BINARY_NAME, `mainBinaryName must remain ${MAIN_BINARY_NAME}.`))
  checks.push(check('identifier_present', /^[A-Za-z0-9.-]+\.[A-Za-z0-9.-]+$/.test(config.identifier || ''), `Identifier: ${config.identifier || '(missing)'}`))
  checks.push(check('downgrades_blocked', windows.allowDowngrades === false, 'bundle.windows.allowDowngrades must be false.'))
  checks.push(check('install_scope_frozen', windows.nsis?.installMode === 'currentUser', 'NSIS installMode must remain currentUser.'))

  const updater = config.plugins?.updater
  const updaterArtifacts = config.bundle?.createUpdaterArtifacts
  checks.push(check('runtime_updater_disabled', !updater && !updaterArtifacts, 'The base build must stay on manual updates until updater gates pass.'))

  if (profile === 'public' || profile === 'updater') {
    const expectedIdentifier = env.BOOKREADER_RELEASE_IDENTIFIER || ''
    const expectedPublisher = env.BOOKREADER_RELEASE_PUBLISHER || ''
    const publisher = config.bundle?.publisher || ''
    checks.push(check('release_identifier_frozen', Boolean(expectedIdentifier) && config.identifier === expectedIdentifier, 'BOOKREADER_RELEASE_IDENTIFIER must exactly match the frozen identifier.'))
    checks.push(check('publisher_frozen', Boolean(publisher) && Boolean(expectedPublisher) && publisher === expectedPublisher && publisher !== config.productName, 'The configured publisher must match BOOKREADER_RELEASE_PUBLISHER and differ from productName.'))

    const thumbprint = (env.BOOKREADER_WINDOWS_CERTIFICATE_THUMBPRINT || '').replace(/\s+/g, '')
    checks.push(check('certificate_thumbprint_present', /^[0-9A-Fa-f]{40,64}$/.test(thumbprint), 'A certificate-store signing thumbprint is required.'))
    let timestampIsHttps = false
    try {
      timestampIsHttps = new URL(env.BOOKREADER_WINDOWS_TIMESTAMP_URL || '').protocol === 'https:'
    } catch {
      timestampIsHttps = false
    }
    checks.push(check('timestamp_url_https', timestampIsHttps, 'BOOKREADER_WINDOWS_TIMESTAMP_URL must be HTTPS.'))
  }

  if (profile === 'updater') {
    const publicKey = env.BOOKREADER_UPDATER_PUBLIC_KEY || ''
    const privateKey = env.TAURI_SIGNING_PRIVATE_KEY || ''
    let endpointIsHttps = false
    try {
      endpointIsHttps = new URL(env.BOOKREADER_UPDATER_ENDPOINT || '').protocol === 'https:'
    } catch {
      endpointIsHttps = false
    }
    checks.push(check('updater_public_key_custodied', publicKey.length > 32 && !/placeholder|change.me/i.test(publicKey), 'A non-placeholder updater public key must be supplied as content.'))
    checks.push(check('updater_private_key_available', privateKey.length > 0, 'TAURI_SIGNING_PRIVATE_KEY must be available outside .env; its value is never reported.'))
    checks.push(check('updater_endpoint_https', endpointIsHttps, 'BOOKREADER_UPDATER_ENDPOINT must be HTTPS.'))
  }

  return {
    schema_version: 1,
    profile,
    version: versions[0] || null,
    ok: checks.every((item) => item.passed),
    checks,
  }
}

export function loadReleaseData(rootDir) {
  const frontendDir = path.join(rootDir, 'frontend')
  const packageJson = JSON.parse(fs.readFileSync(path.join(frontendDir, 'package.json'), 'utf8'))
  const tauriConfig = JSON.parse(fs.readFileSync(path.join(frontendDir, 'src-tauri', 'tauri.conf.json'), 'utf8'))
  const cargo = fs.readFileSync(path.join(frontendDir, 'src-tauri', 'Cargo.toml'), 'utf8')
  const backend = fs.readFileSync(path.join(rootDir, 'backend', 'services', 'backup_service.py'), 'utf8')
  const cargoVersion = cargo.match(/^version\s*=\s*"([^"]+)"/m)?.[1] || ''
  const backendVersion = backend.match(/^APP_VERSION\s*=\s*"([^"]+)"/m)?.[1] || ''
  return {
    versions: {
      package: packageJson.version || '',
      tauri: tauriConfig.version || '',
      cargo: cargoVersion,
      backend: backendVersion,
    },
    tauriConfig,
  }
}

function parseProfile(argv) {
  const index = argv.indexOf('--profile')
  const profile = index >= 0 ? argv[index + 1] : 'development'
  if (!['development', 'candidate', 'public', 'updater'].includes(profile)) {
    throw new Error(`Unsupported release profile: ${profile}`)
  }
  return profile
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
  const result = validatePolicyData(loadReleaseData(rootDir), parseProfile(process.argv.slice(2)), process.env)
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  if (!result.ok) process.exitCode = 1
}
