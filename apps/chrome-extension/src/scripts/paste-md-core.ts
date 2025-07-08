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
        
        // Parse the Markdown content using unified/remark-parse
        const ast = parseMarkdownWithUnified(text);

        //
        
    }
    catch(err){
        //
    }
}
