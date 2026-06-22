import { expect, test } from 'vitest'
import { t } from './i18n'

test('Korean reader/search labels render as readable Korean text', () => {
    expect(t('search', 'ko')).toBe('검색')
    expect(t('insideThisBook', 'ko')).toBe('현재 책에서 검색')
    expect(t('searchResultPage', 'ko')).toBe('{page}쪽')
    expect(t('settings', 'ko')).toBe('읽기 설정')
    expect(t('langKorean', 'ko')).toBe('한국어')
})
