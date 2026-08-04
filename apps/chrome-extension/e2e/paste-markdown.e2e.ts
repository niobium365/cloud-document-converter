import { expect, test } from './fixtures'
import {
  expectRenderedText,
  fixture,
  insertedBlocks,
  openFeishuDocument,
  pasteMarkdown,
  requiredEnvironment,
} from './helpers'

test.describe.configure({ mode: 'serial' })

test('pastes the wiki-link fixture into a Docx document', async ({
  e2eContext,
  extensionId,
}) => {
  const documentPage = await openFeishuDocument(
    e2eContext,
    requiredEnvironment('FEISHU_E2E_DOCX_URL'),
  )
  const markdown = fixture('feishu-wiki-link.md')
  const body = await pasteMarkdown({
    context: e2eContext,
    documentPage,
    extensionId,
    markdown,
  })

  const linkBlock = insertedBlocks(body).find(
    block => block.type === 'bullet',
  ) as { text?: { apool?: { numToAttrib?: Record<string, [string, string]> } } } | undefined
  const component = Object.values(linkBlock?.text?.apool?.numToAttrib ?? {})
    .find(([type]) => type === 'inline-component')
  const mention = JSON.parse(component?.[1] ?? '{}') as { data?: { token?: string } }

  expect(mention.data?.token).toBe('FwPawM5tBiwlJFkFXmdc2eSMnTh')
  await expectRenderedText(documentPage, '安全车联网项目多链路聚合(智能路由)功能详细设计评审')
})

test('pastes Markdown into a wiki document URL', async ({
  e2eContext,
  extensionId,
}) => {
  const documentPage = await openFeishuDocument(
    e2eContext,
    requiredEnvironment('FEISHU_E2E_WIKI_URL'),
  )
  const markdown = fixture('feishu-wiki-link.md')
  await pasteMarkdown({
    context: e2eContext,
    documentPage,
    extensionId,
    markdown,
  })

  await expectRenderedText(documentPage, '关键产出')
})

test('uses content-sized widths for table columns', async ({
  e2eContext,
  extensionId,
}) => {
  const documentPage = await openFeishuDocument(
    e2eContext,
    requiredEnvironment('FEISHU_E2E_DOCX_URL'),
  )
  const markdown = fixture('table-column-widths.md')
  const body = await pasteMarkdown({
    context: e2eContext,
    documentPage,
    extensionId,
    markdown,
  })

  const table = insertedBlocks(body).find(block => block.type === 'table') as {
    column_set?: Record<string, { column_width: number }>
  } | undefined
  const widths = Object.values(table?.column_set ?? {}).map(column => column.column_width)

  expect(widths).toHaveLength(2)
  expect(widths[1]).toBeGreaterThan(widths[0]!)
  await expectRenderedText(documentPage, '安全车联网项目多链路聚合智能路由详细设计评审已完成')
})
