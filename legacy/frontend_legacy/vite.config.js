import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { transform as sucraseTransform } from 'sucrase'

function sucraseJsxInDev() {
    let isServe = false
    return {
        name: 'sucrase-jsx-in-dev',
        enforce: 'pre',
        configResolved(config) {
            isServe = config.command === 'serve'
        },
        transform(code, id) {
            if (!isServe) {
                return null
            }

            const cleanId = id.split('?')[0]
            const isJsxLike = cleanId.endsWith('.jsx') || cleanId.endsWith('.tsx')
            if (!isJsxLike || cleanId.includes('/node_modules/')) {
                return null
            }

            const result = sucraseTransform(code, {
                filePath: cleanId,
                transforms: cleanId.endsWith('.tsx') ? ['typescript', 'jsx'] : ['jsx'],
                jsxRuntime: 'automatic',
                production: false,
                disableESTransforms: true,
            })

            return {
                code: result.code,
                map: result.sourceMap ?? null,
            }
        },
    }
}

function replaceNodeEnvInDepsDev() {
    let isServe = false
    return {
        name: 'replace-node-env-in-deps-dev',
        enforce: 'pre',
        configResolved(config) {
            isServe = config.command === 'serve'
        },
        transform(code, id) {
            if (!isServe) {
                return null
            }

            const cleanId = id.split('?')[0]
            if (!cleanId.includes('/node_modules/') || !code.includes('process.env.NODE_ENV')) {
                return null
            }

            const replacement = JSON.stringify('development')
            return code
                .replaceAll('globalThis.process.env.NODE_ENV', replacement)
                .replaceAll('global.process.env.NODE_ENV', replacement)
                .replaceAll('process.env.NODE_ENV', replacement)
        },
    }
}

function reactCjsInteropInDev() {
    let isServe = false
    const cjsInteropQuery = '?cjs-interop'
    const wrapperEntries = [
        { suffix: 'react/index.js', target: 'react/cjs/react.development.js' },
        { suffix: 'react/jsx-runtime.js', target: 'react/cjs/react-jsx-runtime.development.js' },
        { suffix: 'react/jsx-dev-runtime.js', target: 'react/cjs/react-jsx-dev-runtime.development.js' },
        { suffix: 'react-dom/index.js', target: 'react-dom/cjs/react-dom.development.js' },
        { suffix: 'react-dom/client.js', target: 'react-dom/cjs/react-dom-client.development.js' },
        { suffix: 'scheduler/index.js', target: 'scheduler/cjs/scheduler.development.js' },
    ]
    const cjsRequireDeps = {
        'react/cjs/react-jsx-runtime.development.js': {
            react: '/node_modules/react/index.js',
        },
        'react/cjs/react-jsx-dev-runtime.development.js': {
            react: '/node_modules/react/index.js',
        },
        'react-dom/cjs/react-dom.development.js': {
            react: '/node_modules/react/index.js',
        },
        'react-dom/cjs/react-dom-client.development.js': {
            scheduler: '/node_modules/scheduler/index.js',
            react: '/node_modules/react/index.js',
            'react-dom': '/node_modules/react-dom/index.js',
        },
    }

    const toPosix = (value) => value.replace(/\\/g, '/')
    const cleanPath = (id) => toPosix(id.split('?')[0])
    const endsWithNodeModulePath = (path, suffix) => path.endsWith(`/node_modules/${suffix}`)
    const findWrapperEntry = (path) => wrapperEntries.find((entry) => endsWithNodeModulePath(path, entry.suffix))
    const findCjsDeps = (path) => {
        const key = Object.keys(cjsRequireDeps).find((suffix) => endsWithNodeModulePath(path, suffix))
        return key ? cjsRequireDeps[key] : null
    }

    return {
        name: 'react-cjs-interop-in-dev',
        enforce: 'pre',
        configResolved(config) {
            isServe = config.command === 'serve'
        },
        transform(code, id) {
            if (!isServe) {
                return null
            }

            const normalizedId = toPosix(id)
            const path = cleanPath(normalizedId)

            const wrapperEntry = findWrapperEntry(path)
            if (wrapperEntry) {
                const target = `/node_modules/${wrapperEntry.target}${cjsInteropQuery}`
                return `
import * as __cjsNs from ${JSON.stringify(target)};
export * from ${JSON.stringify(target)};
export default __cjsNs.default ?? __cjsNs;
`
            }

            if (!normalizedId.includes(cjsInteropQuery)) {
                return null
            }

            const deps = findCjsDeps(path)
            const depEntries = deps ? Object.entries(deps) : []
            const depImports = depEntries
                .map(([_, importPath], index) => `import * as __dep_${index} from ${JSON.stringify(importPath)};`)
                .join('\n')
            const requireCases = depEntries
                .map(
                    ([specifier, _], index) =>
                        `        case ${JSON.stringify(specifier)}: return __dep_${index}.default ?? __dep_${index};`,
                )
                .join('\n')
            const exportNames = Array.from(
                new Set(
                    [...code.matchAll(/exports\.([A-Za-z_$][\w$]*)\s*=/g)]
                        .map((match) => match[1])
                        .filter((name) => name !== 'default' && name !== '__esModule'),
                ),
            )
            const exportLines = exportNames
                .map((name) => `export const ${name} = __cjsExports[${JSON.stringify(name)}];`)
                .join('\n')

            return `
${depImports}
const __cjsModule = { exports: {} };
const module = __cjsModule;
const exports = __cjsModule.exports;
const require = (specifier) => {
    switch (specifier) {
${requireCases}
        default:
            throw new Error('[cjs-interop] Unsupported require(' + JSON.stringify(specifier) + ') in ${path}');
    }
};
${code}
const __cjsExports = __cjsModule.exports;
export default __cjsExports;
${exportLines}
`
        },
    }
}

function disableEsbuildInDev() {
    return {
        name: 'disable-esbuild-in-dev',
        enforce: 'post',
        config(_, { command }) {
            if (command !== 'serve') {
                return null
            }

            return {
                esbuild: false,
                optimizeDeps: {
                    disabled: true,
                    noDiscovery: true,
                    include: [],
                },
            }
        },
    }
}

export default defineConfig({
    clearScreen: false,
    base: './',
    plugins: [replaceNodeEnvInDepsDev(), reactCjsInteropInDev(), sucraseJsxInDev(), react(), disableEsbuildInDev()],
    envPrefix: ['VITE_', 'TAURI_ENV_*'],
    // In restricted environments, esbuild child processes can fail (EPERM) in dev.
    esbuild: false,
    optimizeDeps: {
        disabled: true,
        noDiscovery: true,
        include: [],
    },
    server: {
        port: 5173,
        strictPort: true,
        watch: {
            ignored: ['**/src-tauri/**'],
        },
        proxy: {
            '/api': {
                target: 'http://127.0.0.1:8000',
                changeOrigin: true,
            },
        },
    },
    build: {
        target: process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'safari13',
        minify: !process.env.TAURI_ENV_DEBUG ? 'esbuild' : false,
        sourcemap: !!process.env.TAURI_ENV_DEBUG,
    },
})
