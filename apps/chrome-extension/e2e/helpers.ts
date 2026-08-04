import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, type BrowserContext, type Page } from '@playwright/test'

const extensionRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const casesDir = join(extensionRoot, 'cases')

type UserChangeBody = {
  change_map?: Record<string, { payload?: { ops?: Array<{ action?: Record<string, unknown> }> } }>
}

function isUserChangeResponse(response: import('@playwright/test').Response): boolean {
  const request = response.request()
  if (request.method() !== 'POST') return false
  if (!new URL(response.url()).pathname.endsWith('/space/api/docx/blocks/user_change')) {
    return false
  }

  try {
    const body = JSON.parse(request.postData() ?? '{}') as UserChangeBody
    return Object.values(body.change_map ?? {}).some(entry =>
      entry.payload?.ops?.some(operation => !!operation.action?.li),
    )
  } catch {
    return false
  }
}

export function fixture(name: string): string {
  return readFileSync(join(casesDir, name), 'utf8')
}

export function requiredEnvironment(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Set ${name}; see e2e/README.md for the setup steps.`)
  }
  return value
}

export async function openFeishuDocument(context: BrowserContext, url: string): Promise<Page> {
  const page = await context.newPage()
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(
    () => Boolean((window as any).PageMain?.blockManager?.rootBlockModel?.record?.id),
    undefined,
    { timeout: 10 * 60_000 },
  )
  return page
}

async function placeCursorInDocument(page: Page): Promise<void> {
  await page.waitForSelector('[data-record-id]', { timeout: 60_000 })
  const placed = await page.evaluate(() => {
    const block = document.querySelector<HTMLElement>('[data-record-id]')
    if (!block) return false

    const editable = block.querySelector<HTMLElement>('[contenteditable="true"]') ?? block
    editable.focus()

    const selection = window.getSelection()
    if (!selection) return false

    const range = document.createRange()
    range.selectNodeContents(editable)
    range.collapse(false)
    selection.removeAllRanges()
    selection.addRange(range)
    return true
  })

  expect(placed).toBe(true)
}

export async function pasteMarkdown(options: {
  context: BrowserContext
  documentPage: Page
  extensionId: string
  markdown: string
}): Promise<UserChangeBody> {
  const { context, documentPage, extensionId, markdown } = options
  await documentPage.bringToFront()
  await placeCursorInDocument(documentPage)
  const finalChange = documentPage.waitForResponse(isUserChangeResponse, { timeout: 60_000 })

  const inputPage = await context.newPage()
  await inputPage.goto(`chrome-extension://${extensionId}/markdown-input.html`)
  const targetTabId = await inputPage.evaluate(async documentUrl => {
    const currentTab = await chrome.tabs.getCurrent()
    const tabs = await chrome.tabs.query({})
    const matchingTabs = tabs.filter(tab =>
      tab.id !== currentTab?.id &&
      tab.url?.split('#')[0] === documentUrl.split('#')[0],
    )
    return matchingTabs.at(-1)?.id
  }, documentPage.url())

  if (typeof targetTabId !== 'number') {
    throw new Error(`Could not identify the Feishu tab for ${documentPage.url()}`)
  }

  await inputPage.goto(
    `chrome-extension://${extensionId}/markdown-input.html?tabId=${targetTabId}`,
  )
  await inputPage.locator('#markdown-textarea').fill(markdown)
  await documentPage.bringToFront()
  await inputPage.locator('#submit-button').dispatchEvent('click')

  const response = await finalChange
  const responseBody = await response.json() as { code?: number }
  expect(responseBody.code).toBe(0)

  await inputPage.close()
  return JSON.parse(response.request().postData() ?? '{}') as UserChangeBody
}

export async function expectRenderedText(page: Page, text: string): Promise<void> {
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForFunction(
    value => document.body.innerText.includes(value),
    text,
    { timeout: 60_000 },
  )
}

export function insertedBlocks(body: UserChangeBody): Record<string, unknown>[] {
  return Object.values(body.change_map ?? {}).flatMap(entry =>
    (entry.payload?.ops ?? [])
      .map(operation => operation.action?.oi)
      .filter((block): block is Record<string, unknown> =>
        !!block && typeof block === 'object',
      ),
  )
}
