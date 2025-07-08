import { unified } from 'unified';
import remarkParse from 'remark-parse';
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

  const ast = unified().use(remarkParse).parse(markdown) as Root;

    ast.children.reverse().forEach(node => {
    processNode(node, pageBlockId, changeMap, author);
  });

  return changeMap;
}

function processNode(node: Content, parentId: string, changeMap: ChangeMap, author: string, listInfo: { type?: 'ordered' | 'bullet', level?: number, seq?: string } = {}) {
  const blockId = generateId();

  switch (node.type) {
    case 'heading':
      createHeadingBlock(blockId, parentId, node, changeMap, author);
      break;
    case 'paragraph':
      processParagraph(blockId, parentId, node, changeMap, author);
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
      createCodeBlock(blockId, parentId, node, changeMap, author);
      break;
    case 'thematicBreak':
      createDividerBlock(blockId, parentId, changeMap);
      break;
    case 'blockquote':
      createBlockquote(blockId, parentId, node, changeMap, author);
      break;
  }
}

function createTextBlockData(content: TextProcessingResult, author: string) {
    return {
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
        author,
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

    const content = processPhrasingContent(firstChild.children, author);
    const textData = createTextBlockData(content, author);

    const block = {
        obj_id: blockId,
        parent_id: parentId,
        type: listInfo.type,
        children: [],
        comments: [],
        revisions: [],
        folded: false,
        ...textData,
        level: listInfo.level,
        seq: listInfo.seq,
    };
    addBlockToChangeMap(block, changeMap, parentId);

    const nestedLists = node.children.slice(1);
    if (nestedLists.length > 0) {
        nestedLists.forEach(childNode => {
            if (childNode.type === 'list') {
                processNode(childNode, parentId, changeMap, author, { ...listInfo, level: (listInfo.level || 0) + 1 });
            }
        });
    }
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

function createBlockquote(blockId: string, parentId: string, node: Blockquote, changeMap: ChangeMap, author: string) {
    const quoteContainerId = generateId();
    const childrenIds = [];

    node.children.forEach(child => {
        const childBlockId = generateId();
        childrenIds.push(childBlockId);
        processNode({ ...child, temp_id: childBlockId }, quoteContainerId, changeMap, author);
    });

    const quoteContainer = {
        obj_id: quoteContainerId,
        parent_id: parentId,
        type: 'quote',
        children: childrenIds,
    };
    addBlockToChangeMap(quoteContainer, changeMap, parentId);
}

function processParagraph(blockId: string, parentId: string, node: Paragraph, changeMap: ChangeMap, author: string) {
    const rawText = node.children.map(c => (c.type === 'text' ? c.value : c.type === 'inlineCode' ? `$${c.value}$` : '')).join('');
    const lines = rawText.split('\n').filter(line => line.trim());

    lines.forEach((line, index) => {
        const currentBlockId = (node as any).temp_id && index === 0 ? (node as any).temp_id : generateId();
        const centeredEquationRegex = /^\$\$(.*?)\$\$$/;
        const match = line.trim().match(centeredEquationRegex);

        if (match) {
            const equationContent = match[1];
            const objectId = generateObjectId();
            const equationBlock = {
                obj_id: currentBlockId,
                parent_id: parentId,
                type: 'text',
                align: 'center',
                text: {
                    initialAttributedTexts: {
                        text: { '0': ' ' },
                        attribs: { '0': '*0*1*2+1' },
                    },
                    apool: {
                        numToAttrib: {
                            '0': ['author', author],
                            '1': ['equation', equationContent],
                            '2': ['objectID', objectId],
                        },
                        nextNum: 3,
                    }
                },
            };
            addBlockToChangeMap(equationBlock, changeMap, parentId);
        } else {
            const tempAst = unified().use(remarkParse).parse(line) as Root;
            const tempPara = tempAst.children[0] as Paragraph;
            if (tempPara) {
                const content = processPhrasingContent(tempPara.children, author);
                const textData = createTextBlockData(content, author);
                const block = {
                    obj_id: currentBlockId,
                    parent_id: parentId,
                    type: 'text',
                    children: [],
                    comments: [],
                    revisions: [],
                    folded: false,
                    ...textData,
                };
                addBlockToChangeMap(block, changeMap, parentId);
            }
        }
    });
}

function processPhrasingContent(nodes: PhrasingContent[], author: string): TextProcessingResult {
  let plainText = '';
  let attribs = '';
  const formatTypes: Record<string, [string, string]> = { '0': ['author', author] };
  let nextNum = 1;
  const formatTypeMap: Record<string, number> = {};

  function addFormat(format: string): number {
    if (!formatTypeMap[format]) {
      formatTypeMap[format] = nextNum++;
      formatTypes[formatTypeMap[format].toString()] = [format, 'true'];
    }
    return formatTypeMap[format];
  }

  function traverse(subNodes: PhrasingContent[], activeFormats: string[]) {
    for (const node of subNodes) {
      let currentFormats = [...activeFormats];
      if (node.type === 'strong') {
        currentFormats.push('bold');
        traverse(node.children, currentFormats);
      } else if (node.type === 'emphasis') {
        currentFormats.push('italic');
        traverse(node.children, currentFormats);
      } else if (node.type === 'delete') {
        currentFormats.push('strikethrough');
        traverse(node.children, currentFormats);
      } else if (node.type === 'inlineCode') {
        const equationContent = node.value;
        const objectId = generateObjectId();
        
        plainText += equationContent;
        
        const equationFormatNum = nextNum++;
        formatTypes[equationFormatNum.toString()] = ['equation', equationContent];
        const objectIdFormatNum = nextNum++;
        formatTypes[objectIdFormatNum.toString()] = ['objectID', objectId];
        
        let segAttrib = `*0*${equationFormatNum}*${objectIdFormatNum}`;
        segAttrib += `+${equationContent.length.toString(36)}`;
        attribs += segAttrib;

      } else if (node.type === 'text') {
        if (!node.value) continue;
        plainText += node.value;
        let segAttrib = '*0';
        for (const format of currentFormats) {
          segAttrib += `*${addFormat(format)}`;
        }
        segAttrib += `+${node.value.length.toString(36)}`;
        attribs += segAttrib;
      }
    }
  }

  traverse(nodes, []);

  return { text: plainText, attribs, formatTypes };
}