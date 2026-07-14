import { expect, test } from 'vitest'
import { t } from './i18n'
import { THEME_PRESETS } from './constants/themes'

test('product branding is localized with the chosen name and tagline', () => {
    expect(t('appTitle', 'ko')).toBe('글결')
    expect(t('appTitle', 'en')).toBe('Gyeol Reader')
    expect(t('appSubtitle', 'ko')).toBe('내 파일을, 내 방식으로.')
    expect(t('appSubtitle', 'en')).toBe('My files, my way.')
})

test('Korean reader/search labels render as readable Korean text', () => {
    expect(t('search', 'ko')).toBe('검색')
    expect(t('insideThisBook', 'ko')).toBe('현재 책에서 검색')
    expect(t('searchResultPage', 'ko')).toBe('{page}쪽')
    expect(t('settings', 'ko')).toBe('읽기 설정')
    expect(t('langKorean', 'ko')).toBe('한국어')
})

test('archive diagnostics and recovery labels are translated instead of leaking keys', () => {
    const keys = [
        'bookLoadFailed',
        'archiveLoadFailed',
        'chapterLoadFailed',
        'imageLoadFailed',
        'retryImage',
        'retrying',
        'chooseAnotherFileHint',
        'reexportFileHint',
        'technicalDetails',
    ]

    for (const key of keys) {
        expect(t(key, 'en')).not.toBe(key)
        expect(t(key, 'ko')).not.toBe(key)
    }
})

test('annotation export controls are translated in both languages', () => {
    const keys = [
        'exportAnnotations',
        'exportAllAnnotations',
        'annotationExportFormats',
        'annotationExportStarted',
        'annotationExportPrivacyWarning',
        'noAnnotationsToExport',
        'closeAnnotations',
    ]

    for (const key of keys) {
        expect(t(key, 'en')).not.toBe(key)
        expect(t(key, 'ko')).not.toBe(key)
    }
})

test('packaged backend recovery guidance is translated in both languages', () => {
    const keys = [
        'backendUnavailable',
        'backendUnavailableRecovery',
        'backendSidecarMissing',
        'backendSidecarMissingRecovery',
        'backendSidecarBlocked',
        'backendSidecarExited',
        'backendSidecarExitedRecovery',
        'backendDataMigrationFailed',
        'backendDataMigrationRecovery',
        'restartBookReader',
        'backendRestartFailed',
    ]

    for (const key of keys) {
        expect(t(key, 'en')).not.toBe(key)
        expect(t(key, 'ko')).not.toBe(key)
        expect(t(key, 'en')).not.toContain('BookReader')
        expect(t(key, 'ko')).not.toContain('BookReader')
    }
})

test('basic and advanced settings plus theme presets are localized in both languages', () => {
    expect(t('settingsBasicTab', 'en')).toBe('Basic')
    expect(t('settingsBasicTab', 'ko')).toBe('기본')
    expect(t('settingsAdvancedTab', 'en')).toBe('Advanced')
    expect(t('settingsAdvancedTab', 'ko')).toBe('고급')

    for (const preset of THEME_PRESETS) {
        expect(t(preset.nameKey, 'en')).not.toBe(preset.nameKey)
        expect(t(preset.nameKey, 'ko')).not.toBe(preset.nameKey)
        expect(t(preset.noteKey, 'en')).not.toBe(preset.noteKey)
        expect(t(preset.noteKey, 'ko')).not.toBe(preset.noteKey)
    }
})

test('keyboard shortcut controls explain both the switch and retained accessibility keys', () => {
    for (const key of ['keyboardShortcuts', 'enableKeyboardShortcuts', 'keyboardShortcutsHint', 'keyboardShortcutsDisabled']) {
        expect(t(key, 'en')).not.toBe(key)
        expect(t(key, 'ko')).not.toBe(key)
    }
    expect(t('keyboardShortcutsHint', 'ko')).toContain('Esc')
    expect(t('keyboardShortcutsHint', 'en')).toContain('Tab')
})
