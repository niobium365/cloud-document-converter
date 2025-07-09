import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import type { Root, Content, Paragraph, Heading, List, ListItem, Table, Code, ThematicBreak, Blockquote, PhrasingContent } from 'mdast';

// --- Helper Functions ---

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const generateId = (): string => Array.from({ length: 27 }).map(() => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');
const generateObjectId = (): string => Array.from({ length: 8 }).map(() => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');

interface ChangeMap {
  [key: string]: any;
}

interface TextProcessingResult {
  text: string;
  attribs: string;
  formatTypes: Record<string, [string, string]>;
}

// --- Core Logic ---

function addBlockToChangeMap(block: any, changeMap: ChangeMap, parentId: string, addToParentChildren: boolean = true) {
    const blockId = block.obj_id;
    delete block.obj_id;

    changeMap[blockId] = {
        id: blockId,
        version: 0,
        payload: {
            ops: [{
                p: [],
                action: { oi: { ...block, parent_id: parentId } },
            }],
        },
    };

    if (addToParentChildren) {
        if (!changeMap[parentId]) {
            changeMap[parentId] = {
                id: parentId,
                version: 1, // This might need to be dynamic
                payload: { ops: [] },
            };
        }

        changeMap[parentId].payload.ops.unshift({
            p: ['children', 0],
            action: { li: blockId },
        });
    }
}

export function generateChangeMap(
  pageBlockId: string,
  markdown: string,
  author: string,
): ChangeMap {
  const changeMap: ChangeMap = {
    [pageBlockId]: {
        id: pageBlockId,
        version: 1, // Placeholder version
        payload: { ops: [] },
    },
  };

  if (!markdown.trim()) {
    // Return only the page update part if markdown is empty
    delete changeMap[pageBlockId].version;
    return changeMap;
  }

  const processor = unified().use(remarkParse).use(remarkGfm).use(remarkMath);
  const ast = processor.parse(markdown) as Root;

  const isSimpleParagraphs = ast.children.every(n => n.type === 'paragraph');
  ast.children.forEach(node => {
    processNode(node, pageBlockId, changeMap, author, {}, isSimpleParagraphs);
  });

  return changeMap;
}

function processNode(node: Content, parentId: string, changeMap: ChangeMap, author: string, listInfo: { type?: 'ordered' | 'bullet', level?: number, seq?: string } = {}, isStandaloneParagraph: boolean = false) {
  const blockId = (node as any).temp_id || generateId();

  switch (node.type) {
    case 'heading':
      createHeadingBlock(blockId, parentId, node, changeMap, author);
      break;
    case 'paragraph':
      processParagraph(blockId, parentId, node, changeMap, author, isStandaloneParagraph);
      break;
    case 'list':
      node.children.forEach((item, index) => {
        const seq = (node.ordered && index === 0) ? '1' : 'auto';
        processNode(item, parentId, changeMap, author, { type: node.ordered ? 'ordered' : 'bullet', level: (listInfo.level || 0) + 1, seq });
      });
      break;
    case 'listItem':
      createListItemBlock(blockId, parentId, node, changeMap, author, listInfo);
      break;
    case 'table':
      createTableBlock(blockId, parentId, node, changeMap, author);
      break;
    case 'code':
          if (node.lang === 'mermaid') {
            createMermaidBlock(blockId, parentId, node, changeMap, author);
          } else {
            createCodeBlock(blockId, parentId, node, changeMap, author);
          }
          break;
    case 'thematicBreak':
      createDividerBlock(blockId, parentId, changeMap);
      break;
    case 'blockquote':
      createBlockquote(blockId, parentId, node, changeMap, author);
      break;
    case 'math':
      createEquationBlock(blockId, parentId, node, changeMap, author);
      break;
  }
}

function createTextBlockData(content: TextProcessingResult, author: string) {
    return {
        author: author,
        cols: 0,
        rows: 0,
        text: {
            initialAttributedTexts: {
                text: { '0': content.text },
                attribs: { '0': content.attribs },
            },
            apool: {
                numToAttrib: content.formatTypes,
                nextNum: Object.keys(content.formatTypes).length,
            },
        },
    };
}

function createHeadingBlock(blockId: string, parentId: string, node: Heading, changeMap: ChangeMap, author: string) {
  const content = processPhrasingContent(node.children, author);
  const textData = createTextBlockData(content, author);
  const block = {
    obj_id: blockId,
    parent_id: parentId,
    type: `heading${node.depth}`,
    children: [],
    comments: [],
    revisions: [],
    folded: false,
    ...textData,
  };
  addBlockToChangeMap(block, changeMap, parentId);
}

function createListItemBlock(blockId: string, parentId: string, node: ListItem, changeMap: ChangeMap, author: string, listInfo: any) {
    const firstChild = node.children[0];
    if (!firstChild || firstChild.type !== 'paragraph') return;

    const nestedListChildrenIds: string[] = [];
    const nestedLists = node.children.slice(1);
    if (nestedLists.length > 0) {
        nestedLists.forEach(childNode => {
            if (childNode.type === 'list') {
                // Process nested list and get the IDs of its items
                childNode.children.forEach(item => {
                    const nestedBlockId = generateId();
                    nestedListChildrenIds.push(nestedBlockId);
                    processNode({ ...item, temp_id: nestedBlockId }, blockId, changeMap, author, { ...listInfo, level: (listInfo.level || 0) + 1 });
                });
            }
        });
    }

    const content = processPhrasingContent(firstChild.children, author);
    const textData = createTextBlockData(content, author);

    const block = {
        obj_id: blockId,
        type: listInfo.type,
        children: nestedListChildrenIds,
        comments: [],
        revisions: [],
        author: textData.author,
        text: textData.text,
        level: listInfo.level,
        folded: false,
        seq: listInfo.seq,
        parent_id: parentId,
    };
    addBlockToChangeMap(block, changeMap, parentId);
}

function createTableBlock(blockId: string, parentId: string, node: Table, changeMap: ChangeMap, author: string) {
  const rows = node.children.length;
  const cols = node.children[0]?.children.length || 0;

  const cell_ids = [];
  for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
          const cellId = generateId();
          cell_ids.push(cellId);
          const cellNode = node.children[i]?.children[j];
          if (cellNode) {
              const content = processPhrasingContent(cellNode.children, author);
              const textData = createTextBlockData(content, author);
              const cellBlock = {
                  obj_id: cellId,
                  parent_id: blockId,
                  type: 'table_cell',
                  ...textData,
              };
              addBlockToChangeMap(cellBlock, changeMap, parentId, false);
          }
      }
  }
  
  const tableBlockData = {
      obj_id: blockId,
      parent_id: parentId,
      type: 'table',
      grid_row_count: rows,
      grid_col_count: cols,
      children: cell_ids,
  };
  addBlockToChangeMap(tableBlockData, changeMap, parentId);
}

function createCodeBlock(blockId: string, parentId: string, node: Code, changeMap: ChangeMap, author: string) {
  const codeContainerId = generateId();
  
  const textContent = { text: node.value, attribs: `+${node.value.length.toString(36)}`, formatTypes: { '0': ['author', author] } };
  const textData = createTextBlockData(textContent, author);
  const textBlock = {
      obj_id: blockId,
      parent_id: codeContainerId,
      type: 'text',
      ...textData,
  };
  addBlockToChangeMap(textBlock, changeMap, parentId, false);

  const codeContainer = {
      obj_id: codeContainerId,
      parent_id: parentId,
      type: 'code',
      language: node.lang || 'plaintext',
      children: [blockId],
  };
  addBlockToChangeMap(codeContainer, changeMap, parentId);
}

function createDividerBlock(blockId: string, parentId: string, changeMap: ChangeMap) {
  const block = { obj_id: blockId, parent_id: parentId, type: 'divider' };
  addBlockToChangeMap(block, changeMap, parentId);
}

function createMermaidBlock(blockId: string, parentId: string, node: Code, changeMap: ChangeMap, author: string) {
    const mermaidBlock = {
        obj_id: blockId,
        type: 'isv',
        children: [],
        comments: [],
        revisions: [],
        author: author,
        data: {
            data: node.value,
            theme: 'default',
            view: 'chart',
        },
        parent_id: parentId,
        app_block_id: '',
        block_type_id: 'blk_631fefbbae02400430b8f9f4',
        manifest: {
            view_type: 'block_h5',
            app_version: '0.0.100',
        },
        comment_details: {},
    };
    addBlockToChangeMap(mermaidBlock, changeMap, parentId);
}

function createBlockquote(blockId: string, parentId: string, node: Blockquote, changeMap: ChangeMap, author: string) {
    const childrenIds = [];
    node.children.forEach(child => {
        const childBlockId = generateId();
        childrenIds.push(childBlockId);
        processNode({ ...child, temp_id: childBlockId }, blockId, changeMap, author);
    });

    const quoteContainer = {
        obj_id: blockId,
        parent_id: parentId,
        type: 'quote',
        children: childrenIds,
    };
    addBlockToChangeMap(quoteContainer, changeMap, parentId);
}

function createEquationBlock(blockId: string, parentId: string, node: Content, changeMap: ChangeMap, author: string) {
    const equationContent = (node as any).value;
    const block = {
        obj_id: blockId,
        parent_id: parentId,
        type: 'text',
        children: [],
        comments: [],
        revisions: [],
        author,
        text: {
            initialAttributedTexts: {
                text: { '0': ' ' },
                attribs: { '0': `*0*1*2+1` },
            },
            apool: {
                numToAttrib: {
                    '0': ['author', author],
                    '1': ['equation', equationContent],
                    '2': ['objectID', generateObjectId()],
                },
                nextNum: 3,
            },
        },
        folded: false,
        align: 'center',
    };
    addBlockToChangeMap(block, changeMap, parentId);
}

function processParagraph(blockId: string, parentId: string, node: Paragraph, changeMap: ChangeMap, author: string, isStandalone: boolean) {
    const inlineMathIndex = node.children.findIndex(child => child.type === 'inlineMath');

    if (inlineMathIndex > -1) {
        const beforeChildren = node.children.slice(0, inlineMathIndex);
        const mathNode = node.children[inlineMathIndex];
        const afterChildren = node.children.slice(inlineMathIndex + 1);

        if (beforeChildren.length > 0 && beforeChildren.some(c => 'value' in c && c.value.trim())) {
            const beforeBlockId = generateId();
            const beforeNode: Paragraph = { type: 'paragraph', children: beforeChildren };
            createSimpleParagraphBlock(beforeBlockId, parentId, beforeNode, changeMap, author, isStandalone);
        }

        const equationBlockId = generateId();
        const blockMathNode: Content = { type: 'math', value: (mathNode as any).value };
        createEquationBlock(equationBlockId, parentId, blockMathNode, changeMap, author);

        if (afterChildren.length > 0 && afterChildren.some(c => 'value' in c && c.value.trim())) {
            const afterBlockId = generateId();
            const afterNode: Paragraph = { type: 'paragraph', children: afterChildren };
            createSimpleParagraphBlock(afterBlockId, parentId, afterNode, changeMap, author, isStandalone);
        }
    } else {
        createSimpleParagraphBlock(blockId, parentId, node, changeMap, author, isStandalone);
    }
}

function createSimpleParagraphBlock(blockId: string, parentId: string, node: Paragraph, changeMap: ChangeMap, author: string, isStandalone: boolean) {
    const content = processPhrasingContent(node.children, author);
    const textData = createTextBlockData(content, author);

    if (isStandalone) {
        const originalInitialAttributedTexts = textData.text.initialAttributedTexts;
        textData.text.initialAttributedTexts = {
            cols: {},
            rows: {},
            text: originalInitialAttributedTexts.text,
            attribs: originalInitialAttributedTexts.attribs,
        };
    }

    const block = {
        obj_id: blockId,
        type: 'text',
        parent_id: parentId,
        author,
        children: [],
        comments: [],
        revisions: [],
        folded: false,
        text: textData.text,
    };
    addBlockToChangeMap(block, changeMap, parentId);
}

function processPhrasingContent(nodes: PhrasingContent[], author: string): TextProcessingResult {
    let text = '';
    let attribs = '';
    const formatTypes: Record<string, [string, string]> = { '0': ['author', author] };
    let nextNum = 1;
    const formatTypeMap: Record<string, number> = {};

    function addFormat(type: string, value: string): number {
        const key = `${type},${value}`;
        if (formatTypeMap[key] !== undefined) {
            return formatTypeMap[key];
        }
        const num = nextNum++;
        formatTypes[num.toString()] = [type, value];
        formatTypeMap[key] = num;
        return num;
    }

    function traverse(subNodes: PhrasingContent[], activeFormats: number[]) {
        subNodes.forEach(node => {
            if (node.type === 'text') {
                text += node.value;
                attribs += `*${activeFormats.join('*')}+${node.value.length.toString(36)}`;
            } else if (node.type === 'inlineMath') {
                const equationContent = (node as any).value;
                const equationNum = addFormat('equation', equationContent);
                const objectIdNum = addFormat('objectID', generateObjectId());
                const equationFormats = [...activeFormats, equationNum, objectIdNum].sort((a, b) => a - b);
                text += equationContent;
                attribs += `*${equationFormats.join('*')}+${equationContent.length.toString(36)}`;
            } else if (['strong', 'emphasis', 'delete'].includes(node.type)) {
                const formatMap = { strong: 'bold', emphasis: 'italic', delete: 'strikethrough' };
                const formatNum = addFormat(formatMap[node.type], 'true');
                traverse(node.children, [...activeFormats, formatNum].sort((a, b) => a - b));
            }
        });
    }

    traverse(nodes, [0]);
    return { text, attribs, formatTypes };
}