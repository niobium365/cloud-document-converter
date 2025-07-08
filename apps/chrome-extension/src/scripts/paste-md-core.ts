

// Helper for base62 IDs (27-char) to match Lark block IDs
const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
const generateId = (): string => Array.from({ length: 27 }).map(() => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('')

/**
 * Generate a UUID v4
 */
const generateUuid = (): string => {
    return crypto.randomUUID()
}
// Determine block type based on Markdown syntax
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


// Helper: split text into non-empty paragraphs
function splitParagraphs(text: string): string[] {
    return text.split(/\r?\n/).filter(p => p.trim().length > 0);
}

// Helper: compute indent levels (4 spaces per level)
function computeIndentLevels(paragraphs: string[]): number[] {
    return paragraphs.map(line => Math.floor((line.match(/^\s*/)?.[0].length || 0) / 4));
}

// Node structure for nested list hierarchy
type ListNode = { id: string; indent: number; children: string[]; parentId?: string };

// Helper: build node hierarchy from IDs and indent levels
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

// Helper function to parse Markdown formatting
type FormattingType = 'bold' | 'italic' | 'strikethrough';

// Helper function to generate an object ID for equations
function generateObjectId(): string {
    // This follows the Lark pattern of generating 8-character IDs
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < 8; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

interface TextSegment {
    text: string;
    formats: FormattingType[];
    equation?: string; // For equation content
    objectId?: string; // Unique ID for the equation
}

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


const parseMarkdownFormatting = (text: string, author: string): ParsedText => {
    // Prepare result structure
    const result: ParsedText = {
        text,
        attribs: '',
        formatTypes: {
            '0': ['author', author]
        }
    };
    
    // First check for centered equations with $$...$$ pattern
    const centeredEquationRegex = /\$\$(.*?)\$\$/g;
    const centeredMatch = centeredEquationRegex.exec(text);
    
    if (centeredMatch) {
        // We found a centered equation - special handling
        const equationContent = centeredMatch[1];
        const objectId = generateObjectId();
        
        // Store equation metadata for special handling during block creation
        result.formatTypes['1'] = ['equation', equationContent];
        result.formatTypes['2'] = ['objectID', objectId];
        
        // Store equation data for centering and special handling
        result.equationData = {
            equation: equationContent,
            objectId: objectId,
            startPos: centeredMatch.index,
            length: equationContent.length,
            isCentered: true,
            fullMatch: centeredMatch[0]
        };
        
        return result;
    }

    // If there's no special formatting or equations, return simple format
    if (!text.includes('**') && !text.includes('*') && !text.includes('~~') && !text.includes('$')) {
        result.attribs = `*0+${text.length.toString(36)}`;
        return result;
    }
    
    // Handle equations first - they should be processed separately from other formatting
    const equationRegex = /\$(.*?)\$/g;
    let matches: RegExpExecArray | null;
    let lastIndex = 0;
    let equationSegments: TextSegment[] = [];
    
    // Process all equation segments
    while ((matches = equationRegex.exec(text)) !== null) {
        const beforeText = text.substring(lastIndex, matches.index);
        if (beforeText) {
            equationSegments.push({
                text: beforeText,
                formats: []
            });
        }
        
        // Generate a unique objectID for this equation
        const objectId = generateObjectId();
        
        // Add equation with special attributes
        equationSegments.push({
            text: matches[1], // The equation content without $ markers
            formats: [],
            equation: matches[1],
            objectId: objectId
        });
        
        lastIndex = matches.index + matches[0].length;
    }
    
    // Add any remaining text after the last equation
    const remainingText = text.substring(lastIndex);
    if (remainingText || equationSegments.length === 0) {
        equationSegments.push({
            text: remainingText || text,
            formats: []
        });
    }
    
    // If no equations were found, process normally
    let segments = equationSegments.length > 1 ? equationSegments : [{ text: text, formats: [] }];

    // Format markers and their corresponding attribute types
    const formatMarkers = [
        { marker: '**', type: 'bold' },
        { marker: '*', type: 'italic' },
        { marker: '~~', type: 'strikethrough' }
    ];


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

    // Process segments into attributed text format
    let plainText = '';
    let attribs = '';
    let nextNum = 1;
    const formatTypeMap: Record<string, number> = {};

    for (const segment of segments) {
        const startPos = plainText.length;
        plainText += segment.text;

        // Start with author attribute
        let segAttrib = '*0';

        // Add formatting attribute identifiers
        for (const format of segment.formats) {
            // Add format attribute if needed
            if (!formatTypeMap[format]) {
                formatTypeMap[format] = nextNum++;
                result.formatTypes[formatTypeMap[format].toString()] = [format, ''];
            }
            segAttrib += `*${formatTypeMap[format]}`;
        }
        
        // Add equation attributes if this is an equation segment
        if (segment.equation) {
            // Add equation attribute
            if (!formatTypeMap['equation']) {
                formatTypeMap['equation'] = nextNum++;
                result.formatTypes[formatTypeMap['equation'].toString()] = ['equation', segment.equation];
            } else {
                // Update the equation value for this specific equation
                result.formatTypes[formatTypeMap['equation'].toString()][1] = segment.equation;
            }
            segAttrib += `*${formatTypeMap['equation']}`;
            
            // Add objectID attribute
            if (segment.objectId) {
                if (!formatTypeMap['objectID']) {
                    formatTypeMap['objectID'] = nextNum++;
                    result.formatTypes[formatTypeMap['objectID'].toString()] = ['objectID', segment.objectId];
                } else {
                    // Update the objectID value for this specific equation
                    result.formatTypes[formatTypeMap['objectID'].toString()][1] = segment.objectId;
                }
                segAttrib += `*${formatTypeMap['objectID']}`;
            }
            
            // Store information for easysync format
            if (!result.equationData) {
                result.equationData = {
                    equation: segment.equation,
                    objectId: segment.objectId || '',
                    startPos: plainText.length - segment.text.length,
                    length: segment.text.length
                };
            }
        }

        // Add length in base36
        segAttrib += `+${segment.text.length.toString(36)}`;
        attribs += segAttrib;
    }

    result.text = plainText;
    result.attribs = attribs;
    return result;
};


/**
 * Insert paragraphs into the document
 * Handles multi-line text by creating separate paragraph blocks
 */
export function generateChangeMap(
    pageBlockId: string,
    text: string,
    author: string,
    insertPosition: number,
): Record<string, any> {

    // Combined change map for all sections
    let changeMap: Record<string, any> = {};

    try {
        // Split text by newlines
        const lines = text.split(/\r?\n/)
        if (lines.length === 0) {
            console.warn('No valid content to insert')
            return changeMap
        }

        // Split content into chunks of tables and regular paragraphs
        const tableHeaderRegex = /^\|(.+)\|$/;
        const tableDividerRegex = /^\|(?:\s*[-:]+\s*\|)+$/;

        // Group paragraphs into sections (tables, code blocks, blockquotes, or regular paragraphs)
        let sections: { type: 'table' | 'paragraphs' | 'code' | 'hr' | 'blockquote', content: string[], language?: string }[] = [];
        let currentSection: string[] = [];
        let currentType: 'table' | 'paragraphs' | 'code' | 'blockquote' | null = null;
        let codeLanguage: string | undefined = undefined;

        // Helper function to determine if lines form a table
        const isTableStart = (idx: number) => {
            return idx < lines.length - 1 &&
                tableHeaderRegex.test(lines[idx].trim()) &&
                tableDividerRegex.test(lines[idx + 1].trim());
        };

        // Helper function to determine if a line is a code fence start
        const isCodeFenceStart = (line: string): string | null => {
            const match = line.match(/^```([a-zA-Z0-9]*)/);
            return match ? (match[1] || 'text') : null;
        };
        
        // Helper function to determine if this is a mermaid diagram
        const isMermaidDiagram = (language: string): boolean => {
            return language.toLowerCase() === 'mermaid';
        };

        // Helper function to determine if a line is a code fence end
        const isCodeFenceEnd = (line: string) => {
            return line.trim().startsWith('```');
        };

        // Helper function to determine if a line is a horizontal rule
        const isHorizontalRule = (line: string) => {
            const trimmedLine = line.trim();
            return (/^-{3,}$/.test(trimmedLine) || /^\*{3,}$/.test(trimmedLine) || /^_{3,}$/.test(trimmedLine));
        };

        // Helper function to determine if a line is a blockquote
        const isBlockquoteLine = (line: string) => {
            return line.trim().startsWith('>');
        };
        
        // Helper function to extract content from a blockquote line
        const extractBlockquoteContent = (line: string) => {
            return line.replace(/^\s*>\s?/, '');
        };

        // Group paragraphs into table, code block, blockquote, and regular paragraph sections
        for (let i = 0; i < lines.length; i++) {
            const currentLine = lines[i];
            const trimmedLine = currentLine.trim();
            const codeLang = isCodeFenceStart(trimmedLine);
            
            // Skip empty lines unless we're in a blockquote section
            if (trimmedLine === '' && currentType !== 'blockquote') {
                // End current section if any
                if (currentType && currentSection.length > 0) {
                    sections.push({ type: currentType, content: [...currentSection], language: codeLanguage });
                    currentSection = [];
                    currentType = null;
                }
                continue;
            }

            if (isHorizontalRule(trimmedLine)) {
                // Found horizontal rule - finish any current section
                if (currentType && currentSection.length > 0) {
                    sections.push({ type: currentType, content: [...currentSection], language: codeLanguage });
                    currentSection = [];
                }

                // Add a horizontal rule section
                sections.push({ type: 'hr', content: [], language: undefined });
                currentType = null;
            } else if (codeLang) {
                // Found code fence start - finish any current section
                if (currentType && currentSection.length > 0) {
                    sections.push({ type: currentType, content: [...currentSection], language: codeLanguage });
                    currentSection = [];
                }

                // Start a new code section
                currentType = 'code';
                codeLanguage = codeLang;

                // Collect code content until ending fence
                const codeContent: string[] = [];
                i++; // Skip the fence line

                while (i < lines.length && !isCodeFenceEnd(lines[i].trim())) {
                    codeContent.push(lines[i]);
                    i++;
                }

                // Handle the closing fence (skip it if we found it)
                if (i < lines.length && isCodeFenceEnd(lines[i].trim())) {
                    i++; // Skip the closing fence
                }
                i--; // Adjust for the outer loop increment

                // Save code section
                sections.push({ type: 'code', content: codeContent, language: codeLanguage });
                codeLanguage = undefined;
                currentType = null;
                currentSection = [];
            } else if (isTableStart(i)) {
                // If we were collecting non-table paragraphs, save them
                if (currentType && currentSection.length > 0) {
                    sections.push({ type: currentType, content: [...currentSection], language: codeLanguage });
                    currentSection = [];
                }

                // Start collecting a table
                currentType = 'table';
                currentSection = [lines[i], lines[i + 1]];
                i += 2; // Skip the header and divider

                // Collect table body rows
                while (i < lines.length && tableHeaderRegex.test(lines[i].trim())) {
                    currentSection.push(lines[i]);
                    i++;
                }
                i--; // Adjust for the loop increment

                // Save the table section
                sections.push({ type: 'table', content: [...currentSection] });
                currentSection = [];
                currentType = null;
            } else if (isBlockquoteLine(currentLine)) {
                // If we were collecting something other than blockquotes, save it
                if (currentType !== 'blockquote' && currentSection.length > 0) {
                    sections.push({ type: currentType || 'paragraphs', content: [...currentSection], language: codeLanguage });
                    currentSection = [];
                }
                
                // Start or continue a blockquote section
                currentType = 'blockquote';
                
                // Add the content without the blockquote marker
                const content = extractBlockquoteContent(currentLine);
                currentSection.push(content);
            } else if (currentType === 'blockquote') {
                // Check if this is an empty line that might end the blockquote
                if (trimmedLine === '') {
                    // We need to peek ahead to see if next non-empty line is a blockquote
                    let isBlockquoteContinuation = false;
                    let j = i + 1;
                    while (j < lines.length) {
                        const nextLine = lines[j].trim();
                        if (nextLine !== '') {
                            // If next non-empty line is a blockquote, this is just a paragraph break
                            isBlockquoteContinuation = isBlockquoteLine(lines[j]);
                            break;
                        }
                        j++;
                    }
                    
                    if (isBlockquoteContinuation) {
                        // Empty line is part of the blockquote - marks paragraph separation
                        currentSection.push('');
                    } else {
                        // Empty line ends the blockquote section
                        if (currentSection.length > 0) {
                            sections.push({ type: 'blockquote', content: [...currentSection], language: undefined });
                        }
                        currentSection = [];
                        currentType = null;
                    }
                } else {
                    // Content line without '>' marker - still part of blockquote
                    currentSection.push(trimmedLine);
                }
            } else {
                // If we're starting a new regular paragraph section
                if (currentType !== 'paragraphs') {
                    if (currentSection.length > 0) {
                        sections.push({ type: currentType || 'paragraphs', content: [...currentSection], language: codeLanguage });
                        currentSection = [];
                        codeLanguage = undefined;
                    }
                    currentType = 'paragraphs';
                }
                currentSection.push(lines[i]);
            }
        }

        // Add any remaining section
        if (currentSection.length > 0) {
            sections.push({ type: currentType || 'paragraphs', content: [...currentSection], language: codeLanguage });
        }

        // Handle mixed content with multiple sections
        if (sections.length > 0) {

            // Root level block IDs to insert into the page
            let rootBlockIds: string[] = [];


            // Process each section
            sections.forEach((section, sectionIndex) => {
                if (section.type === 'code') {
                    // Process code block section
                    const codeContent = section.content.join('\n');

                    // Generate block ID
                    const blockId = generateId();
                    rootBlockIds.push(blockId);
                    
                    // Check if this is a mermaid diagram
                    if (isMermaidDiagram(section.language || '')) {
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
                                            text: {
                                                initialAttributedTexts: {
                                                    text: { '0': codeContent },
                                                    attribs: { '0': `*0|${(codeContent.split('\n').length - 1).toString(36)}+${codeContent.length.toString(36)}` }
                                                },
                                                apool: {
                                                    numToAttrib: { '0': ['author', author] },
                                                    nextNum: 1
                                                }
                                            },
                                            language: section.language,
                                            wrap: false,
                                            caption: {
                                                text: {
                                                    initialAttributedTexts: {
                                                        text: { '0': '\n' },
                                                        attribs: { '0': '|1+1' }
                                                    },
                                                    apool: {
                                                        numToAttrib: {},
                                                        nextNum: 0
                                                    }
                                                }
                                            },
                                            parent_id: pageBlockId
                                        }
                                    }
                                }]
                            }
                        };
                    }
                } else if (section.type === 'hr') {
                    // Process horizontal rule section
                    const hrBlockId = generateId();
                    rootBlockIds.push(hrBlockId);

                    // Create divider block in change map
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
                                        text: {
                                            initialAttributedTexts: {
                                                text: { "0": "" },
                                                attribs: { "0": "" }
                                            },
                                            apool: {
                                                numToAttrib: {},
                                                nextNum: 0
                                            }
                                        },
                                        parent_id: pageBlockId
                                    }
                                }
                            }]
                        }
                    };
                } else if (section.type === 'table') {
                    // Process table section
                    const tableParagraphs = section.content;
                    const headerCells = tableParagraphs[0].trim().slice(1, -1).split('|').map(c => c.trim());
                    const bodyRows = tableParagraphs.slice(2).map(row => row.trim().slice(1, -1).split('|').map(c => c.trim()));

                    // Generate table block ID
                    const tableBlockId = generateId();
                    rootBlockIds.push(tableBlockId);

                    // Generate column and row IDs
                    const columnIds = headerCells.map(() => 'col' + generateUuid());
                    const rowIds = [generateUuid(), ...bodyRows.map(() => generateUuid())].map(id => 'row' + id);

                    // Generate cell and text IDs
                    const cellIds: string[][] = [];
                    const textIds: string[][] = [];

                    // Header cells
                    headerCells.forEach((_, colIdx) => {
                        textIds[0] = textIds[0] || [];
                        cellIds[0] = cellIds[0] || [];
                        textIds[0][colIdx] = generateId();
                        cellIds[0][colIdx] = generateId();
                    });

                    // Body cells
                    bodyRows.forEach((cells, rowIdx) => {
                        textIds[rowIdx + 1] = [];
                        cellIds[rowIdx + 1] = [];
                        cells.forEach((_, colIdx) => {
                            textIds[rowIdx + 1][colIdx] = generateId();
                            cellIds[rowIdx + 1][colIdx] = generateId();
                        });
                    });

                    // Table block
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
                            },
                            { p: ['header_row'], action: { oi: true } },
                            { p: ['header_column'], action: { oi: true } },

                           ]
                        }
                    };

                    // Cell and text blocks for header
                    headerCells.forEach((cellText, colIdx) => {
                        const textId = textIds[0][colIdx];
                        const cellId = cellIds[0][colIdx];
                        const len = cellText.length.toString(36);

                        // Text block
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

                        // Cell block
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

                    // Cell and text blocks for body
                    bodyRows.forEach((cells, rowIdx) => {
                        cells.forEach((cellText, colIdx) => {
                            const textId = textIds[rowIdx + 1][colIdx];
                            const cellId = cellIds[rowIdx + 1][colIdx];
                            const len = cellText.length.toString(36);

                            // Parse Markdown formatting for table cells
                            const parsed = parseMarkdownFormatting(cellText, author);
                            
                            // Create numToAttrib from formatTypes
                            const numToAttrib: Record<string, [string, string]> = {
                                '0': ['author', author]
                            };
                            
                            // Add format types
                            Object.entries(parsed.formatTypes).forEach(([key, value]) => {
                                if (key !== '0') { // Skip author attribute
                                    numToAttrib[key] = value;
                                }
                            });
                            
                            // Text block
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
                                                align: 'left',
                                                parent_id: cellId
                                            }
                                        }
                                    }]
                                }
                            };

                            // Cell block
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
                } else if (section.type === 'blockquote') {
                    // Process blockquote section
                    
                    // Generate blockquote container block ID
                    const blockquoteContainerId = generateId();
                    rootBlockIds.push(blockquoteContainerId);
                    
                    // Process blockquote content: group lines into paragraphs
                    let paragraphs: string[] = [];
                    
                    // We want to preserve the individual lines in the blockquote
                    // Each non-empty line becomes its own paragraph
                    for (let i = 0; i < section.content.length; i++) {
                        const line = section.content[i].trim();
                        
                        // Skip empty lines
                        if (line === '') {
                            continue;
                        }
                        
                        // Add line as its own paragraph
                        paragraphs.push(line);
                    }
                    
                    // If no paragraphs were created, add an empty one
                    if (paragraphs.length === 0) {
                        paragraphs.push('');
                    }
                    
                    // If no paragraphs were created (e.g., only empty lines), create an empty paragraph
                    if (paragraphs.length === 0) {
                        paragraphs.push('');
                    }
                    
                    // Generate child text block IDs for each paragraph
                    const textBlockIds = paragraphs.map(() => generateId());
                    
                    // Create blockquote container block
                    changeMap[blockquoteContainerId] = {
                        id: blockquoteContainerId,
                        version: 0,
                        payload: {
                            ops: [{
                                p: [],
                                action: {
                                    oi: {
                                        type: "quote_container",
                                        children: textBlockIds,
                                        comments: [],
                                        revisions: [],
                                        author: author,
                                        parent_id: pageBlockId
                                    }
                                }
                            }]
                        }
                    };
                    
                    // Add block to page children
                    if (!changeMap[pageBlockId]) {
                        changeMap[pageBlockId] = {
                            id: pageBlockId,
                            version: 452,
                            payload: {
                                ops: []
                            }
                        };
                    }
                    
                    changeMap[pageBlockId].payload.ops.push({
                        p: ["children", insertPosition],
                        action: {
                            li: blockquoteContainerId
                        }
                    });
                    
                    // Create text blocks for each paragraph in blockquote
                    paragraphs.forEach((paragraph, index) => {
                        // Parse markdown formatting within blockquote paragraph
                        const parsed = parseMarkdownFormatting(paragraph, author);
                        const textId = textBlockIds[index];
                        
                        // Create base blockquote text block
                        const blockquoteTextBlock = {
                            type: "text",
                            children: [],
                            comments: [],
                            revisions: [],
                            author: author,
                            text: {
                                initialAttributedTexts: {
                                    text: { "0": parsed.text },
                                    attribs: { "0": parsed.attribs }
                                },
                                apool: {
                                    numToAttrib: parsed.formatTypes,
                                    nextNum: Object.keys(parsed.formatTypes).length
                                }
                            },
                            folded: false,
                            parent_id: blockquoteContainerId
                        };
                        
                        // Create the base ops for the blockquote text block
                        const baseOps = [{
                            p: [],
                            action: {
                                oi: blockquoteTextBlock
                            }
                        }];
                        
                        // Add equation subType operation if equations are present
                        if (parsed.equationData) {
                            // Convert text length to base36 for easysync format
                            const textLengthBase36 = parsed.text.length.toString(36);
                            
                            // Get the length of the equation content
                            const equationLength = parsed.equationData.length.toString(36);
                            
                            // Create the exact format string needed for zone_changesets
                            // Format: Z:length>0=startPos*0*1*2=equationLength$
                            const formatString = `Z:${textLengthBase36}>0=${parsed.equationData.startPos}*0*1*2=${equationLength}$`;
                            
                            // Add an operation to set the subType for easysync
                            baseOps.push({
                                p: ['text'],
                                subType: {
                                    t: 'easysync',
                                    o: {
                                        zone_changesets: {
                                            0: formatString
                                        },
                                        apool: {
                                            numToAttrib: parsed.formatTypes,
                                            nextNum: Object.keys(parsed.formatTypes).length
                                        }
                                    }
                                }
                            });
                        }
                        
                        // Create the change map entry
                        changeMap[textId] = {
                            id: textId,
                            version: 0,
                            payload: {
                                ops: baseOps
                            }
                        };
                    });
                } else {
                    // Process paragraphs section
                    const sectionParagraphs = section.content;

                    // Generate block IDs for each paragraph
                    const sectionBlockIds = sectionParagraphs.map(() => generateId());
                    const indentLevels = computeIndentLevels(sectionParagraphs);
                    const { nodes, roots } = buildNodesHierarchy(sectionBlockIds, indentLevels);

                    // Add root blocks to the list
                    rootBlockIds.push(...roots);

                    // Variables to manage ordered list numbering
                    let inOrderedList = false;

                    // Add each paragraph block to the change_map
                    sectionBlockIds.forEach((blockId, index) => {
                        // Get the corresponding paragraph text
                        const paragraphText = sectionParagraphs[index];

                        // Determine block type based on markdown syntax
                        const { type, content } = getBlockType(paragraphText);

                        if (type === 'heading1' || type === 'heading2' || type === 'heading3') {
                            // Handle heading blocks
                            const textLength = content.length.toString(36);

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
                                                parent_id: nodes[blockId].parentId || pageBlockId
                                            }
                                        }
                                    }]
                                }
                            };
                        } else if (type === 'ordered' || type === 'bullet') {
                            // Handle list items
                            if (type === 'ordered') {
                                if (!inOrderedList) {
                                    inOrderedList = true;
                                }
                            } else {
                                inOrderedList = false;
                            }
                            
                            // Parse Markdown formatting for list items
                            const parsed = parseMarkdownFormatting(content, author);
                            
                            // Create numToAttrib from formatTypes
                            const numToAttrib: Record<string, [string, string]> = {
                                '0': ['author', author]
                            };
                            
                            // Add format types
                            Object.entries(parsed.formatTypes).forEach(([key, value]) => {
                                if (key !== '0') { // Skip author attribute
                                    numToAttrib[key] = value;
                                }
                            });
                            
                            // Determine seq for ordered list items
                            let seqValue: string | undefined;
                            if (type === 'ordered') {
                                seqValue = inOrderedList ? 'auto' : '1';
                            }

                            // Create the base ops for the list item
                            const baseOps = [{
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
                                        parent_id: nodes[blockId].parentId || pageBlockId
                                    }
                                }
                            }];
                            
                            // Add equation subType operation if equations are present
                            if (parsed.equationData) {
                                // Convert text length to hex for easysync format
                                const textLengthHex = parsed.text.length.toString(36);
                                
                                // Create the exact format string needed for zone_changesets
                                // Format: Z:length>0=startPos*0*1*2=equationLength$
                                const formatString = `Z:${textLengthHex}>0=${parsed.equationData.startPos.toString(36)}*0*1*2=${parsed.equationData.length.toString(36)}$`;
                                
                                // Add an operation to set the subType for easysync
                                baseOps.push({
                                    p: ['text'],
                                    subType: {
                                        t: 'easysync',
                                        o: {
                                            zone_changesets: {
                                                0: formatString
                                            },
                                            apool: {
                                                numToAttrib: numToAttrib,
                                                nextNum: Object.keys(numToAttrib).length
                                            }
                                        }
                                    }
                                });
                            }
                            
                            // Create the change map entry
                            changeMap[blockId] = {
                                id: blockId,
                                version: 0,
                                payload: {
                                    ops: baseOps
                                }
                            };
                        } else {
                            // Handle regular paragraphs with markdown formatting
                            const parsed = parseMarkdownFormatting(content, author);

                            // Check if this paragraph contains a centered equation ($$...$$)
                            if (parsed.equationData && parsed.equationData.isCentered) {
                                // For centered equations, we need special handling
                                const equationContent = parsed.equationData.equation;
                                const objectId = parsed.equationData.objectId;
                                const startPos = parsed.equationData.startPos;
                                const fullMatch = parsed.equationData.fullMatch;
                                
                                // Create an array to hold the IDs of blocks to add
                                const blockIdsToAdd = [];
                                
                                // Split the content around the centered equation
                                const beforeText = content.substring(0, startPos);
                                const afterText = content.substring(startPos + fullMatch.length);
                                
                                // Generate IDs for new blocks
                                const beforeId = beforeText ? generateId() : null;
                                const equationId = generateId();
                                const afterId = afterText ? generateId() : null;
                                
                                // Create a block for text before the equation if needed
                                if (beforeText.trim()) {
                                    const beforeOps = [{
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
                                                        text: { '0': beforeText },
                                                        attribs: { '0': `*0+${beforeText.length.toString(36)}` }
                                                    },
                                                    apool: {
                                                        numToAttrib: { '0': ['author', author] },
                                                        nextNum: 1
                                                    }
                                                },
                                                folded: false,
                                                parent_id: nodes[blockId].parentId || pageBlockId
                                            }
                                        }
                                    }];
                                    
                                    changeMap[beforeId] = {
                                        id: beforeId,
                                        version: 0,
                                        payload: {
                                            ops: beforeOps
                                        }
                                    };
                                    
                                    blockIdsToAdd.push(beforeId);
                                }
                                
                                // Create the centered equation block
                                const equationNumToAttrib = {
                                    '0': ['author', author],
                                    '1': ['equation', equationContent],
                                    '2': ['objectID', objectId]
                                };
                                
                                const equationOps = [{
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
                                                    text: { '0': ' ' },  // Single space for centered equations
                                                    attribs: { '0': '*0*1*2+1' }  // Apply all attributes
                                                },
                                                apool: {
                                                    numToAttrib: equationNumToAttrib,
                                                    nextNum: 3
                                                }
                                            },
                                            folded: false,
                                            parent_id: nodes[blockId].parentId || pageBlockId,
                                            align: 'center'  // Set alignment to center
                                        }
                                    }
                                }];
                                
                                // Add easysync subType for the centered equation
                                equationOps.push({
                                    p: ['text'],
                                    subType: {
                                        t: 'easysync',
                                        o: {
                                            zone_changesets: {
                                                '0': 'Z:1>0*0*1*2=1$'  // Fixed format for centered equations
                                            },
                                            apool: {
                                                numToAttrib: equationNumToAttrib,
                                                nextNum: 3
                                            }
                                        }
                                    }
                                });
                                
                                changeMap[equationId] = {
                                    id: equationId,
                                    version: 0,
                                    payload: {
                                        ops: equationOps
                                    }
                                };
                                
                                blockIdsToAdd.push(equationId);
                                
                                // Create a block for text after the equation if needed
                                if (afterText.trim()) {
                                    const afterOps = [{
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
                                                        text: { '0': afterText },
                                                        attribs: { '0': `*0+${afterText.length.toString(36)}` }
                                                    },
                                                    apool: {
                                                        numToAttrib: { '0': ['author', author] },
                                                        nextNum: 1
                                                    }
                                                },
                                                folded: false,
                                                parent_id: nodes[blockId].parentId || pageBlockId
                                            }
                                        }
                                    }];
                                    
                                    changeMap[afterId] = {
                                        id: afterId,
                                        version: 0,
                                        payload: {
                                            ops: afterOps
                                        }
                                    };
                                    
                                    blockIdsToAdd.push(afterId);

                                    // Replace the original paragraph blockId with new blocks in rootBlockIds
                                    const rootIndex = rootBlockIds.indexOf(blockId);
                                    if (rootIndex !== -1) {
                                        rootBlockIds.splice(rootIndex, 1, ...blockIdsToAdd);
                                    }
                                }
                                
                                // Find and update the parent's children to include our new blocks
                                const parentId = nodes[blockId].parentId || pageBlockId;
                                if (parentId && changeMap[parentId] && changeMap[parentId].payload && changeMap[parentId].payload.ops) {
                                    // Find the position of the original block
                                    const parentOps = changeMap[parentId].payload.ops;
                                    const childOpIndex = parentOps.findIndex(op => 
                                        op.p && op.p[0] === 'children' && 
                                        op.action && op.action.li === blockId
                                    );
                                    
                                    if (childOpIndex !== -1) {
                                        // Remove the original block reference
                                        parentOps.splice(childOpIndex, 1);
                                        
                                        // Add our new blocks in its place
                                        blockIdsToAdd.forEach((id, idx) => {
                                            parentOps.push({
                                                p: ['children', childOpIndex + idx],
                                                action: { li: id }
                                            });
                                        });
                                    }
                                }
                                
                                // Skip normal block creation since we've handled this specially
                                return;
                            }
                            
                            // For regular paragraphs without centered equations
                            // Create numToAttrib from formatTypes
                            const numToAttrib: Record<string, [string, string]> = {
                                '0': ['author', author]
                            };

                            // Add format types
                            Object.entries(parsed.formatTypes).forEach(([key, value]) => {
                                if (key !== '0') { // Skip author attribute
                                    numToAttrib[key] = value;
                                }
                            });

                            // Create the base ops for the paragraph
                            const baseOps = [{
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
                                        parent_id: nodes[blockId].parentId || pageBlockId
                                    }
                                }
                            }];
                            
                            // Add equation subType operation if equations are present
                            if (parsed.equationData) {
                                // Convert text length to hex for easysync format
                                const textLengthHex = parsed.text.length.toString(36);
                                
                                // Create the exact format string needed for zone_changesets
                                // Format: Z:length>0=startPos*0*1*2=equationLength$
                                const formatString = `Z:${textLengthHex}>0=${parsed.equationData.startPos.toString(36)}*0*1*2=${parsed.equationData.length.toString(36)}$`;
                                
                                // Add an operation to set the subType for easysync
                                baseOps.push({
                                    p: ['text'],
                                    subType: {
                                        t: 'easysync',
                                        o: {
                                            zone_changesets: {
                                                0: formatString
                                            },
                                            apool: {
                                                numToAttrib: numToAttrib,
                                                nextNum: Object.keys(numToAttrib).length
                                            }
                                        }
                                    }
                                });
                            }
                            
                            // Create the change map entry
                            changeMap[blockId] = {
                                id: blockId,
                                version: 0,
                                payload: {
                                    ops: baseOps
                                }
                            };
                        }
                    });
                }
            });

            // Build operations for parent block (page)
            const parentOps: Array<{ p: (string | number)[], action: { li: string } | { ld: string } }> = [];

            // Insert root-level items in reverse so order is preserved
            const validRootBlockIds = rootBlockIds.filter(id => changeMap[id] !== undefined);
            validRootBlockIds.slice().reverse().forEach(rootId => {
                parentOps.push({ p: ['children', insertPosition], action: { li: rootId } });
            });

            // Add page block to change map
            changeMap[pageBlockId] = {
                id: pageBlockId,
                version: 1, // Will be updated after dummy op
                payload: { ops: parentOps }
            };

            // Delegate /user_change calls to helper
            return changeMap;
        }
        return changeMap;
    } catch (error) {
        console.error('Error inserting paragraph:', error)
        return changeMap
    }
}

