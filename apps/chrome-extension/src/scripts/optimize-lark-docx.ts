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

// helper to generate 27-character base62 block ID
const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const generateId = (): string =>
  Array.from({ length: 27 })  // block IDs are 27-char base62
    .map(() => ALPHABET[Math.floor(Math.random() * ALPHABET.length)])
    .join('');

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

  // Find nested Mermaid plaintext blocks, all level code blocks, and quotes with $$$ prefix
  const pageChildren: BlockModel[] = (root as any).children as BlockModel[];
  const nestedMermaidBlocks: BlockModel[] = [];
  const quoteCalloutBlocks: BlockModel[] = [];
  
  const scanDescendants = (nodes: BlockModel[]) => {
    for (const n of nodes) {
      if (n.type === 'code') {
        const code: string =
          n.snapshot?.zoneState?.allText ??
          n.snapshot?.text?.initialAttributedTexts?.text?.[0] ?? '';
        const lang = (n.snapshot?.language ?? '').toLowerCase();
        const mermaidPlainRegex = /^\s*(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram|journey|gantt|pie|mindmap|timeline|quadrantChart|gitGraph|requirementDiagram|c4context|c4container|c4component|c4dynamic|c4deployment)\b/i;
        const isMermaid =
          lang === 'mermaid' ||
          /^```?\s*mermaid/.test(code) ||
          mermaidPlainRegex.test(code);
        if (isMermaid) nestedMermaidBlocks.push(n);
      }
      if (n.type === 'quote') {
        // Check if quote block text starts with $$$
        const text = n.snapshot?.text?.initialAttributedTexts?.text?.[0] ?? '';
        if (text.startsWith('$$$')) {
          quoteCalloutBlocks.push(n);
        }
      }
      if (n.children.length) scanDescendants(n.children);
    }
  };
  scanDescendants([root]);
  const mermaidBlocks = nestedMermaidBlocks.slice(0, 10);
  window.console.log(`[Optimize] Found ${mermaidBlocks.length} nested Mermaid block(s):`, mermaidBlocks.map(b => b.record?.id));
  const tableBlocks: BlockModel[] = pageChildren.filter((n: BlockModel) => {
    if (n.type !== 'table') return false;
    const snapshot = n.struct?.record?.snapshot as any;
    return !snapshot?.header_row || !snapshot?.header_column;
  }).slice(0, 20);
  console.log(`[Optimize] Found ${tableBlocks.length} table block(s) needing header update:`, tableBlocks.map(b => b.record?.id));
  
  const calloutBlocks = quoteCalloutBlocks.slice(0, 10);
  console.log(`[Optimize] Found ${calloutBlocks.length} quote block(s) to convert to callout:`, calloutBlocks.map(b => b.record?.id));

  if (!mermaidBlocks.length && !tableBlocks.length && !calloutBlocks.length) {
    Toast.warning({ content: 'No optimizations needed.' });
    return;
  }
  const summaryTasks: string[] = [];
  if (mermaidBlocks.length) summaryTasks.push(`${mermaidBlocks.length} Mermaid block(s)`);
  if (tableBlocks.length) summaryTasks.push(`${tableBlocks.length} table header(s)`);
  if (calloutBlocks.length) summaryTasks.push(`${calloutBlocks.length} callout(s)`);
  Toast.info({ content: `Optimizing ${summaryTasks.join(' and ')}...` });

  // Build change_map for /blocks/user_change endpoint
  interface ChangePayload { id: string; version: number; payload: { ops: any[] } }

  // parentOps removed (multi-level parent ops managed directly in changeMap)
  const changeMap: Record<string, ChangePayload> = {};

  // helper to locate block model by ID recursively
  const findBlockById = (id: string, nodes: BlockModel[]): BlockModel | undefined => {
    for (const n of nodes) {
      if (n.record?.id === id) return n;
      const found = findBlockById(id, n.children);
      if (found) return found;
    }
    return undefined;
  }; // usage: findBlockById(parentId, [root as BlockModel])

  // Apply table header updates using hoisted tableBlocks
  if (tableBlocks.length) {
    for (const tbl of tableBlocks) {
      const tblId = tbl.record?.id as string
      if (!tblId) continue
      const tblVer = (tbl as any).struct?.version ?? 1
      changeMap[tblId] = {
        id: tblId,
        version: tblVer,
        payload: {
          ops: [
            { p: ['header_row'], action: { oi: true } },
            { p: ['header_column'], action: { oi: true } },
          ]
        }
      }
    }
  }
  
  // Convert quote blocks with $$$ prefix to callout blocks
  if (calloutBlocks.length) {
    for (const quote of calloutBlocks) {
      const quoteId = quote.record?.id as string;
      if (!quoteId) continue;
      
      // Extract the content directly from the quote block
      const textContent = quote.snapshot?.text?.initialAttributedTexts?.text?.[0] ?? '';
      const cleanContent = textContent.replace(/^\$\$\$\s*/, ''); // Remove $$$ prefix
      
      // determine parent block (usually page) and position index
      const parentId = (quote as any).struct?.record?.snapshot?.parent_id ?? pageBlockId;
      const parentModel = findBlockById(parentId, [root as BlockModel]);
      const siblings = parentModel?.children ?? [];
      const idx = siblings.findIndex(c => c.record?.id === quoteId);
      if (idx === -1) continue;
      
      // ensure changeMap entry for this parent
      if (!changeMap[parentId]) {
        const parentVer = (parentModel as any).struct?.version ?? 1;
        changeMap[parentId] = { id: parentId, version: parentVer, payload: { ops: [] } };
      }
      
      // delete old quote block and insert new callout block
      const newId = generateId();
      changeMap[parentId].payload.ops.push({ p: ['children', idx], action: { ld: quoteId } });
      changeMap[parentId].payload.ops.push({ p: ['children', idx], action: { li: newId } });
      
      // Create a new callout block with proper properties
      changeMap[newId] = {
        id: newId,
        version: 0,
        payload: { 
          ops: [{ 
            p: [], 
            action: { 
              oi: {
                type: 'callout',
                children: [],
                comments: [],
                revisions: [],
                author: root.record.snapshot.author,
                parent_id: parentId,
                // Required callout properties
                emoji_id: 'bulb',                  // Light bulb emoji
                emoji_value: '1f4a1',              // Light bulb unicode
                background_color: 'rgb(255,245,235)',  // Light orange background
                border_color: 'rgb(254,212,164)',      // Orange border
                text_color: '',                     // Default text color
                align: 'left'                       // Text alignment
              } 
            } 
          }] 
        },
      };
      
      // Reuse the original text block by changing its parent_id
      changeMap[quoteId] = {
        id: quoteId,
        version: 1,  // Increment version for the update
        payload: {
          ops: [
            {
              p: ['parent_id'],
              action: {
                od: parentId,         // Original parent (the page or container)
                oi: newId            // New parent (the callout)
              }
            },
            // Add operation to correctly remove the leading $$$ prefix
            {
              p: ['text'],
              subType: {
                t: 'easysync',
                o: {
                  zone_changesets: {
                    0: 'Z:b<3-3$'  // Remove first 3 characters ($$$)
                  },
                  apool: {
                    numToAttrib: {},
                    nextNum: 0
                  }
                }
              }
            }
          ]
        }
      };
      
      // Add the original text block as a child of the callout
      changeMap[newId].payload.ops.push({
        p: ['children', 0],
        action: { li: quoteId }
      });
      
      // We don't need to create a new text block since we're reusing the original
    }
  }




  console.log('Page children:', pageChildren.map(c => ({ id: c.record?.id, type: c.type })));
  console.log('Mermaid blocks:', mermaidBlocks.map(b => ({ id: b.record?.id })));
  for (const blk of mermaidBlocks) {

    const blkId = blk.record?.id || '';  // block ID from record.id
    if (!blkId) continue;
    // determine parent block and its children index
    const parentId = (blk as any).struct?.record?.snapshot?.parent_id ?? pageBlockId;
    const parentModel = findBlockById(parentId, [root as BlockModel]);
    const siblings = parentModel?.children ?? [];
    const idx = siblings.findIndex(c => c.record?.id === blkId);
    if (idx === -1) continue;

    // ensure changeMap entry for this parent
    if (!changeMap[parentId]) {
      const parentVer = (parentModel as any).struct?.version ?? 1;
      changeMap[parentId] = { id: parentId, version: parentVer, payload: { ops: [] } };
    }
    // delete old block and insert new mermaid block
    const newId = generateId();
    changeMap[parentId].payload.ops.push({ p: ['children', idx], action: { ld: blkId } });
    changeMap[parentId].payload.ops.push({ p: ['children', idx], action: { li: newId } });

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
      parent_id: (blk as any).struct?.record?.snapshot?.parent_id ?? pageBlockId,
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




  const body = {
    member_id: String(memberId),
    uuid: crypto.randomUUID(),
    page_id: pageBlockId,
    change_map: changeMap,
  }


  try {
    // Try to discover the exact internal batch_update endpoint by looking at
    // the `user_change` XHR the editor always fires. We then swap the suffix.
    /*
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
    */
    // CSRF token mirrored from background into page localStorage
    const csrf = localStorage.getItem('cdc_csrf_token') ?? undefined

    // Stage 1: dummy op to get correct block versions for existing blocks
    const dummyChangeMap: Record<string, ChangePayload> = {};
    for (const [id, payload] of Object.entries(changeMap)) {
      // only dummy for existing blocks (version > 0)
      if (payload.version > 0) {
        dummyChangeMap[id] = {
          id,
          version: 1,
          payload: { ops: [{ p: ['background_color'], action: { od: 'rgb(2,2,2)' } }] }
        };
      }
    }
    if (Object.keys(dummyChangeMap).length) {
      const dummyBody = { member_id: String(memberId), uuid: crypto.randomUUID(), page_id: pageBlockId, change_map: dummyChangeMap };
      console.log('Dummy POST → /space/api/docx/blocks/user_change', dummyBody);
      const dummyResp = await fetch('/space/api/docx/blocks/user_change', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json;charset=UTF-8', ...(csrf ? { 'x-csrftoken': csrf } : {}) },
        body: JSON.stringify(dummyBody)
      });
      const dummyJson: any = await dummyResp.json();
      console.log(`dummyJson:{}`, dummyJson);
      if (dummyJson?.data?.block_map) {
        const blockMap = dummyJson.data.block_map as Record<string, { id: string; version: number }>;
        for (const [bid, info] of Object.entries(blockMap)) {
          if (changeMap[bid]) changeMap[bid].version = info.version;
        }
      }
    }

    const paths: string[] = [
      '/space/api/docx/blocks/user_change',
      //discovered,
      //`/space/api/docx/blocks/batch_update?document_id=${docToken}&document_revision_id=-1`,
      //`/space/api/docx/batch_update?document_id=${docToken}&document_revision_id=-1`,
      //`/space/api/docx/v1/batch_update?document_id=${docToken}&document_revision_id=-1`,
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
