#!/usr/bin/env node

const childProcess = require('node:child_process')
const { EventEmitter } = require('node:events')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const originalExec = childProcess.exec

childProcess.exec = function patchedExec(command, options, callback) {
    const normalized = typeof command === 'string' ? command.trim().toLowerCase() : ''

    // In restricted Windows environments, `net use` may throw EPERM during Vite path normalization.
    // Return a no-op child process and surface a callback error so Vite falls back safely.
    if (normalized === 'net use') {
        const cb = typeof options === 'function' ? options : (typeof callback === 'function' ? callback : null)
        if (cb) {
            const err = new Error('net use unavailable')
            err.code = 'EPERM'
            process.nextTick(() => cb(err, '', ''))
        }

        const fake = new EventEmitter()
        fake.kill = () => false
        fake.stdout = null
        fake.stderr = null
        fake.stdin = null
        process.nextTick(() => {
            fake.emit('close', 1)
            fake.emit('exit', 1)
        })
        return fake
    }

    return originalExec.apply(this, arguments)
}

if (!process.argv.includes('--configLoader')) {
    process.argv.splice(2, 0, '--configLoader', 'native')
}

const vitePkg = require.resolve('vite/package.json')
const viteBin = path.join(path.dirname(vitePkg), 'bin', 'vite.js')
process.argv[1] = viteBin

;(async () => {
    await import(pathToFileURL(viteBin).href)
})().catch((error) => {
    console.error(error)
    process.exit(1)
})
