import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { toString as mdastToString } from 'mdast-util-to-string';
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
  const sourceText = markdown;
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
  const tree = processor.parse(sourceText) as Root;

  const isSimpleParagraphs = tree.children.every(n => n.type === 'paragraph');
  tree.children.forEach(node => {
    processNode(node, pageBlockId, changeMap, author, sourceText, {}, isSimpleParagraphs);
  });

  return changeMap;
}

function processNode(node: Content, parentId: string, changeMap: ChangeMap, author: string, sourceText: string, listInfo: { type?: 'ordered' | 'bullet', level?: number, seq?: string } = {}, isStandaloneParagraph: boolean = false) {
  const blockId = (node as any).temp_id || generateId();

  switch (node.type) {
    case 'heading':
      createHeadingBlock(blockId, parentId, node, changeMap, author);
      break;
    case 'paragraph':
      processParagraph(blockId, parentId, node, changeMap, author, sourceText, isStandaloneParagraph);
      break;
    case 'list':
      node.children.forEach((item, index) => {
        const seq = (node.ordered && index === 0) ? '1' : 'auto';
        processNode(item, parentId, changeMap, author, sourceText, { type: node.ordered ? 'ordered' : 'bullet', level: (listInfo.level || 0) + 1, seq });
      });
      break;
    case 'listItem':
      createListItemBlock(blockId, parentId, node, changeMap, author, sourceText, listInfo);
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
        createQuoteContainerBlock(blockId, parentId, node, changeMap, author, sourceText);
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

function createListItemBlock(blockId: string, parentId: string, node: ListItem, changeMap: ChangeMap, author: string, sourceText: string, listInfo: any) {
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
                    processNode({ ...item, temp_id: nestedBlockId }, blockId, changeMap, author, sourceText, { ...listInfo, level: (listInfo.level || 0) + 1 });
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
              const textBlockId = generateId();
              const content = processPhrasingContent(cellNode.children, author);
              const textData = createTextBlockData(content, author);
              const textBlock = {
                  obj_id: textBlockId,
                  parent_id: cellId,
                  type: 'text',
                  ...textData,
              };
              addBlockToChangeMap(textBlock, changeMap, cellId, false);

              const cellBlock = {
                  obj_id: cellId,
                  parent_id: blockId,
                  type: 'table_cell',
                  children: [],
                  comments: [],
                  revisions: [],
                  author: author,                  
                  children: [textBlockId],
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

function createQuoteContainerBlock(blockId: string, parentId: string, node: Blockquote, changeMap: ChangeMap, author: string, sourceText: string) {
    const childrenIds = [];

    node.children.forEach(childNode => {
        if (childNode.type === 'paragraph') {
            const childBlockId = generateId();
            childrenIds.push(childBlockId);
            
            const content = processPhrasingContent(childNode.children, author);
            const textData = createTextBlockData(content, author);
            
            const textBlock = {
                obj_id: childBlockId,
                parent_id: blockId,
                type: 'text',
                children: [],
                comments: [],
                revisions: [],
                folded: false,
                author: author,
                text: textData.text,
            };
            
            addBlockToChangeMap(textBlock, changeMap, blockId, false);
        } else {
            // In a real-world scenario, you might want to handle other block types within a quote.
            console.warn(`Unsupported node type inside blockquote: ${childNode.type}`);
        }
    });
    
    const quoteContainer = {
        obj_id: blockId,
        parent_id: parentId,
        type: 'quote_container',
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

function processParagraph(blockId: string, parentId: string, node: Paragraph, changeMap: ChangeMap, author: string, sourceText: string, isStandalone: boolean) {
    const inlineMathIndex = node.children.findIndex(child => 
        child.type === 'inlineMath' && 
        child.position && 
        sourceText.substring(child.position.start.offset, child.position.end.offset).startsWith('$$')
    );

    if (inlineMathIndex !== -1) {
        const beforeChildren = node.children.slice(0, inlineMathIndex);
        const mathNode = node.children[inlineMathIndex] as any;
        const afterChildren = node.children.slice(inlineMathIndex + 1);

        if (beforeChildren.length > 0 && mdastToString({type: 'paragraph', children: beforeChildren}).trim()) {
            const beforeBlockId = generateId();
            const beforeNode: Paragraph = { type: 'paragraph', children: beforeChildren };
            createSimpleParagraphBlock(beforeBlockId, parentId, beforeNode, changeMap, author, false);
        }

        const equationBlockId = generateId();
        const equationNode: Content = { type: 'math', value: mathNode.value };
        createEquationBlock(equationBlockId, parentId, equationNode, changeMap, author);

        if (afterChildren.length > 0 && mdastToString({type: 'paragraph', children: afterChildren}).trim()) {
            const afterBlockId = generateId();
            const afterNode: Paragraph = { type: 'paragraph', children: afterChildren };
            createSimpleParagraphBlock(afterBlockId, parentId, afterNode, changeMap, author, false);
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
    const formatTypes: Record<string, [string, string]> = { '0': ['author', author] };
    let nextNum = 1;
    const formatMap: Record<string, number> = {};

    interface Segment {
        text: string;
        formats: string[];
    }

    const segments: Segment[] = [];

    function getFormatNum(format: string, value: string = 'true'): number {
        const key = format.includes('-') ? format : `${format}:${value}`;
        if (formatMap[key] === undefined) {
            formatMap[key] = nextNum++;
            if (format.includes('-')) {
                const [type, num] = format.split('-');
                formatTypes[formatMap[key].toString()] = formatTypes[num];
            } else {
                formatTypes[formatMap[key].toString()] = [format, value];
            }
        }
        return formatMap[key];
    }

    function processMdastNode(node: PhrasingContent, currentFormats: string[]) {
        switch (node.type) {
            case 'text':
                segments.push({ text: node.value, formats: currentFormats });
                break;
            case 'strong':
                node.children.forEach(child => processMdastNode(child, [...currentFormats, 'bold']));
                break;
            case 'emphasis':
                node.children.forEach(child => processMdastNode(child, [...currentFormats, 'italic']));
                break;
            case 'delete':
                node.children.forEach(child => processMdastNode(child, [...currentFormats, 'strikethrough']));
                break;
            case 'inlineCode':
                segments.push({ text: node.value, formats: [...currentFormats, 'code'] });
                break;
            case 'inlineMath':
                const equationContent = node.value;
                const equationFormatNum = getFormatNum('equation', equationContent);
                //const inlineEquationFormatNum = getFormatNum('inline_equation');
                segments.push({ text: node.value, formats: [...currentFormats, `equation-${equationFormatNum}`, `objectID-${generateObjectId()}`] });
                 break;
        }
    }

    nodes.forEach(node => processMdastNode(node, []));

    // Merge segments with same formats
    const mergedSegments: Segment[] = [];
    if (segments.length > 0) {
        mergedSegments.push({ ...segments[0] });
        for (let i = 1; i < segments.length; i++) {
            const lastSegment = mergedSegments[mergedSegments.length - 1];
            const currentSegment = segments[i];
            if (JSON.stringify(lastSegment.formats.sort()) === JSON.stringify(currentSegment.formats.sort())) {
                lastSegment.text += currentSegment.text;
            } else {
                mergedSegments.push({ ...currentSegment });
            }
        }
    }

    const fullText = mergedSegments.map(s => s.text).join('');
    let attribs = '';

    const buildAttribsString = (segs: Segment[]) => {
        let a = '';
        segs.forEach(seg => {
            const formatStr = seg.formats.map(f => `*${getFormatNum(f)}`).join('');
            a += `*0${formatStr}+${seg.text.length.toString(36)}`;
        });
        return a;
    };

    attribs = mergedSegments.map(seg => {
        const formatStr = seg.formats.map(f => {
            if (f.includes('-')) {
                const [_type, num] = f.split('-');
                return `*${num}`;
            }
            return `*${getFormatNum(f)}`;
        }).join('');
        const text = seg.text;
        
        const lastNewlineIndex = text.lastIndexOf('\n');

        if (lastNewlineIndex !== -1) {
            const part1 = text.substring(0, lastNewlineIndex + 1);
            const part2 = text.substring(lastNewlineIndex + 1);

            const newlineCount = (part1.match(/\n/g) || []).length;
            
            let result = '';
            if (part1.length > 0) {
                result += `*0${formatStr}|${newlineCount}+${part1.length.toString(36)}`;
            }
            if (part2.length > 0) {
                result += `*0${formatStr}+${part2.length.toString(36)}`;
            }
            return result;

        } else {
            return `*0${formatStr}+${text.length.toString(36)}`;
        }
    }).join('');

    return {
        text: fullText,
        attribs: attribs,
        formatTypes: formatTypes,
    };
}