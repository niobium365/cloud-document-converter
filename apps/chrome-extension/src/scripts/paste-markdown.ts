/**
 * Paste from Markdown feature - inserts clipboard markdown text into Lark document
 */

import { Toast } from '@dolphin/lark'

// Helper for base62 IDs (27-char) to match Lark block IDs
const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
const generateId = (): string => Array.from({ length: 27 }).map(() => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('')

const main = async () => {
  try {
    // Get credentials (must be injected into localStorage by background.js)
    const memberId = window.localStorage.getItem('cdc_early_member_id')
    if (!memberId) {
      Toast.error({ content: 'Cannot insert text: Member ID not found. Please try again later.' })
      console.error('Member ID not found in localStorage')
      return
    }
    const csrf = window.localStorage.getItem('cdc_csrf_token') || ''

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
    // Get current document info
    const docIdMatch = window.location.pathname.match(/\/docx\/([^/]+)/)
    if (!docIdMatch) {
      Toast.error({ content: 'Cannot insert text: Not in a Lark document.' })
      return
    }
    const docToken = docIdMatch[1]
    
    // Determine page block ID (from record)
    const pageBlockId = root.record?.id as string;
    if (!pageBlockId) {
        Toast.warning({ content: 'Cannot determine page block ID' });
        return;
    }

    // Get text from localStorage (set by background script from popup clipboard content)
    try {
      const markdownText = window.localStorage.getItem('cdc_markdown_content')
      if (!markdownText) {
        Toast.info({ content: 'No text found in clipboard.' })
        return
      }

      // Clear the stored content after retrieving it
      try { window.localStorage.removeItem('cdc_markdown_content'); } catch {}
      
      // Insert the text as a new paragraph
      await insertParagraph(pageBlockId, markdownText, memberId, csrf)
      
      Toast.success({ content: 'Markdown text inserted successfully!' })
    } catch (error) {
      console.error('Clipboard access error:', error)
      Toast.error({ content: 'Failed to access clipboard. Please check permissions.' })
    }
  } catch (error) {
    console.error('Error in paste markdown:', error)
    Toast.error({ content: 'Failed to paste markdown content.' })
  }
}

/**
 * Get the page block ID from window.__Lark__ object
 */
const getPageBlockId = async (): Promise<string | null> => {
  // Try to find the page block ID from the window.__Lark__ object
  // This is similar to what we do in optimize-lark-docx.ts
  const larkObj: any = (window as any).__Lark__
  if (!larkObj) return null

  // Look for the document object which should contain the page block ID
  let pageBlockId: string | null = null
  try {
    // Check data store where page info might be available
    const stores = larkObj?.store?._states
    if (stores) {
      for (const [key, state] of Object.entries(stores)) {
        // Need to cast state to any since we're not sure about its structure
        const stateAny = state as any
        if (key.includes('docx/document') && stateAny?.document?.pageBlockId) {
          pageBlockId = stateAny.document.pageBlockId
          break
        }
      }
    }

    // If we couldn't find it in the store, try other potential locations
    if (!pageBlockId && larkObj?.docx?.document?.pageBlockId) {
      pageBlockId = larkObj.docx.document.pageBlockId
    }
  } catch (e) {
    console.error('Error getting page block ID:', e)
    return null
  }

  return pageBlockId
}

/**
 * Insert a paragraph into the document
 */
const insertParagraph = async (
  pageBlockId: string,
  text: string,
  memberId: string,
  csrf: string
): Promise<boolean> => {
  try {
    // Create change map for the text block
    // @ts-ignore PageMain provided by Lark runtime
    const PageMain: any = (window as any).PageMain
    const root = PageMain.blockManager?.rootBlockModel
    if (!root) {
      console.error('Cannot access document model')
      return false
    }
    
    // Get author from document model
    const author = root.record.snapshot.author || memberId
    
    // 1. Generate block IDs for new paragraphs
    const newBlockId = generateId()
    
    // Find existing blocks
    const siblings = root.children || []
    // We'll insert at the beginning of the document as suggested
    const insertPosition = 0
    
    // Target block to modify (parent)
    const targetBlockId = pageBlockId
    
    // Build operations for parent block
    const parentOps = [
      // Optional: delete an existing block if needed
      // {p: ['children', insertPosition], action: {ld: siblings[insertPosition]?.id}},
      
      // Insert new paragraph
      {p: ['children', insertPosition], action: {li: newBlockId}}
    ]
    
    // Build change_map
    const changeMap: Record<string, any> = {
      [targetBlockId]: {
        id: targetBlockId,
        version: 1, // Will be updated after dummy op
        payload: { ops: parentOps }
      },
      
      // Define new text block
      [newBlockId]: {
        id: newBlockId,
        version: 0,
        payload: {
          ops: [{
            p: [],
            action: {
              oi: {
                type: 'text',
                children: [],
                comments: [],
                revisions: [],
                author: author,
                text: {
                  initialAttributedTexts: {
                    text: { '0': text },
                    attribs: { '0': '*0+k' } // k is length of text, adjust if needed
                  },
                  apool: {
                    numToAttrib: { '0': ['author', author] },
                    nextNum: 1
                  }
                },
                folded: false,
                parent_id: targetBlockId
              }
            }
          }]
        }
      }
    }
    
    // 2. Stage 1: dummy op to get correct block versions - EXACTLY like optimize-lark-docx.ts
    const dummyChangeMap: Record<string, any> = {}
    for (const [id, payload] of Object.entries(changeMap)) {
      if (payload.version > 0) {
        dummyChangeMap[id] = {
          id,
          version: 1,
          payload: { ops: [{ p: ['background_color'], action: { od: 'rgb(2,2,2)' } }] }
        }
      }
    }
    
    if (Object.keys(dummyChangeMap).length) {
      const dummyBody = {
        member_id: String(memberId),
        uuid: crypto.randomUUID(),
        page_id: pageBlockId,
        change_map: dummyChangeMap
      }
      
      console.log('Dummy POST → /space/api/docx/blocks/user_change', dummyBody)
      const dummyResp = await fetch('/space/api/docx/blocks/user_change', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json;charset=UTF-8', ...(csrf ? { 'x-csrftoken': csrf } : {}) },
        body: JSON.stringify(dummyBody)
      })
      
      const dummyJson: any = await dummyResp.json()
      console.log('dummyJson:', dummyJson)
      
      if (dummyJson?.data?.block_map) {
        const blockMap = dummyJson.data.block_map as Record<string, { id: string; version: number }>
        for (const [bid, info] of Object.entries(blockMap)) {
          if (changeMap[bid]) changeMap[bid].version = info.version
        }
      }
    }
    
    // 3. Prepare the final request body
    const body = {
      member_id: String(memberId),
      uuid: crypto.randomUUID(),
      page_id: pageBlockId,
      change_map: changeMap
    }
    
    // 4. Try multiple paths just like optimize-lark-docx.ts
    const paths: string[] = [
      '/space/api/docx/blocks/user_change'
      // We could add other potential paths here as in optimize-lark-docx.ts
    ]
    
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
    
    return resp.ok && json?.code === 0
  } catch (error) {
    console.error('Error inserting paragraph:', error)
    return false
  }
}

/**
 * Generate a UUID v4
 */
const generateUuid = (): string => {
  return crypto.randomUUID()
}

// Execute the main function
main().catch(console.error)
