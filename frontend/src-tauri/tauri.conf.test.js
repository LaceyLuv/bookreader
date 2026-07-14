import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test } from 'vitest'

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
