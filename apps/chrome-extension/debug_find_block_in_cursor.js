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

// Run the function and show the result
const directChildBlockId = getDirectChildBlockIdFromCursor();
console.log('Final result - Direct child block ID:', directChildBlockId);

// Helper function to dump the block hierarchy for debugging
function dumpBlockHierarchy() {
  try {
    const PageMain = window.PageMain;
    if (!PageMain || !PageMain.blockManager || !PageMain.blockManager.rootBlockModel) {
      return 'Cannot access PageMain.blockManager.rootBlockModel';
    }
    
    const root = PageMain.blockManager.rootBlockModel;
    
    function formatBlock(block, depth = 0) {
      if (!block || !block.record) return '';
      
      const indent = '  '.repeat(depth);
      let result = `${indent}${block.record.id} (${block.record.type})`;
      
      if (block.children && block.children.length > 0) {
        result += ' {';
        for (const child of block.children) {
          result += '\n' + formatBlock(child, depth + 1);
        }
        result += `\n${indent}}`;
      }
      
      return result;
    }
    
    return formatBlock(root);
  } catch (error) {
    return 'Error dumping block hierarchy: ' + error.message;
  }
}

// Dump the block hierarchy
console.log('Block hierarchy:\n' + dumpBlockHierarchy());