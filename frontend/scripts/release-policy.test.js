import { describe, expect, test } from 'vitest'

import { validatePolicyData } from './release-policy.mjs'

function data(overrides = {}) {
  return {
    versions: { package: '1.2.3', tauri: '1.2.3', cargo: '1.2.3', backend: '1.2.3' },
    tauriConfig: {
      productName: 'BookReader',
      identifier: 'com.example.bookreader',
      bundle: {
        publisher: 'Example Publisher',
        windows: { allowDowngrades: false, nsis: { installMode: 'currentUser' } },
      },
    },
    ...overrides,
  }
}

describe('release policy', () => {
  test('accepts the safe manual-update development baseline', () => {
    const result = validatePolicyData(data())

    expect(result.ok).toBe(true)
    expect(result.checks.find((item) => item.name === 'runtime_updater_disabled')?.passed).toBe(true)
  })

  test('rejects version drift, downgrade enablement, and an active updater', () => {
    const fixture = data()
    fixture.versions.backend = '1.2.4'
    fixture.tauriConfig.bundle.windows.allowDowngrades = true
    fixture.tauriConfig.plugins = { updater: { endpoints: ['http://example.test'] } }

    const result = validatePolicyData(fixture)

    expect(result.ok).toBe(false)
    expect(result.checks.filter((item) => !item.passed).map((item) => item.name)).toEqual(expect.arrayContaining([
      'versions_aligned',
      'downgrades_blocked',
      'runtime_updater_disabled',
    ]))
  })

  test('public release fails closed without a frozen identity and signing inputs', () => {
    const result = validatePolicyData(data(), 'public', {})

    expect(result.ok).toBe(false)
    expect(result.checks.find((item) => item.name === 'certificate_thumbprint_present')?.passed).toBe(false)
    expect(result.checks.find((item) => item.name === 'publisher_frozen')?.passed).toBe(false)
  })

  test('updater readiness requires both trust systems and HTTPS', () => {
    const env = {
      BOOKREADER_RELEASE_IDENTIFIER: 'com.example.bookreader',
      BOOKREADER_RELEASE_PUBLISHER: 'Example Publisher',
      BOOKREADER_WINDOWS_CERTIFICATE_THUMBPRINT: 'A'.repeat(40),
      BOOKREADER_WINDOWS_TIMESTAMP_URL: 'https://timestamp.example.test',
      BOOKREADER_UPDATER_PUBLIC_KEY: 'untrusted comment: minisign public key\nRWQexampleexampleexampleexample',
      TAURI_SIGNING_PRIVATE_KEY: 'available-outside-env-file',
      BOOKREADER_UPDATER_ENDPOINT: 'https://updates.example.test/latest.json',
    }

    const result = validatePolicyData(data(), 'updater', env)

    expect(result.ok).toBe(true)
  })
})
