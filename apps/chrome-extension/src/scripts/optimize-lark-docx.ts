/*
 * Replace Mermaid code blocks in a Lark document with the official Mermaid add-on
 * (component_type_id = blk_631fefbbae02400430b8f9f4).
 *
 * IMPORTANT: this only relies on objects already exposed in the Lark editor.
 * We avoid any extra auth – the user is already logged in so fetch/cookies work.
 *
 * This is a best-effort client-side alternative to the slow Python script.
 */
import { Toast, docx } from '@dolphin/lark'

const MERMAID_ADDON_ID = 'blk_631fefbbae02400430b8f9f4'


const optimize = async () => {
  // @ts-ignore – PageMain is injected by the Lark editor runtime
  const PageMain: any = (window as any).PageMain
  if (!PageMain) {
    Toast.warning({ content: 'Not a Lark doc page' })
    return
  }

  const root = PageMain.blockManager?.rootBlockModel
  if (!root) {
    Toast.warning({ content: 'Cannot access document model.' })
    return
  }

  const docToken = location.pathname.split('/').pop()
  if (!docToken) {
    Toast.warning({ content: 'Cannot resolve doc token.' })
    return
  }

  interface BlockModel {
    block_id: string
    type: string
    snapshot: any
    parent_id?: string
    children: BlockModel[]
  }

  const mermaidBlocks: BlockModel[] = []

  const walk = (node: BlockModel) => {
    if (node.type === 'code') {
      const code: string =
        node.snapshot?.zoneState?.allText ??
        node.snapshot?.text?.initialAttributedTexts?.text?.[0] ?? ''
      const lang = (node.snapshot?.language ?? '').toLowerCase()
      const mermaidPlainRegex = /^(\s*)(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram|journey|gantt|pie|mindmap|timeline|quadrantChart|gitGraph|requirementDiagram|c4context|c4container|c4component|c4dynamic|c4deployment)\b/i
      const isMermaid =
        lang === 'mermaid' ||
        /^```?\s*mermaid/.test(code) ||
        mermaidPlainRegex.test(code)
      if (isMermaid) {
        mermaidBlocks.push(node)
      }
    }
    for (const child of node.children ?? []) walk(child)
  }
  walk(root)

  if (!mermaidBlocks.length) {
    Toast.warning({ content: 'No Mermaid blocks found.' })
    return
  }

  Toast.info({ content: `Converting ${mermaidBlocks.length} Mermaid block(s)...` })

  // Build change_map for /blocks/user_change endpoint
  interface ChangePayload { id: string; version: number; payload: { ops: any[] } }

  const pageOps: any[] = []
  const changeMap: Record<string, ChangePayload> = {}

  // helper to generate 22-char id (base62 from uuid)
  const generateId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 22)

  // map children index
  const parentMap = new Map<string, BlockModel>()
  const collectParents = (node: BlockModel) => {
    for (const child of node.children ?? []) {
      parentMap.set(child.block_id, node)
      collectParents(child)
    }
  }
  collectParents(root as any)

  for (const blk of mermaidBlocks) {
    const parent = parentMap.get(blk.block_id) as BlockModel | undefined
    if (!parent) continue

    const idx = parent.children.findIndex(c => c.block_id === blk.block_id)
    if (idx === -1) continue

    // op to delete old id
    pageOps.push({ p: ['children', idx], action: { ld: blk.block_id } })

    const newId = generateId()
    // op to insert new id
    pageOps.push({ p: ['children', idx], action: { li: newId } })

    const mermaidCode: string =
      blk.snapshot?.zoneState?.allText ??
      blk.snapshot?.text?.initialAttributedTexts?.text?.[0] ?? ''

    const oiObject = {
      type: 'isv',
      children: [],
      parent_id: root.block_id,
      add_ons: {
        component_id: '',
        component_type_id: MERMAID_ADDON_ID,
        record: { data: mermaidCode, theme: 'default', view: 'chart' },
      },
    }

    changeMap[newId] = {
      id: newId,
      version: 0,
      payload: { ops: [{ p: [], action: { oi: oiObject } }] },
    }
  }

  // page block entry
  changeMap[root.block_id] = {
    id: root.block_id,
    version: root.version ?? 0,
    payload: { ops: pageOps },
  }

  // Get member id that background worker mirrored into localStorage
  const getStoredMemberId = (): string | undefined => {
    return localStorage.getItem('cdc_early_member_id') ?? undefined
  }

    
    let memberId = (await getStoredMemberId()) ?? localStorage.getItem('cdc_early_member_id')

    if (!memberId) {
      Toast.warning({ content: 'Cannot determine member_id; abort.' })
      return
    }

  const body = {
    member_id: String(memberId),
    uuid: crypto.randomUUID(),
    page_id: root.block_id,
    change_map: changeMap,
  }


  try {
    // Try to discover the exact internal batch_update endpoint by looking at
    // the `user_change` XHR the editor always fires. We then swap the suffix.
    const discovered = (() => {
      const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[]
      for (const e of entries) {
        const url = e.name
        if (url.includes('/blocks/user_change')) {
          const rel = url.replace(location.origin, '')
          const base = rel.replace('user_change', '')
          const candidate = `${base}batch_update?document_id=${docToken}&document_revision_id=-1`
          return candidate
        }
        if (url.includes('/api/docx') && url.includes('batch_update') && !url.includes('/open-apis/')) {
          // strip origin
          const rel = url.replace(location.origin, '')
          return rel
        }
      }
      return undefined
    })()

    // CSRF token mirrored from background into page localStorage
    const csrf = localStorage.getItem('cdc_csrf_token') ?? undefined

    const paths: string[] = [
      '/space/api/docx/blocks/user_change',
      discovered,
      `/space/api/docx/blocks/batch_update?document_id=${docToken}&document_revision_id=-1`,
      `/space/api/docx/batch_update?document_id=${docToken}&document_revision_id=-1`,
      `/space/api/docx/v1/batch_update?document_id=${docToken}&document_revision_id=-1`,
    ].filter((p): p is string => typeof p === 'string')

    let resp: Response | null = null
    let lastErr: any = null
    for (const p of paths) {
      try {
        const r = await fetch(p, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json;charset=UTF-8',
            ...(csrf ? { 'x-csrftoken': csrf } : {}),
          },
          body: JSON.stringify(body),
          credentials: 'include',
        })
        if (r.ok) {
          resp = r
          // break on first successful HTTP status regardless of body format
          break
        }

      } catch (e) {
        lastErr = e
      }
    }

    if (!resp) throw lastErr ?? new Error('user_change request failed')

    let json: any = {}
    try {
      json = await resp.json()
    } catch (e) {
      console.warn('Non-JSON response from user_change', e)
      json = {}
    }
    if (resp.ok && json?.data?.code === 0) {
      Toast.success({ content: 'Mermaid blocks converted!' })
      // refresh local editor to show addon – easiest is reload.
      location.reload()
    } else {
      Toast.warning({ content: `API error: ${json?.msg ?? json?.message ?? resp.status}` })
    }
  } catch (err: any) {
    console.error('batch_update error', err)
    if (err?.response?.url?.includes('https://www.larksuite.com')) {
      location.href = 'https://www.larksuite.com'
    }
    Toast.warning({ content: err?.message ?? 'Network error.' })
  }
}

optimize()
