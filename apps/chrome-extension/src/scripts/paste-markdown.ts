/**
 * Paste from Markdown feature - inserts clipboard markdown text into Lark document
 */

import { Toast } from '@dolphin/lark'
import { postChangeMap } from './postChangeMap'
import { generateChangeMap } from './paste-md-core'

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
      try { window.localStorage.removeItem('cdc_markdown_content'); } catch { }

      // Insert the text as a new paragraph
      const result = await insertParagraph(pageBlockId, markdownText, memberId, csrf)
      
      if (result) {
        Toast.success({ content: 'Markdown text inserted successfully!' })
      } else {
        Toast.error({ content: 'Failed to insert markdown content.' })
      }
    } catch (error) {
      console.error('Clipboard access error:', error)
      Toast.error({ content: 'Failed to access clipboard. Please check permissions.' })
    }
  } catch (error) {
    console.error('Error in paste markdown:', error)
    Toast.error({ content: `Failed to paste markdown content: ${error instanceof Error ? error.message : 'Unknown error'}` })
  }
}


/**
 * Get the block ID of the direct child of page block from cursor position
 * using Lark's internal block manager
 */
function getDirectChildBlockIdFromCursor() {
  try {
    // STEP 1: Get the PageMain and rootBlockModel
    const PageMain = window.PageMain;
    if (!PageMain || !PageMain.blockManager || !PageMain.blockManager.rootBlockModel) {
      console.error('Cannot access PageMain.blockManager.rootBlockModel');
      return null;
    }
    
    const root = PageMain.blockManager.rootBlockModel;
    console.log('Root block model found:', root.record?.id);
    
    // STEP 2: Get the current selection and find the block containing it
    const sel = document.getSelection();
    if (!sel || !sel.anchorNode) {
      console.warn('No selection found');
      return null;
    }
    
    // Find the closest element with data-record-id
    let currentElement = sel.anchorNode.nodeType === Node.TEXT_NODE 
      ? sel.anchorNode.parentElement 
      : sel.anchorNode;
      
    let blockId = null;
    while (currentElement && !blockId) {
      if (currentElement.hasAttribute && currentElement.hasAttribute('data-record-id')) {
        blockId = currentElement.getAttribute('data-record-id');
        break;
      }
      currentElement = currentElement.parentElement;
    }
    
    if (!blockId) {
      console.warn('Could not find a block ID in the DOM');
      return null;
    }
    
    console.log('Found block ID in DOM:', blockId);
    
    // STEP 3: Build a block hierarchy map
    const blockMap = new Map();
    const pageBlockId = root.record?.id;
    
    // Function to recursively build the block hierarchy
    function buildBlockHierarchy(blockModel, parentId = null) {
      if (!blockModel || !blockModel.record || !blockModel.record.id) return;
      
      const id = blockModel.record.id;
      blockMap.set(id, { 
        id, 
        parentId, 
        type: blockModel.record.type,
        children: []
      });
      
      // Process children if any
      if (blockModel.children && blockModel.children.length > 0) {
        for (const child of blockModel.children) {
          buildBlockHierarchy(child, id);
          if (blockMap.has(id)) {
            blockMap.get(id).children.push(child.record?.id);
          }
        }
      }
    }
    
    // Build the hierarchy starting from the root
    buildBlockHierarchy(root);
    
    console.log('Block hierarchy map built with', blockMap.size, 'blocks');
    
    // STEP 4: Find the direct parent of the current block
    function findDirectChildOfPageBlock(currentBlockId) {
      // If this is already a direct child of the page block
      if (blockMap.has(currentBlockId) && blockMap.get(currentBlockId).parentId === pageBlockId) {
        console.log('✅ Block is already a direct child of page block:', currentBlockId);
        return currentBlockId;
      }
      
      // Otherwise, traverse up the hierarchy until we find a direct child
      let current = currentBlockId;
      const path = [current];
      
      while (blockMap.has(current) && blockMap.get(current).parentId !== pageBlockId) {
        current = blockMap.get(current).parentId;
        if (!current) break;
        path.push(current);
      }
      
      if (blockMap.has(current) && blockMap.get(current).parentId === pageBlockId) {
        console.log('✅ Found direct child of page block:', current);
        console.log('Path from cursor to direct child:', path.reverse().join(' -> '));
        return current;
      }
      
      console.warn('⚠️ Could not find a direct child of page block in hierarchy');
      return null;
    }
    
    // Find the direct child of page block
    const directChildId = findDirectChildOfPageBlock(blockId);
    
    // If we found a direct child, return it
    if (directChildId) {
      return directChildId;
    }
    
    // As a fallback, return the first direct child of the page block
    const pageBlock = blockMap.get(pageBlockId);
    if (pageBlock && pageBlock.children && pageBlock.children.length > 0) {
      const firstDirectChild = pageBlock.children[0];
      console.warn('⚠️ Falling back to first direct child of page block:', firstDirectChild);
      return firstDirectChild;
    }
    
    console.error('❌ Could not find any direct children of page block');
    return null;
    
  } catch (error) {
    console.error('Error in getDirectChildBlockIdFromCursor:', error);
    return null;
  }
}

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
      
      // Get all existing children of the root block to delete them first
      let existingChildren = root.struct?.record?.snapshot?.children || [];
      
      // Get the direct child block ID at cursor position
      const directChildId = getDirectChildBlockIdFromCursor();
      
      // If we couldn't find a direct child block ID, fall back to pasting at the page level
      if (!directChildId) {
        console.warn('No direct child block ID found, pasting at page level');
        return false;
      }
      
      // Position to insert blocks
      // If directChildId is provided, use its position in the children array
      let insertPosition = 0;
      
      // If directChildId is available from the parent context, use its position
      if (typeof directChildId !== 'undefined' && directChildId) {
          const directChildIndex = existingChildren.indexOf(directChildId);
          if (directChildIndex !== -1) {
              insertPosition = directChildIndex;
              console.log(`Using insertion position ${insertPosition} from direct child block ${directChildId}`);
          }
      }      
      // Generate change map for the new markdown content
      const contentChangeMap = generateChangeMap(pageBlockId, text, {author, tenantId:window.SERVER_DATA.meta.tenantId});
      
      if(Object.keys(contentChangeMap).length === 0)
        return false;

      if (contentChangeMap[pageBlockId] && contentChangeMap[pageBlockId].payload && contentChangeMap[pageBlockId].payload.ops) {
        contentChangeMap[pageBlockId].payload.ops.forEach((op: any) => {
          if (op.action && op.action.li && op.p && op.p[0] === 'children') {
            op.p[1] = insertPosition;
          }
        });
      }
      
      // Create the final change map that includes deletion of existing blocks
      const changeMap = { ...contentChangeMap };

      // Filter existingChildren to keep only those at or after insertPosition
      if (insertPosition > 0) {
        existingChildren = existingChildren.slice(insertPosition);
        console.log(`Removed ${insertPosition} blocks before insertion point, ${existingChildren.length} remaining`);
      }
      
      // Add deletion operations for children
      if (existingChildren.length > 0) {
        // Make sure the root block is in the change map
        if (!changeMap[pageBlockId]) {
          changeMap[pageBlockId] = {
            id: pageBlockId,
            version: root.struct?.record?.version || 0,
            payload: { ops: [] }
          };
        }
        
        // Add deletion operations for each child
        existingChildren.forEach((childId: string, index: number) => {
          changeMap[pageBlockId].payload.ops.unshift({
            p: ['children', index + insertPosition],
            action: { ld: childId }
          });
        });
      }
      
      // Delegate /user_change calls to helper
      return await postChangeMap(changeMap, pageBlockId, memberId, csrf);
      
    } catch (error) {
      console.error('Error inserting paragraph:', error)
      return false
    }
  }
  


// Execute the main function
main().catch(console.error)

