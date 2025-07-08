import { unified } from 'unified'
import remarkParse from 'remark-parse'
import { visit } from 'unist-util-visit'
import type { Root, Paragraph, Heading, List, ListItem, Table, TableRow, TableCell, Code, ThematicBreak, Blockquote } from 'mdast'

// Helper for base62 IDs (27-char) to match Lark block IDs
const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'

/**
 * Generate a UUID v4
 */
const generateUuid = (): string => {
    return crypto.randomUUID()
}

/**
 * Generate a unique ID for blocks
 */
const generateId = (): string => {
    return Array(27).fill(0).map(() => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('')
}

/**
 * Generate a unique ID for equation objects
 */
const generateObjectId = (): string => {
    return generateUuid().replace(/-/g, '').substring(0, 16)
}

/**
 * Interface for a centered equation
 */
interface CenteredEquation {
    equation: string;
    objectId: string;
    startPos: number;
    endPos: number;
    fullMatch: string;
}

/**
 * Interface for a processed markdown section
 */
interface MarkdownSection {
    type: 'paragraph' | 'heading' | 'list' | 'table' | 'code' | 'hr' | 'blockquote';
    content: string[];
    language?: string;
    listType?: 'ordered' | 'bullet';
    level?: number; // For headings
    hasCenteredEquation?: boolean;
    centeredEquation?: CenteredEquation;
    isMermaid?: boolean;
}

// Helper function for text formatting types
type FormattingType = 'bold' | 'italic' | 'code' | 'link';

// Text segment with formatting
interface TextSegment {
    text: string;
    formats: FormattingType[];
    equation?: string;
    objectId?: string;
}

// Parsed text with formatting and equations
interface ParsedText {
    text: string;
    attribs: string;
    formatTypes: Record<string, [string, string]>;
    equationData?: {
        equation: string;
        objectId: string;
        startPos: number;
        length: number;
        isCentered?: boolean;
        fullMatch?: string;
    };
}

/**
 * Parse Markdown using unified and remark-parse
 * @param markdown - Markdown content to parse
 * @returns AST (Abstract Syntax Tree) of the parsed markdown
 */
function parseMarkdownWithUnified(markdown: string): Root {
    return unified()
        .use(remarkParse)
        .parse(markdown)
}

/**
 * Check if text contains a centered equation
 * @param text The text to check for centered equations
 * @returns Object with equation data if found, null otherwise
 */
function detectCenteredEquation(text: string): CenteredEquation | null {
    // Match for $$equation$$ pattern
    const centeredEquationRegex = /\$\$(.*?)\$\$/;
    const match = text.match(centeredEquationRegex);
    
    if (!match) return null;
    
    return {
        equation: match[1],
        objectId: generateObjectId(),
        startPos: match.index!,
        endPos: match.index! + match[0].length,
        fullMatch: match[0]
    };
}

/**
 * Extract text content from an AST node recursively
 */
function getNodeText(node: any): string {
    if (node.type === 'text') {
        return node.value;
    }
    
    if (node.value) {
        return node.value;
    }
    
    let text = '';
    if (node.children) {
        for (const child of node.children) {
            text += getNodeText(child);
        }
    }
    
    return text;
}

/**
 * Process list items from a list node
 */
function getListItems(listNode: List): string[] {
    const items: string[] = [];
    
    for (const item of listNode.children) {
        let itemText = '';
        for (const child of item.children) {
            if (child.type === 'paragraph') {
                itemText += getNodeText(child);
            }
        }
        // Preserve the original Markdown formatting for lists
        items.push(listNode.ordered ? `1. ${itemText}` : `- ${itemText}`);
    }
    
    return items;
}

/**
 * Process table rows from a table node
 */
function getTableContent(tableNode: Table): string[] {
    const rows: string[] = [];
    
    tableNode.children.forEach((row: TableRow, rowIndex: number) => {
        let rowContent = '|';
        row.children.forEach((cell: TableCell) => {
            rowContent += ` ${getNodeText(cell)} |`;
        });
        rows.push(rowContent);
        
        // Add alignment row after header
        if (rowIndex === 0) {
            let alignRow = '|';
            row.children.forEach(() => {
                alignRow += ' --- |';
            });
            rows.push(alignRow);
        }
    });
    
    return rows;
}

/**
 * Process blockquote content
 */
function getBlockquoteContent(blockquoteNode: Blockquote): string[] {
    const lines: string[] = [];
    
    for (const child of blockquoteNode.children) {
        if (child.type === 'paragraph') {
            lines.push(`> ${getNodeText(child)}`);
        }
    }
    
    return lines;
}

/**
 * Helper function to parse Markdown formatting
 * Legacy function maintained for compatibility with existing code
 */
function parseMarkdownFormatting(text: string, author: string): ParsedText {
    // Basic implementation to extract formatting and equations
    const result: ParsedText = {
        text,
        attribs: '',
        formatTypes: {},
    };
    
    // Check for centered equations
    const centeredEquationRegex = /\$\$(.*?)\$\$/;
    const match = text.match(centeredEquationRegex);
    
    if (match) {
        result.equationData = {
            equation: match[1],
            objectId: generateObjectId(),
            startPos: match.index!,
            length: match[0].length,
            isCentered: true,
            fullMatch: match[0]
        };
    }
    
    return result;
}

/**
 * Process the Markdown AST into structured sections
 */
function processMarkdownAST(ast: Root): MarkdownSection[] {
    const sections: MarkdownSection[] = [];
    
    // Visit each node in the AST
    visit(ast, (node) => {
        if (node.type === 'paragraph') {
            const text = getNodeText(node);
            // Check for centered equation
            const centeredEquation = detectCenteredEquation(text);
            
            sections.push({
                type: 'paragraph',
                content: [text],
                hasCenteredEquation: !!centeredEquation,
                centeredEquation
            });
        }
        else if (node.type === 'heading') {
            sections.push({
                type: 'heading',
                level: node.depth,
                content: [getNodeText(node)]
            });
        }
        else if (node.type === 'list') {
            sections.push({
                type: 'list',
                listType: node.ordered ? 'ordered' : 'bullet',
                content: getListItems(node)
            });
        }
        else if (node.type === 'table') {
            sections.push({
                type: 'table',
                content: getTableContent(node)
            });
        }
        else if (node.type === 'code') {
            const isMermaid = node.lang === 'mermaid';
            sections.push({
                type: 'code',
                content: node.value.split('\n'),
                language: node.lang || 'text',
                isMermaid
            });
        }
        else if (node.type === 'thematicBreak') {
            sections.push({
                type: 'hr',
                content: []
            });
        }
        else if (node.type === 'blockquote') {
            sections.push({
                type: 'blockquote',
                content: getBlockquoteContent(node)
            });
        }
    });
    
    return sections;
}

/**
 * Helper function to extract paragraph data including formatted text and centered equations
 */
function extractParagraphData(text: string, author: string): ParsedText {
    return parseMarkdownFormatting(text, author);
}

/**
 * Insert paragraphs into the document
 * Handles multi-line text by creating separate paragraph blocks
 */
export function generateChangeMap(
    pageBlockId: string,
    text: string,
    author: string,
    insertPosition: number = 0,
): Record<string, any> {
    let changeMap: Record<string, any> = {};

    try {
        // Check if content is empty
        if (!text.trim()) {
            console.warn('No valid content to insert')
            return changeMap
        }
        
        // Root level block IDs to insert into the page
        let rootBlockIds: string[] = [];
        
        // Parse the Markdown content using unified/remark-parse
        const ast = parseMarkdownWithUnified(text);
        const sections = processMarkdownAST(ast);
        
        // Helper function to determine if this is a mermaid diagram
        const isMermaidDiagram = (language: string): boolean => {
            return language === 'mermaid';
        };
        
        // Initialize the page block if necessary
        changeMap[pageBlockId] = {
            id: pageBlockId,
            version: 0,
            payload: {
                ops: [
                    { p: [], action: { oi: { type: "page" } } },
                    { p: ['children'], action: { oi: [] } }
                ]
            }
        };

        // Process the parsed sections to create Lark blocks
        sections.forEach(section => {
            if (section.type === 'paragraph') {
                const text = section.content[0];
                const paragraphData = extractParagraphData(text, author);
                
                // Handle centered equations
                if (section.hasCenteredEquation && section.centeredEquation) {
                    const { startPos, fullMatch, equation } = section.centeredEquation;
                    const objectId = section.centeredEquation.objectId;
                    
                    // Split paragraph text into before, equation, and after blocks
                    const beforeText = text.substring(0, startPos);
                    const afterText = text.substring(startPos + fullMatch.length);
                    
                    const beforeId = beforeText.trim() ? generateId() : null;
                    const equationId = generateId();
                    const afterId = afterText.trim() ? generateId() : null;
                    
                    // Create blocks for each part
                    if (beforeId) {
                        changeMap[beforeId] = {
                            id: beforeId,
                            version: 0,
                            payload: {
                                ops: [{
                                    p: [],
                                    action: {
                                        oi: {
                                            type: "text",
                                            children: [],
                                            comments: [],
                                            revisions: [],
                                            author: author,
                                            parent_id: pageBlockId,
                                            zone_changesets: {
                                                content: { ops: [{ p: 0, i: beforeText }] }
                                            }
                                        }
                                    }
                                }]
                            }
                        };
                        rootBlockIds.push(beforeId);
                    }
                    
                    // Create equation block with center alignment
                    changeMap[equationId] = {
                        id: equationId,
                        version: 0,
                        payload: {
                            ops: [{
                                p: [],
                                action: {
                                    oi: {
                                        type: "equation",
                                        children: [],
                                        comments: [],
                                        revisions: [],
                                        author: author,
                                        parent_id: pageBlockId,
                                        content: {
                                            objectId: objectId,
                                            style: { align: "center" }
                                        },
                                        zone_changesets: {
                                            content: { ops: [{ p: 0, i: equation }] }
                                        }
                                    }
                                }
                            }]
                        }
                    };
                    rootBlockIds.push(equationId);
                    
                    if (afterId) {
                        changeMap[afterId] = {
                            id: afterId,
                            version: 0,
                            payload: {
                                ops: [{
                                    p: [],
                                    action: {
                                        oi: {
                                            type: "text",
                                            children: [],
                                            comments: [],
                                            revisions: [],
                                            author: author,
                                            parent_id: pageBlockId,
                                            zone_changesets: {
                                                content: { ops: [{ p: 0, i: afterText }] }
                                            }
                                        }
                                    }
                                }]
                            }
                        };
                        rootBlockIds.push(afterId);
                    }
                } else {
                    // Regular paragraph without centered equation
                    const blockId = generateId();
                    
                    changeMap[blockId] = {
                        id: blockId,
                        version: 0,
                        payload: {
                            ops: [{
                                p: [],
                                action: {
                                    oi: {
                                        type: "text",
                                        children: [],
                                        comments: [],
                                        revisions: [],
                                        author: author,
                                        parent_id: pageBlockId,
                                        zone_changesets: {
                                            content: { ops: [{ p: 0, i: text }] }
                                        }
                                    }
                                }
                            }]
                        }
                    };
                    rootBlockIds.push(blockId);
                }
            } else if (section.type === 'heading') {
                // Process heading section
                const text = section.content[0];
                const level = section.level || 1;
                const blockId = generateId();
                
                // Map heading level to Lark heading type
                const headingType = `heading${Math.min(level, 6)}`;
                
                changeMap[blockId] = {
                    id: blockId,
                    version: 0,
                    payload: {
                        ops: [{
                            p: [],
                            action: {
                                oi: {
                                    type: headingType,
                                    children: [],
                                    comments: [],
                                    revisions: [],
                                    author: author,
                                    parent_id: pageBlockId,
                                    zone_changesets: {
                                        content: { ops: [{ p: 0, i: text }] }
                                    }
                                }
                            }
                        }]
                    }
                };
                rootBlockIds.push(blockId);
            } else if (section.type === 'list') {
                // Process list section
                const listBlockId = generateId();
                const listType = section.listType || 'bullet';
                
                // Create the list block
                changeMap[listBlockId] = {
                    id: listBlockId,
                    version: 0,
                    payload: {
                        ops: [{
                            p: [],
                            action: {
                                oi: {
                                    type: listType === 'ordered' ? "numberList" : "bulletList",
                                    children: [],
                                    comments: [],
                                    revisions: [],
                                    author: author,
                                    parent_id: pageBlockId
                                }
                            }
                        }]
                    }
                };
                rootBlockIds.push(listBlockId);
                
                // Create list items
                section.content.forEach(listItemText => {
                    const itemId = generateId();
                    const content = listItemText.replace(/^(?:\d+\.|-|\*)\s+/, ''); // Remove list markers
                    
                    // Create list item block
                    changeMap[itemId] = {
                        id: itemId,
                        version: 0,
                        payload: {
                            ops: [{
                                p: [],
                                action: {
                                    oi: {
                                        type: "listItem",
                                        children: [],
                                        comments: [],
                                        revisions: [],
                                        author: author,
                                        parent_id: listBlockId,
                                        zone_changesets: {
                                            content: { ops: [{ p: 0, i: content }] }
                                        }
                                    }
                                }
                            }]
                        }
                    };
                    
                    // Update list children
                    changeMap[listBlockId].payload.ops.push({
                        p: ['children'],
                        action: { li: itemId }
                    });
                });
            } else if (section.type === 'table') {
                // Process table section
                const tableId = generateId();
                rootBlockIds.push(tableId);
                
                // Extract table rows from section content
                const rows = section.content;
                
                // Parse table structure from markdown format
                let headerRow: string[] = [];
                let dataRows: string[][] = [];
                
                // Process header row
                if (rows.length >= 1) {
                    headerRow = rows[0].split('|')
                        .filter(cell => cell.trim() !== '')
                        .map(cell => cell.trim());
                }
                
                // Skip alignment row (index 1) and process data rows
                for (let i = 2; i < rows.length; i++) {
                    const rowCells = rows[i].split('|')
                        .filter(cell => cell.trim() !== '')
                        .map(cell => cell.trim());
                    if (rowCells.length > 0) {
                        dataRows.push(rowCells);
                    }
                }
                
                // Create table block
                changeMap[tableId] = {
                    id: tableId,
                    version: 0,
                    payload: {
                        ops: [{
                            p: [],
                            action: {
                                oi: {
                                    type: "table",
                                    children: [],
                                    comments: [],
                                    revisions: [],
                                    author: author,
                                    content: {
                                        columns: headerRow.length,
                                        rows: dataRows.length + 1, // header + data rows
                                        cells: {}
                                    },
                                    parent_id: pageBlockId
                                }
                            }
                        }]
                    }
                };
                
                // Add header row cells
                headerRow.forEach((header, cellIdx) => {
                    const cellId = `0:${cellIdx}`;
                    changeMap[tableId].payload.ops.push({
                        p: ['content', 'cells', cellId],
                        action: { oi: { header: true, content: header } }
                    });
                });
                
                // Add data row cells
                for (let rowIdx = 0; rowIdx < dataRows.length; rowIdx++) {
                    const row = dataRows[rowIdx];
                    row.forEach((cellContent, cellIdx) => {
                        if (cellIdx < headerRow.length) {
                            const cellId = `${rowIdx + 1}:${cellIdx}`;
                            changeMap[tableId].payload.ops.push({
                                p: ['content', 'cells', cellId],
                                action: { oi: { header: false, content: cellContent } }
                            });
                        }
                    });
                }
            } else if (section.type === 'code') {
                // Process code block section
                const codeContent = section.content.join('\n');
                const language = section.language || 'text';
                const blockId = generateId();
                rootBlockIds.push(blockId);
                
                // Check if this is a mermaid diagram
                if (isMermaidDiagram(language)) {
                    // Create mermaid diagram (isv) block
                    changeMap[blockId] = {
                        id: blockId,
                        version: 0,
                        payload: {
                            ops: [{
                                p: [],
                                action: {
                                    oi: {
                                        type: "isv",
                                        children: [],
                                        comments: [],
                                        revisions: [],
                                        author: author,
                                        data: {
                                            data: codeContent,
                                            theme: "default",
                                            view: "chart"
                                        },
                                        parent_id: pageBlockId,
                                        app_block_id: "",
                                        block_type_id: "blk_631fefbbae02400430b8f9f4",
                                        manifest: {
                                            view_type: "block_h5",
                                            app_version: "0.0.100"
                                        },
                                        comment_details: {}
                                    }
                                }
                            }]
                        }
                    };
                } else {
                    // Create regular code block
                    changeMap[blockId] = {
                        id: blockId,
                        version: 0,
                        payload: {
                            ops: [{
                                p: [],
                                action: {
                                    oi: {
                                        type: "code",
                                        children: [],
                                        comments: [],
                                        revisions: [],
                                        author: author,
                                        content: {
                                            language: language,
                                        },
                                        parent_id: pageBlockId,
                                        zone_changesets: {
                                            content: { ops: [{ p: 0, i: codeContent }] }
                                        }
                                    }
                                }
                            }]
                        }
                    };
                }
            } else if (section.type === 'hr') {
                // Process horizontal rule
                const hrBlockId = generateId();
                rootBlockIds.push(hrBlockId);
                
                // Create divider block
                changeMap[hrBlockId] = {
                    id: hrBlockId,
                    version: 0,
                    payload: {
                        ops: [{
                            p: [],
                            action: {
                                oi: {
                                    type: "divider",
                                    children: [],
                                    comments: [],
                                    revisions: [],
                                    author: author,
                                    parent_id: pageBlockId
                                }
                            }
                        }]
                    }
                };
            } else if (section.type === 'blockquote') {
                // Process blockquote
                const blockquoteId = generateId();
                rootBlockIds.push(blockquoteId);
                
                // Join content and remove quote markers
                const content = section.content.map(line => 
                    line.replace(/^>\s?/, '')
                ).join('\n');
                
                // Create blockquote block
                changeMap[blockquoteId] = {
                    id: blockquoteId,
                    version: 0,
                    payload: {
                        ops: [{
                            p: [],
                            action: {
                                oi: {
                                    type: "quote",
                                    children: [],
                                    comments: [],
                                    revisions: [],
                                    author: author,
                                    parent_id: pageBlockId,
                                    zone_changesets: {
                                        content: { ops: [{ p: 0, i: content }] }
                                    }
                                }
                            }
                        }]
                    }
                };
            }
        });
        
        // Filter out any dangling block IDs that aren't in the changeMap
        const validRootBlockIds = rootBlockIds.filter(id => changeMap[id] !== undefined);
        
        // Add children to page in reverse order to preserve document order
        const parentOps = changeMap[pageBlockId].payload.ops;
        validRootBlockIds.slice().reverse().forEach(rootId => {
            parentOps.push({ p: ['children', insertPosition], action: { li: rootId } });
        });
        
    } catch (error) {
        console.error('Error generating change map:', error)
    }

    return changeMap
}

// Helper: Determine block type based on Markdown syntax (kept for backward compatibility)
function getBlockType(text: string): { type: string; content: string } {
    if (text.startsWith('# ')) return { type: 'heading1', content: text.slice(2) };
    if (text.startsWith('## ')) return { type: 'heading2', content: text.slice(3) };
    if (text.startsWith('### ')) return { type: 'heading3', content: text.slice(4) };
    const orderedMatch = text.match(/^\s*(\d+)\.\s+(.*)$/);
    if (orderedMatch) return { type: 'ordered', content: orderedMatch[2] };
    const bulletMatch = text.match(/^\s*([*\-+])\s+(.*)$/);
    if (bulletMatch) return { type: 'bullet', content: bulletMatch[2] };
    return { type: 'text', content: text };
}

// Helper: split text into non-empty paragraphs (kept for backward compatibility)
function splitParagraphs(text: string): string[] {
    return text.split(/\r?\n/).filter(p => p.trim().length > 0);
}

// Helper: compute indent levels (kept for backward compatibility)
function computeIndentLevels(paragraphs: string[]): number[] {
    return paragraphs.map(line => Math.floor((line.match(/^\s*/)?.[0].length || 0) / 4));
}

// Node structure for nested list hierarchy (kept for backward compatibility)
type ListNode = { id: string; indent: number; children: string[]; parentId?: string };

// Helper: build node hierarchy from IDs and indent levels (kept for backward compatibility)
function buildNodesHierarchy(ids: string[], indentLevels: number[]): { nodes: Record<string, ListNode>; roots: string[] } {
    const nodes: Record<string, ListNode> = {};
    ids.forEach((id, idx) => { nodes[id] = { id, indent: indentLevels[idx], children: [] }; });
    const roots: string[] = [];
    const stack: ListNode[] = [];
    ids.forEach(id => {
        const node = nodes[id];
        while (stack.length && stack[stack.length - 1].indent >= node.indent) stack.pop();
        if (!stack.length) roots.push(id);
        else { node.parentId = stack[stack.length - 1].id; stack[stack.length - 1].children.push(id); }
        stack.push(node);
    });
    return { nodes, roots };
}
