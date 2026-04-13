import { getSelectionSnapshot } from './annotationSelection'

test('selection snapshot in TXT reader returns segment-local offsets', () => {
    document.body.innerHTML = '<div id="root"><p data-segment-id="7">alpha target omega</p></div>'
    const root = document.getElementById('root')
    const textNode = root.querySelector('p').firstChild
    const range = document.createRange()
    range.setStart(textNode, 6)
    range.setEnd(textNode, 12)
    range.getBoundingClientRect = () => ({
        left: 10,
        top: 10,
        bottom: 20,
        width: 20,
    })
    const selection = window.getSelection()
    selection.removeAllRanges()
    selection.addRange(range)

    const snapshot = getSelectionSnapshot(root)

    expect(snapshot.segmentId).toBe(7)
    expect(snapshot.startOffset).toBe(6)
    expect(snapshot.endOffset).toBe(12)
    expect(snapshot.segmentLocalStart).toBe(6)
    expect(snapshot.segmentLocalEnd).toBe(12)
})

test('selection snapshot adds slice start when TXT content is rendered from a measured slice', () => {
    document.body.innerHTML = '<div id="root"><p data-segment-id="5" data-slice-start="20">abcdef</p></div>'
    const root = document.getElementById('root')
    const textNode = root.querySelector('p').firstChild
    const range = document.createRange()
    range.setStart(textNode, 1)
    range.setEnd(textNode, 4)
    range.getBoundingClientRect = () => ({
        left: 10,
        top: 10,
        bottom: 20,
        width: 20,
    })
    const selection = window.getSelection()
    selection.removeAllRanges()
    selection.addRange(range)

    const snapshot = getSelectionSnapshot(root)

    expect(snapshot.segmentId).toBe(5)
    expect(snapshot.segmentLocalStart).toBe(21)
    expect(snapshot.segmentLocalEnd).toBe(24)
})
