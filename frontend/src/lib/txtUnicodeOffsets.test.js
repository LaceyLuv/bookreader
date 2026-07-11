import { expect, test } from 'vitest'
import { TXT_OFFSET_UNIT, codePointIndexToUtf16, codePointLength, reanchorLegacyTxtAnnotation, utf16IndexToCodePoint } from './txtUnicodeOffsets'

test('converts between DOM UTF-16 and persisted Unicode code points', () => {
    const text = 'A😀B𐐷C'
    expect(text.length).toBe(7)
    expect(codePointLength(text)).toBe(5)
    expect(codePointIndexToUtf16(text, 2)).toBe(3)
    expect(utf16IndexToCodePoint(text, 3)).toBe(2)
    expect(codePointIndexToUtf16(text, 4)).toBe(6)
})

test('reanchors an unversioned annotation by selected text near its old offset', () => {
    const result = reanchorLegacyTxtAnnotation({
        segment_id: 2, start_offset: 8, end_offset: 12, selected_text: 'target',
    }, [{ segment_id: 2, start_offset: 5, text: '😀 xx target yy target' }])
    expect(result.offset_unit).toBe(TXT_OFFSET_UNIT)
    expect(result.start_offset).toBe(10)
    expect(result.end_offset).toBe(16)
})
