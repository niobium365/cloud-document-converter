import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { generateChangeMap } from '../src/scripts/paste-md-core'

const casesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'cases')
const pageBlockId = 'test-page-block'
const author = { author: 'test-author', tenantId: 'test-tenant' }

type ChangeMap = Record<string, {
  payload?: { ops?: Array<{ action?: { oi?: Record<string, unknown>; li?: string } }> }
}>

function insertedBlocks(changeMap: ChangeMap): Record<string, unknown>[] {
  return Object.values(changeMap).flatMap(entry =>
    (entry.payload?.ops ?? [])
      .map(operation => operation.action?.oi)
      .filter((block): block is Record<string, unknown> =>
        !!block && typeof block === 'object',
      ),
  )
}

function firstText(block: Record<string, unknown>): string | undefined {
  const text = block.text as {
    initialAttributedTexts?: { text?: Record<string, string> }
  } | undefined

  return text?.initialAttributedTexts?.text?.['0']
}

function inlineComponents(block: Record<string, unknown>): Record<string, unknown>[] {
  const text = block.text as {
    apool?: { numToAttrib?: Record<string, [string, string]> }
  } | undefined

  return Object.values(text?.apool?.numToAttrib ?? {})
    .filter(([type]) => type === 'inline-component')
    .map(([, value]) => JSON.parse(value) as Record<string, unknown>)
}

describe('Markdown → Feishu change map cases', () => {
  const markdownCases = readdirSync(casesDir)
    .filter(file => file.endsWith('.md'))
    .sort()

  it.each(markdownCases)('%s generates a structurally valid change map', file => {
    const markdown = readFileSync(join(casesDir, file), 'utf8')
    const changeMap = generateChangeMap(pageBlockId, markdown, author)

    expect(changeMap[pageBlockId]).toBeDefined()

    for (const block of insertedBlocks(changeMap)) {
      expect(block.type).toBeTypeOf('string')
      expect(block.parent_id).toBeTypeOf('string')
    }
  })

  it('preserves the token of a Feishu wiki link', () => {
    const file = join(casesDir, 'feishu-wiki-link.md')
    const markdown = readFileSync(file, 'utf8')
    const changeMap = generateChangeMap(pageBlockId, markdown, author)
    const linkBlock = insertedBlocks(changeMap)
      .find(block => firstText(block) === '安全车联网项目多链路聚合(智能路由)功能详细设计评审')

    expect(linkBlock).toBeDefined()

    const mention = inlineComponents(linkBlock!)
      .find(component => component.type === 'mention_doc') as {
        data?: { token?: string; raw_url?: string; title?: string }
      } | undefined

    expect(mention?.data).toMatchObject({
      token: 'FwPawM5tBiwlJFkFXmdc2eSMnTh',
      raw_url: 'https://li.feishu.cn/wiki/FwPawM5tBiwlJFkFXmdc2eSMnTh',
      title: '安全车联网项目多链路聚合(智能路由)功能详细设计评审',
    })
  })

  it('assigns wider table columns to longer content', () => {
    const file = join(casesDir, 'table-column-widths.md')
    const markdown = readFileSync(file, 'utf8')
    const changeMap = generateChangeMap(pageBlockId, markdown, author)
    const table = insertedBlocks(changeMap).find(block => block.type === 'table')
    const columnSet = table?.column_set as Record<string, { column_width: number }> | undefined
    const widths = Object.values(columnSet ?? {}).map(column => column.column_width)

    expect(widths).toHaveLength(2)
    expect(widths[1]).toBeGreaterThan(widths[0]!)
    expect(widths[0]).toBeGreaterThanOrEqual(120)
    expect(widths[1]).toBeLessThanOrEqual(480)
  })
})
