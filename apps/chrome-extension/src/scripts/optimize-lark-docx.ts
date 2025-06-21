/*
 * Replace Mermaid code blocks in a Lark document with the official Mermaid add-on
 * (component_type_id = blk_631fefbbae02400430b8f9f4).
 *
 * IMPORTANT: this only relies on objects already exposed in the Lark editor.
 * We avoid any extra auth – the user is already logged in so fetch/cookies work.
 *
 * This is a best-effort client-side alternative to the slow Python script.
 */
import { Toast } from '@dolphin/lark'

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

  // Determine page block ID (from record)
  const pageBlockId = root.record?.id as string;
  if (!pageBlockId) {
    Toast.warning({ content: 'Cannot determine page block ID' });
    return;
  }
  // Determine page block version (per-doc or generic cache, fallback to struct/initial)
  const versionKey = `cdc_page_version_${docToken}`;
  const perDocStr = localStorage.getItem(versionKey);
  const perDocVer = perDocStr !== null ? Number(perDocStr) : NaN;
  const genericStr = localStorage.getItem('cdc_page_version');
  const genericVer = genericStr !== null ? Number(genericStr) : NaN;
  const pageBlockVersion = Number.isFinite(perDocVer) && perDocVer > 0
    ? perDocVer
    : Number.isFinite(genericVer) && genericVer > 0
    ? genericVer
    : (root as any).struct?.version ?? root.initialVersion ?? 0;

  // Get member id (for author)
  const getStoredMemberId = (): string | undefined =>
    localStorage.getItem('cdc_early_member_id') ?? undefined
  const memberId = (await getStoredMemberId()) ?? localStorage.getItem('cdc_early_member_id')
  if (!memberId) {
    Toast.warning({ content: 'Cannot determine member_id; abort.' })
    return
  }

  interface BlockModel {
    record?: { id: string }
    type: string
    snapshot: any
    children: BlockModel[]
  }

  // Scan only direct page children for Mermaid code blocks
  const pageChildren: BlockModel[] = (root as any).children as BlockModel[];
  const mermaidBlocks: BlockModel[] = pageChildren.filter((node: BlockModel) => {
    if (node.type !== 'code') return false;
    const code: string =
      node.snapshot?.zoneState?.allText ??
      node.snapshot?.text?.initialAttributedTexts?.text?.[0] ?? '';
    const lang = (node.snapshot?.language ?? '').toLowerCase();
    const mermaidPlainRegex = /^\s*(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram|journey|gantt|pie|mindmap|timeline|quadrantChart|gitGraph|requirementDiagram|c4context|c4container|c4component|c4dynamic|c4deployment)\b/i;
    const isMermaid =
      lang === 'mermaid' ||
      /^```?\s*mermaid/.test(code) ||
      mermaidPlainRegex.test(code);
    return isMermaid;
  }).slice(0, 10);
  console.log(`[Optimize] Found ${mermaidBlocks.length} Mermaid block(s):`, mermaidBlocks.map(b => b.record?.id));
  const tableBlocks: BlockModel[] = pageChildren.filter((n: BlockModel) => {
    if (n.type !== 'table') return false;
    const snapshot = n.struct?.record?.snapshot as any;
    return !snapshot?.header_row || !snapshot?.header_column;
  }).slice(0, 20);
  console.log(`[Optimize] Found ${tableBlocks.length} table block(s) needing header update:`, tableBlocks.map(b => b.record?.id));

  if (!mermaidBlocks.length && !tableBlocks.length) {
    Toast.warning({ content: 'No optimizations needed for Mermaid or table headers.' });
    return;
  }
  const summaryTasks: string[] = [];
  if (mermaidBlocks.length) summaryTasks.push(`${mermaidBlocks.length} Mermaid block(s)`);
  if (tableBlocks.length) summaryTasks.push(`${tableBlocks.length} table header(s)`);
  Toast.info({ content: `Optimizing ${summaryTasks.join(' and ')}...` });

  // Build change_map for /blocks/user_change endpoint
  interface ChangePayload { id: string; version: number; payload: { ops: any[] } }

  const pageOps: any[] = []
  const changeMap: Record<string, ChangePayload> = {}

  // Apply table header updates using hoisted tableBlocks
  if (tableBlocks.length) {
    for (const tbl of tableBlocks) {
      const tblId = tbl.record?.id as string
      if (!tblId) continue
      const tblVer = (tbl as any).struct?.version ?? 1
      changeMap[tblId] = {
        id: tblId,
        version: tblVer,
        payload: { ops: [
          { p: ['header_row'], action: { oi: true } },
          { p: ['header_column'], action: { oi: true } },
        ] }
      }
    }
  }

  // helper to generate 27-character base62 block ID
  const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const generateId = (): string =>
    Array.from({ length: 27 })  // block IDs are 27-char base62
      .map(() => ALPHABET[Math.floor(Math.random() * ALPHABET.length)])
      .join('');

  

  console.log('Page children:', pageChildren.map(c => ({ id: c.record?.id, type: c.type }))); console.log('Mermaid blocks:', mermaidBlocks.map(b => ({ id: b.record?.id }))); for (const blk of mermaidBlocks) {
    
    const blkId = blk.record?.id || '';  // block ID from record.id
    if (!blkId) continue;
    const idx = pageChildren.findIndex(c => c.record?.id === blkId)
    if (idx === -1) continue
    if (idx === -1) continue

    // op to delete old id
    pageOps.push({ p: ['children', idx], action: { ld: blkId } }) // delete old block

    const newId = generateId()
    // op to insert new id
    pageOps.push({ p: ['children', idx], action: { li: newId } })

    const mermaidCode: string =
      blk.snapshot?.zoneState?.allText ??
      blk.snapshot?.text?.initialAttributedTexts?.text?.[0] ?? ''

    const oiObject = {
      type: 'isv',
      children: [],
      comments: [],
      revisions: [],
      author: root.record.snapshot.author,
      data: { data: mermaidCode, theme: 'default', view: 'chart' },
      parent_id: pageBlockId,
      
      
      
      
      app_block_id: '',
      block_type_id: MERMAID_ADDON_ID,
      manifest: { view_type: 'block_h5', app_version: '0.0.100' },
      
      
      comment_details: {},
    }

    changeMap[newId] = {
      id: newId,
      version: 0,
      payload: { ops: [{ p: [], action: { oi: oiObject } }] },
    }
  }

  if(pageOps.length > 0) {
  // page block entry
  changeMap[pageBlockId] = {
    id: pageBlockId,
    version: pageBlockVersion,
    payload: { ops: pageOps },
  }
  }


  const body = {
    member_id: String(memberId),
    uuid: crypto.randomUUID(),
    page_id: pageBlockId,
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
    if (resp.ok && json?.code === 0) {
      Toast.success({ content: 'Done optimizing!' })

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
