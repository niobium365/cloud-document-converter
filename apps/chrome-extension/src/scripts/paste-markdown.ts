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
 * Insert paragraphs into the document
 * Handles multi-line text by creating separate paragraph blocks
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
    
    // Split text by newlines to create multiple paragraphs
    const paragraphs = text.split(/\r?\n/).filter(p => p.trim().length > 0)
    if (paragraphs.length === 0) {
      console.warn('No valid paragraphs to insert')
      return false
    }

    // Table support: detect markdown table
    const tableHeaderRegex = /^\|(.+)\|$/;
    const tableDividerRegex = /^\|(?:\s*[-:]+\s*\|)+$/;
    if (paragraphs.length >= 2 && tableHeaderRegex.test(paragraphs[0].trim()) && tableDividerRegex.test(paragraphs[1].trim())) {
      // parse header and body rows
      const headerCells = paragraphs[0].trim().slice(1, -1).split('|').map(c => c.trim());
      const bodyRows = paragraphs.slice(2).map(row => row.trim().slice(1, -1).split('|').map(c => c.trim()));
      // generate IDs
      const tableBlockId = generateId();
      const columnIds = headerCells.map(() => 'col' + generateUuid());
      const rowIds = [generateUuid(), ...bodyRows.map(() => generateUuid())].map(id => 'row' + id);
      // generate cell and text IDs
      const cellIds: string[][] = [];
      const textIds: string[][] = [];
      headerCells.forEach((_, colIdx) => {
        textIds[0] = textIds[0] || [];
        cellIds[0] = cellIds[0] || [];
        textIds[0][colIdx] = generateId();
        cellIds[0][colIdx] = generateId();
      });
      bodyRows.forEach((cells, rowIdx) => {
        textIds[rowIdx + 1] = [];
        cellIds[rowIdx + 1] = [];
        cells.forEach((_, colIdx) => {
          textIds[rowIdx + 1][colIdx] = generateId();
          cellIds[rowIdx + 1][colIdx] = generateId();
        });
      });
      // build changeMap
      const changeMap: Record<string, any> = {};
      // page block insertion
      const parentOps = [{ p: ['children', 0], action: { li: tableBlockId } }];
      changeMap[pageBlockId] = { id: pageBlockId, version: 1, payload: { ops: parentOps } };
      // table block
      changeMap[tableBlockId] = {
        id: tableBlockId,
        version: 0,
        payload: {
          ops: [{
            p: [],
            action: {
              oi: {
                type: 'table',
                children: cellIds.flat(),
                comments: [],
                revisions: [],
                author: author,
                columns_id: columnIds,
                rows_id: rowIds,
                column_set: Object.fromEntries(columnIds.map(id => [id, { column_width: 200 }])) as any,
                cell_set: Object.fromEntries(
                  cellIds.flatMap((row, r) =>
                    row.map((cId, c) => {
                      const key = rowIds[r] + columnIds[c];
                      const val = { block_id: cId, merge_info: { row_span: 1, col_span: 1 } };
                      return [key, val] as [string, any];
                    })
                  )
                ) as any,


                parent_id: pageBlockId
              }
            }
          }]
        }
      };
      // cell and text blocks
      headerCells.forEach((cellText, colIdx) => {
        const textId = textIds[0][colIdx];
        const cellId = cellIds[0][colIdx];
        const len = cellText.length.toString(36);
        changeMap[textId] = {
          id: textId,
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
                    initialAttributedTexts: { text: { '0': cellText }, attribs: { '0': `*0+${len}` } },
                    apool: { numToAttrib: { '0': ['author', author] }, nextNum: 1 }
                  },
                  folded: false,
                  align: 'left',
                  parent_id: cellId
                }
              }
            }]
          }
        };
        changeMap[cellId] = {
          id: cellId,
          version: 0,
          payload: {
            ops: [{
              p: [],
              action: { oi: { type: 'table_cell', children: [textId], comments: [], revisions: [], author: author, parent_id: tableBlockId } }
            }]
          }
        };
      });
      bodyRows.forEach((cells, rowIdx) => {
        cells.forEach((cellText, colIdx) => {
          const textId = textIds[rowIdx + 1][colIdx];
          const cellId = cellIds[rowIdx + 1][colIdx];
          const len = cellText.length.toString(36);
          changeMap[textId] = {
            id: textId,
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
                      initialAttributedTexts: { text: { '0': cellText }, attribs: { '0': `*0+${len}` } },
                      apool: { numToAttrib: { '0': ['author', author] }, nextNum: 1 }
                    },
                    folded: false,
                    align: 'left',
                    parent_id: cellId
                  }
                }
              }]
            }
          };
          changeMap[cellId] = {
            id: cellId,
            version: 0,
            payload: {
              ops: [{
                p: [],
                action: { oi: { type: 'table_cell', children: [textId], comments: [], revisions: [], author: author, parent_id: tableBlockId } }
              }]
            }
          };
        });
      });
      // Stage 1 dummy op
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
    }

    // 1. Generate block IDs for each paragraph

    
    // 1. Generate block IDs for each paragraph
    const newBlockIds = paragraphs.map(() => generateId())

    // Compute indent levels for nested list items (4 spaces per indent level)
    const indentLevels = paragraphs.map(line =>
      Math.floor((line.match(/^\s*/)?.[0].length || 0) / 4)
    )

    // Build nodes map and construct nesting via stack algorithm
    interface Node { id: string; indent: number; children: string[]; parentId?: string }
    const nodes: Record<string, Node> = {}
    newBlockIds.forEach((id, idx) => {
      nodes[id] = { id, indent: indentLevels[idx], children: [] }
    })
    const roots: string[] = []
    const stack: Node[] = []
    newBlockIds.forEach(id => {
      const node = nodes[id]
      // Pop until we find a shallower indent
      while (stack.length && stack[stack.length - 1].indent >= node.indent) {
        stack.pop()
      }
      if (!stack.length) {
        roots.push(id)
      } else {
        node.parentId = stack[stack.length - 1].id
        stack[stack.length - 1].children.push(id)
      }
      stack.push(node)
    })
    
    // Find existing blocks
    const siblings = root.children || []
    // We'll insert at the beginning of the document as suggested
    const insertPosition = 0 as number
    
    // Target block to modify (parent)
    const targetBlockId = pageBlockId
    
    // Build operations for parent block (page) using top-level roots
    const parentOps: Array<{p: (string|number)[], action: {li: string} | {ld: string}}> = []
    // Insert root-level items in reverse so order is preserved
    roots.slice().reverse().forEach(rootId => {
      parentOps.push({ p: ['children', insertPosition], action: { li: rootId } })
    })
    
    // Build change_map
    const changeMap: Record<string, any> = {
      [targetBlockId]: {
        id: targetBlockId,
        version: 1, // Will be updated after dummy op
        payload: { ops: parentOps }
      }
    }
    
    // Helper function to determine block type based on Markdown syntax
    const getBlockType = (text: string): { type: string, content: string } => {
      // Headings
      if (text.startsWith('### ')) {
        return { type: 'heading3', content: text.substring(4) };
      } else if (text.startsWith('## ')) {
        return { type: 'heading2', content: text.substring(3) };
      } else if (text.startsWith('# ')) {
        return { type: 'heading1', content: text.substring(2) };
      }
      // Ordered list: "1. text" or "123. text"
      const orderedMatch = text.match(/^\s*(\d+)\.\s+(.*)$/);
      if (orderedMatch) {
        return { type: 'ordered', content: orderedMatch[2] };
      }
      // Bullet list: "* text" or "- text" or "+ text"
      const bulletMatch = text.match(/^\s*([*\-+])\s+(.*)$/);
      if (bulletMatch) {
        return { type: 'bullet', content: bulletMatch[2] };
      }
      // Normal paragraph
      return { type: 'text', content: text };
    };
    
    // Helper function to parse Markdown formatting
    type FormattingType = 'bold' | 'italic' | 'strikethrough';
    
    interface TextSegment {
      text: string;
      formats: FormattingType[];
    }
    
    interface ParsedText {
      text: string;
      attribs: string;
      formatTypes: Record<string, [string, string]>;
    }
    
    const parseMarkdownFormatting = (text: string): ParsedText => {
      // Initialize the result
      const result: ParsedText = {
        text: text,
        attribs: '',
        formatTypes: {
          // Start with author attribute
          '0': ['author', author]
        }
      };
      
      // If there's no special formatting, return simple format
      if (!text.includes('**') && !text.includes('*') && !text.includes('~~')) {
        result.attribs = `*0+${text.length.toString(36)}`;
        return result;
      }
      
      // Format markers and their corresponding attribute types
      const formatMarkers = [
        { marker: '**', type: 'bold' },
        { marker: '*', type: 'italic' },
        { marker: '~~', type: 'strikethrough' }
      ];
      
      // Split the text into segments based on the Markdown formatting
      let segments: TextSegment[] = [{ text: text, formats: [] }];
      
      // Process each format marker
      for (const { marker, type } of formatMarkers) {
        let newSegments: TextSegment[] = [];
        
        for (const segment of segments) {
          if (segment.formats.includes(type as FormattingType) || (type === 'italic' && segment.formats.includes('bold'))) {
            // Already has this format, keep as is
            newSegments.push(segment);
            continue;
          }
          
          const parts = segment.text.split(marker);
          if (parts.length === 1) {
            // No marker found, keep as is
            newSegments.push(segment);
            continue;
          }
          
          let isFormatted = false;
          for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            if (part === '') { isFormatted = !isFormatted; continue; }
            
            if (isFormatted) {
              newSegments.push({
                text: part,
                formats: [...segment.formats, type as FormattingType]
              });
            } else {
              newSegments.push({
                text: part,
                formats: [...segment.formats]
              });
            }
            isFormatted = !isFormatted;
          }
        }
        
        segments = newSegments;
      }
      
      // Combine all segments into a single text
      let plainText = '';
      let attribs = '';
      let nextNum = 1; // Start from 1 since 0 is reserved for author
      const formatTypeMap: Record<string, number> = {};
      
      for (const segment of segments) {
        plainText += segment.text;
        
        // Create attribute string for this segment
        let segAttrib = '*0'; // Always include author
        
        // Add format attributes
        for (const format of segment.formats) {
          if (!formatTypeMap[format]) {
            formatTypeMap[format] = nextNum++;
            result.formatTypes[formatTypeMap[format].toString()] = [format, 'true'];
          }
          segAttrib += `*${formatTypeMap[format]}`;
        }
        
        // Add length in base36
        segAttrib += `+${segment.text.length.toString(36)}`;
        attribs += segAttrib;
      }
      
      result.text = plainText;
      result.attribs = attribs;
      return result;
    };
    
    // Variables to manage ordered list numbering
    let inOrderedList = false;
    // Add each paragraph block to the change_map
    // Use the original order of blockIds for the content
    newBlockIds.forEach((blockId, index) => {
      // Get the corresponding paragraph text
      const paragraphText = paragraphs[index]
      
      // Determine block type based on markdown syntax
      const { type, content } = getBlockType(paragraphText)
      
      if (type === 'heading1' || type === 'heading2' || type === 'heading3') {
        // Calculate the actual length of the text for the attribs field
        const textLength = content.length.toString(36)
        
        // Define new block for this heading paragraph
        changeMap[blockId] = {
          id: blockId,
          version: 0,
          payload: {
            ops: [{
              p: [],
              action: {
                oi: {
                  type: type,
                  children: nodes[blockId].children || [],
                  comments: [],
                  revisions: [],
                  author: author,
                  text: {
                    initialAttributedTexts: {
                      text: { '0': content },
                      attribs: { '0': `*0+${textLength}` }
                    },
                    apool: {
                      numToAttrib: { '0': ['author', author] },
                      nextNum: 1
                    }
                  },
                  folded: false,
                  parent_id: nodes[blockId].parentId || targetBlockId
                }
              }
            }]
          }
        }
      } else if (type === 'ordered' || type === 'bullet') {
        // Detect if entering or exiting ordered list to reset numbering
        if (type === 'ordered') {
          if (!inOrderedList) {
            inOrderedList = true;
          }
        } else {
          inOrderedList = false; // bullets don't affect ordered list numbering
        }

        // Parse inline formatting
        const parsed = parseMarkdownFormatting(content);
        const numToAttrib: Record<string, [string, string]> = { ...parsed.formatTypes };

        // Determine seq for ordered list items
        let seqValue: string | undefined;
        if (type === 'ordered') {
          seqValue = inOrderedList ? 'auto' : '1';
          // After first item, subsequent ordered items should use 'auto'
          inOrderedList = true;
        }

        changeMap[blockId] = {
          id: blockId,
          version: 0,
          payload: {
            ops: [{
              p: [],
              action: {
                oi: {
                  type: type,
                  children: nodes[blockId].children || [],
                  comments: [],
                  revisions: [],
                  author: author,
                  text: {
                    initialAttributedTexts: {
                      text: { '0': parsed.text },
                      attribs: { '0': parsed.attribs }
                    },
                    apool: {
                      numToAttrib: numToAttrib,
                      nextNum: Object.keys(numToAttrib).length
                    }
                  },
                  level: 1,
                  folded: false,
                  ...(seqValue ? { seq: seqValue } : {}),
                  parent_id: nodes[blockId].parentId || targetBlockId
                }
              }
            }]
          }
        };

      } else {
        // Parse content for Markdown formatting (bold, italic, strikethrough)
        const parsed = parseMarkdownFormatting(content)
        
        // Build numToAttrib from parsed formatting types
        const numToAttrib: Record<string, [string, string]> = { ...parsed.formatTypes }
        
        // Define new block for this formatted text paragraph
        changeMap[blockId] = {
          id: blockId,
          version: 0,
          payload: {
            ops: [{
              p: [],
              action: {
                oi: {
                  type: 'text',
                  children: nodes[blockId].children || [],
                  comments: [],
                  revisions: [],
                  author: author,
                  text: {
                    initialAttributedTexts: {
                      text: { '0': parsed.text },
                      attribs: { '0': parsed.attribs }
                    },
                    apool: {
                      numToAttrib: numToAttrib,
                      nextNum: Object.keys(numToAttrib).length
                    }
                  },
                  folded: false,
                  parent_id: nodes[blockId].parentId || targetBlockId
                }
              }
            }]
          }
        }
      }
    })
    
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
