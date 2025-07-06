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
      const existingChildren = root.struct?.record?.snapshot?.children || [];
      
      // Generate change map for the new markdown content
      const contentChangeMap = generateChangeMap(pageBlockId, text, author);
      
      if(Object.keys(contentChangeMap).length === 0)
        return false;
      
      // Create the final change map that includes deletion of existing blocks
      const changeMap = { ...contentChangeMap };
      
      
      // Add deletion operations for each existing child block
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
            p: ['children', index],
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

