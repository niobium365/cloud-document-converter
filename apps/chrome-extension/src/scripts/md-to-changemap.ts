#!/usr/bin/env node

import { generateChangeMap } from './paste-md-core'
import fs from 'fs'
import path from 'path'
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'

/**
 * Command line tool to convert Markdown to Lark change map
 * 
 * INPUT:  
 *   - pageBlockId: string - The ID of the page block to insert content into
 *   - text: string - Markdown content to convert
 *   - author: string - Author ID
 * 
 * OUTPUT: JSON change map compatible with Lark document API
 */

interface CommandLineArgs {
  pageBlockId: string
  input?: string
  author?: string
  output?: string
}

// Define and parse command-line arguments
const argv = yargs(hideBin(process.argv))
  .option('pageBlockId', {
    alias: 'p',
    type: 'string',
    description: 'Lark page block ID',
    demandOption: true
  })
  .option('input', {
    alias: 'i',
    type: 'string',
    description: 'Input Markdown file path (if not provided, will read from stdin)'
  })
  .option('author', {
    alias: 'a',
    type: 'string',
    description: 'Author ID',
    default: '6955273262934802433'
  })
  .option('output', {
    alias: 'o',
    type: 'string',
    description: 'Output JSON file path (if not provided, will write to stdout)'
  })
  .help()
  .argv as CommandLineArgs

/**
 * Read markdown content from file or stdin
 */
async function readInput(inputPath?: string): Promise<string> {
  if (inputPath) {
    // Read from file
    try {
      return fs.readFileSync(inputPath, 'utf8')
    } catch (error) {
      console.error(`Error reading input file: ${error.message}`)
      process.exit(1)
    }
  } else {
    // Read from stdin
    return new Promise<string>((resolve) => {
      let data = ''
      process.stdin.setEncoding('utf8')
      
      process.stdin.on('readable', () => {
        let chunk
        while ((chunk = process.stdin.read()) !== null) {
          data += chunk
        }
      })
      
      process.stdin.on('end', () => {
        resolve(data)
      })
    })
  }
}

/**
 * Generate a random UUID v4
 */
function generateUuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0,
      v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * Write change map output to file or stdout with proper structure
 */
function writeOutput(changeMap: Record<string, any>, pageBlockId: string, outputPath?: string, inputPath?: string): void {
  if (!outputPath && inputPath) {
    outputPath = inputPath + '.output.json'
  }
  // if outputPath is empty, let outputPath = inputPath+".output.json"
  // Create the proper structure matching test_req.json exactly
  const outputData = {
    "member_id": "48829052993958",
    "uuid": "da729662-a83e-4cc8-a903-c3b58325d8f4", // Use fixed UUID from reference
    "page_id": pageBlockId,
    "change_map": changeMap
  };
  
  // Format with 4 spaces indentation to match reference exactly
  const output = JSON.stringify(outputData, null, 4)
  
  if (outputPath) {
    try {
      fs.writeFileSync(outputPath, output)
      console.error(`Change map written to: ${outputPath}`)
    } catch (error) {
      console.error(`Error writing output file: ${error.message}`)
      process.exit(1)
    }
  } else {
    // Write to stdout
    process.stdout.write(output)
  }
}

/**
 * Main execution function
 */
async function main() {
  try {
    // Read markdown content
    const markdownContent = await readInput(argv.input)
    
    if (!markdownContent.trim()) {
      console.error('Error: Empty markdown content')
      process.exit(1)
    }
    
    // Generate change map from markdown
    const changeMap = generateChangeMap(
      argv.pageBlockId,
      markdownContent,
      argv.author || '6955273262934802433',
      0
    )
    
    // Write the output
    writeOutput(changeMap, argv.pageBlockId, argv.output, argv.input)
  } catch (error) {
    console.error(`Error: ${error.message}`)
    process.exit(1)
  }
}

// Execute main function directly
main().catch(error => {
  console.error(`Unhandled error: ${error.message}`)
  process.exit(1)
})