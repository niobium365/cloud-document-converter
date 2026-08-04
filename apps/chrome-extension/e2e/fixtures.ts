import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  chromium,
  test as base,
  type Browser,
  type BrowserContext,
} from '@playwright/test'
import { e2eExtensionId } from './extension'

const extensionRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const extensionPath = resolve(extensionRoot, 'dist')
const profilePath = resolve(
  extensionRoot,
  process.env.FEISHU_E2E_PROFILE_DIR ?? '.e2e/feishu-profile',
)

type E2EFixtures = {
  e2eContext: BrowserContext
  extensionId: string
}

type E2EOptions = {
  e2eHeadless: boolean
}

export const test = base.extend<E2EFixtures & E2EOptions>({
  e2eHeadless: [true, { option: true }],

  e2eContext: async ({ e2eHeadless }, use) => {
    if (!existsSync(resolve(extensionPath, 'manifest.json'))) {
      throw new Error('Extension build is missing. Run pnpm run build:dev first.')
    }

    const cdpUrl = process.env.FEISHU_E2E_CDP_URL
    let browser: Browser | undefined
    let context: BrowserContext

    if (cdpUrl) {
      browser = await chromium.connectOverCDP(cdpUrl)
      context = browser.contexts()[0]
      if (!context) {
        throw new Error(`No browser context is available at ${cdpUrl}`)
      }
    } else {
      context = await chromium.launchPersistentContext(profilePath, {
        channel: 'chromium',
        headless: e2eHeadless,
        args: [
          `--disable-extensions-except=${extensionPath}`,
          `--load-extension=${extensionPath}`,
        ],
      })
    }

    await use(context)
    if (browser) {
      await browser.close()
    } else {
      await context.close()
    }
  },

  extensionId: async ({ e2eContext }, use) => {
    const cdpUrl = process.env.FEISHU_E2E_CDP_URL
    if (cdpUrl) {
      await use(e2eExtensionId)
      return
    }

    let [worker] = e2eContext.serviceWorkers()
    if (!worker) {
      worker = await e2eContext.waitForEvent('serviceworker')
    }
    await use(new URL(worker.url()).host)
  },
})

export { expect } from '@playwright/test'
