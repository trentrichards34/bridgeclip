import { execFileSync } from 'child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { effectModule } from './src/shared/fx-html'

const { version } = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8')) as { version: string }

/** `npm run dev` shows the commit after the version (v0.1.19+8f9f986) so testers can tell updates apart. */
function displayVersion(): string {
  if (!process.argv.includes('dev')) return version
  try {
    const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: __dirname, encoding: 'utf8', timeout: 5000 }).trim()
    return /^[0-9a-f]{7,12}$/.test(commit) ? `${version}+${commit}` : version
  } catch { return version }
}

/** Renderer dependencies are bundled from devDependencies, outside npm's runtime inventory. */
function bundledLicenseNotices(): Plugin {
  return {
    name: 'bundled-license-notices',
    apply: 'build',
    generateBundle() {
      const directories = new Set<string>()
      for (const id of this.getModuleIds()) {
        const normalized = id.replace(/\\/g, '/')
        const marker = '/node_modules/'
        const at = normalized.lastIndexOf(marker)
        if (at < 0 || normalized.startsWith('\0')) continue
        const parts = normalized.slice(at + marker.length).split('/')
        const name = parts.slice(0, parts[0].startsWith('@') ? 2 : 1).join('/')
        directories.add(`${normalized.slice(0, at)}${marker}${name}`)
      }
      const notices: string[] = []
      for (const directory of [...directories].sort()) {
        const pkg = JSON.parse(readFileSync(resolve(directory, 'package.json'), 'utf8'))
        const files = readdirSync(directory).filter((name) => /^(licen[sc]e|copying|notice)([.-]|$)/i.test(name) && statSync(resolve(directory, name)).isFile()).sort()
        const texts = files.map((name) => readFileSync(resolve(directory, name), 'utf8'))
        // A package that ships no license file has its notice kept in scripts/licenses/ (GSAP: its source headers).
        const kept = resolve(__dirname, 'scripts/licenses', `${pkg.name}-NOTICE.txt`)
        if (!texts.length && /^[a-z0-9-]+$/.test(pkg.name) && existsSync(kept)) texts.push(readFileSync(kept, 'utf8'))
        if (!texts.length) this.error(`Missing bundled license text: ${pkg.name}@${pkg.version}`)
        notices.push(`${pkg.name}@${pkg.version}\nDeclared license: ${pkg.license ?? 'See notice'}\n\n${texts.join('\n\n')}`)
      }
      this.emitFile({ type: 'asset', fileName: 'THIRD_PARTY_LICENSES.txt', source: notices.join('\n\n----------------------------------------\n\n') })
    }
  }
}

/**
 * Effects: a vendored HyperFrames unit imported as `<file>.html?fx` becomes a module (its styles, markup and one
 * script function), so the render page runs it under its CSP with no inline scripts (src/shared/fx-html.ts).
 */
function hyperframesEffects(): Plugin {
  return {
    name: 'hyperframes-effects',
    enforce: 'pre',
    load(id) {
      const match = /^(.*\.html)\?fx(?:&.*)?$/.exec(id)
      if (!match) return null
      this.addWatchFile(match[1])
      return effectModule(readFileSync(match[1], 'utf8'))
    }
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts')
        }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          // The motion graphic templates, rendered offscreen by main (graphics-render.ts).
          graphics: resolve(__dirname, 'src/renderer/graphics.html')
        }
      }
    },
    plugins: [
      react(),
      hyperframesEffects(),
      bundledLicenseNotices(),
      {
        name: 'development-content-security-policy',
        apply: 'serve',
        transformIndexHtml(html) {
          // React Refresh injects an inline bootstrap; HMR uses a local socket.
          // This transform never runs in packaged builds.
          return html
            .replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
            .replace("connect-src 'none'", "connect-src 'self' ws://localhost:* ws://127.0.0.1:*")
        }
      }
    ],
    define: {
      __APP_VERSION__: JSON.stringify(displayVersion())
    },
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer')
      }
    }
  }
})
