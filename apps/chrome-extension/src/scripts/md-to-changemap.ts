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
    default: '0'
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
 * Write change map output to file or stdout
 */
function writeOutput(changeMap: Record<string, any>, outputPath?: string): void {
  const output = JSON.stringify(changeMap, null, 2)
  
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
      argv.author || '0'
    )
    
    // Write the output
    writeOutput(changeMap, argv.output)
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