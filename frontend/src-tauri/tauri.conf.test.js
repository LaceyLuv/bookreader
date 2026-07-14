import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, test } from 'vitest'
import { packageShortcutGuide, resolveShortcutGuidePaths } from '../scripts/package-shortcut-guide.mjs'

test('desktop leaves file drops to the HTML upload area on Windows', () => {
    const configPath = resolve(process.cwd(), 'src-tauri/tauri.conf.json')
    const config = JSON.parse(readFileSync(configPath, 'utf8'))

    expect(config.app.windows[0].dragDropEnabled).toBe(false)
})

test('desktop starts at a compact size and stays hidden until native fitting completes', () => {
    const configPath = resolve(process.cwd(), 'src-tauri/tauri.conf.json')
    const config = JSON.parse(readFileSync(configPath, 'utf8'))
    const mainWindow = config.app.windows[0]

    expect(mainWindow.width).toBe(1200)
    expect(mainWindow.height).toBe(720)
    expect(mainWindow.center).toBe(true)
    expect(mainWindow.visible).toBe(false)
})

test('desktop bundles the complete Korean shortcut guide', () => {
    const configPath = resolve(process.cwd(), 'src-tauri/tauri.conf.json')
    const config = JSON.parse(readFileSync(configPath, 'utf8'))
    const sourceName = 'resources/글결_단축키_안내.txt'
    const sourcePath = resolve(process.cwd(), 'src-tauri', sourceName)

    expect(config.bundle.resources[sourceName]).toBe('글결_단축키_안내.txt')
    expect(existsSync(sourcePath)).toBe(true)

    const packaged = resolveShortcutGuidePaths({ configPath })
    expect(packaged.sourcePath).toBe(sourcePath)
    const releaseName = `글결_${config.version}_단축키_안내.txt`
    expect(packaged.releaseName).toBe(releaseName)
    expect(packaged.outputPath).toBe(resolve(
        process.cwd(),
        'src-tauri/target/release/bundle/nsis',
        releaseName,
    ))

    const guide = readFileSync(sourcePath, 'utf8')
    for (const shortcut of [
        'Page Up',
        'Page Down',
        'F11',
        'Shift+F11',
        'Ctrl+H',
        'B',
        'Shift+B',
        'Ctrl+F',
        'Ctrl+Comma',
        'Home',
        'End',
        'Alt+Left',
        'T',
        'M',
        'L',
        '[',
        ']',
        'Ctrl+O',
        'Ctrl+A',
        '키보드 단축키 사용',
    ]) {
        expect(guide).toContain(shortcut)
    }
    expect(guide).toContain('Ctrl+F  TXT·EPUB 검색 열기')
    expect(guide).toContain('다른 패널이나 대화상자가 열려 있지 않을 때')
})

test('shortcut guide packaging makes an exact UTF-8 release copy', () => {
    const root = mkdtempSync(join(tmpdir(), 'gyeol-shortcut-guide-'))
    try {
        const resourcesDir = join(root, 'resources')
        mkdirSync(resourcesDir)
        const sourceName = '글결_단축키_안내.txt'
        const sourcePath = join(resourcesDir, sourceName)
        const contents = '글결 단축키 안내\nCtrl+H 하단 조절바\n'
        writeFileSync(sourcePath, contents, 'utf8')
        const configPath = join(root, 'tauri.conf.json')
        writeFileSync(configPath, JSON.stringify({
            productName: '글결',
            version: '9.8.7',
            bundle: { resources: { [`resources/${sourceName}`]: sourceName } },
        }), 'utf8')

        const packaged = packageShortcutGuide({ configPath })

        expect(packaged.releaseName).toBe('글결_9.8.7_단축키_안내.txt')
        expect(readFileSync(packaged.outputPath, 'utf8')).toBe(contents)
        expect(readFileSync(packaged.outputPath)).toEqual(readFileSync(sourcePath))
    } finally {
        rmSync(root, { recursive: true, force: true })
    }
})
