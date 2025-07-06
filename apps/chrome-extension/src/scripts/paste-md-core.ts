

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
  
    interface TextSegment {
      text: string;
      formats: FormattingType[];
    }
  
    interface ParsedText {
      text: string;
      attribs: string;
      formatTypes: Record<string, [string, string]>;
    }
  
  
  const parseMarkdownFormatting = (text: string, author: string): ParsedText => {
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
  
  
  /**
   * Insert paragraphs into the document
   * Handles multi-line text by creating separate paragraph blocks
   */
  export function generateChangeMap(
    pageBlockId: string,
    text: string,
    author: string,
  ): Record<string, any> {
  
        // Combined change map for all sections
        let changeMap: Record<string, any> = {};
  
      try {
      // Split text by newlines to create multiple paragraphs
      const paragraphs = text.split(/\r?\n/).filter(p => p.trim().length > 0)
      if (paragraphs.length === 0) {
        console.warn('No valid paragraphs to insert')
        return changeMap
      }
  
      // Split content into chunks of tables and regular paragraphs
      const tableHeaderRegex = /^\|(.+)\|$/;
      const tableDividerRegex = /^\|(?:\s*[-:]+\s*\|)+$/;
      
      // Group paragraphs into sections (tables, code blocks or regular paragraphs)
    let sections: {type: 'table' | 'paragraphs' | 'code' | 'hr', content: string[], language?: string}[] = [];
    let currentSection: string[] = [];
    let currentType: 'table' | 'paragraphs' | 'code' | null = null;
    let codeLanguage: string | undefined = undefined;
      
      // Helper function to determine if lines form a table
    const isTableStart = (idx: number) => {
      return idx < paragraphs.length - 1 && 
             tableHeaderRegex.test(paragraphs[idx].trim()) && 
             tableDividerRegex.test(paragraphs[idx + 1].trim());
    };
    
    // Helper function to determine if a line is a code fence start
    const isCodeFenceStart = (line: string) => {
      const match = line.match(/^```(\w*)/);  
      return match !== null ? match[1] || 'plain' : null;
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
      
      // Group paragraphs into table, code block, and regular paragraph sections
    for (let i = 0; i < paragraphs.length; i++) {
      const currentLine = paragraphs[i].trim();
      const codeLang = isCodeFenceStart(currentLine);
      
      if (isHorizontalRule(currentLine)) {
        // Found horizontal rule - finish any current section
        if (currentType && currentSection.length > 0) {
          sections.push({type: currentType, content: [...currentSection], language: codeLanguage});
          currentSection = [];
        }
        
        // Add a horizontal rule section
        sections.push({type: 'hr', content: [], language: undefined});
        currentType = null;
      } else if (codeLang) {
        // Found code fence start - finish any current section
        if (currentType && currentSection.length > 0) {
          sections.push({type: currentType, content: [...currentSection], language: codeLanguage});
          currentSection = [];
        }
        
        // Start a new code section
        currentType = 'code';
        codeLanguage = codeLang;
        
        // Collect code content until ending fence
        const codeContent: string[] = [];
        i++; // Skip the fence line
        
        while (i < paragraphs.length && !isCodeFenceEnd(paragraphs[i].trim())) {
          codeContent.push(paragraphs[i]);
          i++;
        }
        
        // Handle the closing fence (skip it if we found it)
        if (i < paragraphs.length && isCodeFenceEnd(paragraphs[i].trim())) {
          i++; // Skip the closing fence
        }
        i--; // Adjust for the outer loop increment
        
        // Save code section
        sections.push({type: 'code', content: codeContent, language: codeLanguage});
        codeLanguage = undefined;
        currentType = null;
        currentSection = [];
      } else if (isTableStart(i)) {
        // If we were collecting non-table paragraphs, save them
        if (currentType && currentSection.length > 0) {
          sections.push({type: currentType, content: [...currentSection], language: codeLanguage});
          currentSection = [];
        }
        
        // Start collecting a table
        currentType = 'table';
        currentSection = [paragraphs[i], paragraphs[i+1]];
        i += 2; // Skip the header and divider
        
        // Collect table body rows
        while (i < paragraphs.length && tableHeaderRegex.test(paragraphs[i].trim())) {
          currentSection.push(paragraphs[i]);
          i++;
        }
        i--; // Adjust for the loop increment
        
        // Save the table section
        sections.push({type: 'table', content: [...currentSection]});
        currentSection = [];
        currentType = null;
      } else {
        // If we're starting a new regular paragraph section
        if (currentType !== 'paragraphs') {
          if (currentSection.length > 0) {
            sections.push({type: currentType || 'paragraphs', content: [...currentSection], language: codeLanguage});
            currentSection = [];
            codeLanguage = undefined;
          }
          currentType = 'paragraphs';
        }
        currentSection.push(paragraphs[i]);
      }
    }
      
      // Add any remaining section
    if (currentSection.length > 0) {
      sections.push({type: currentType || 'paragraphs', content: [...currentSection], language: codeLanguage});
    }
      
      // Handle mixed content with multiple sections
      if (sections.length > 0) {
        
        // Root level block IDs to insert into the page
        let rootBlockIds: string[] = [];
        
        // Position to insert blocks
        const insertPosition = 0;
        
        // Process each section
        sections.forEach((section, sectionIndex) => {
          if (section.type === 'code') {
            // Process code block section
            const codeContent = section.content.join('\n');
            
            // Generate block ID for the code block
            const codeBlockId = generateId();
            rootBlockIds.push(codeBlockId);
            
            // Create code block in change map
            changeMap[codeBlockId] = {
              id: codeBlockId,
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
                          text: {"0": ""},
                          attribs: {"0": ""}
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
                }]
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
              } else {
                // Handle regular paragraphs with markdown formatting
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
                          parent_id: nodes[blockId].parentId || pageBlockId
                        }
                      }
                    }]
                  }
                };
              }
            });
          }
        });
        
        // Build operations for parent block (page)
        const parentOps: Array<{ p: (string | number)[], action: { li: string } | { ld: string } }> = [];
        
        // Insert root-level items in reverse so order is preserved
        rootBlockIds.slice().reverse().forEach(rootId => {
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
  
  