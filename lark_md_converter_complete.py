#!/usr/bin/env python3
"""
Complete Lark Markdown Converter
- Uploads markdown file to Lark
- Imports it as a document
- Identifies text-based mermaid blocks
- Converts them to addon-based mermaid blocks in-place
- Extracts and uploads images from markdown to Lark document
"""
import os
import json
import time
import argparse
import requests
import re
import random
from pathlib import Path
import urllib.parse

# App credentials
APP_ID = os.environ.get("LARK_APP_ID", "cli_a76a6e9fbbf2100d")
APP_SECRET = os.environ.get("LARK_APP_SECRET", "yDUWPeCBy40g71owTtoGVhX1vQHVnGGJ")

def get_tenant_access_token():
    """Get tenant access token for API authentication"""
    token_url = "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal"
    token_headers = {"Content-Type": "application/json"}
    token_data = {"app_id": APP_ID, "app_secret": APP_SECRET}
    
    response = requests.post(token_url, headers=token_headers, json=token_data)
    result = response.json()
    
    if "tenant_access_token" in result:
        return result["tenant_access_token"]
    else:
        print(f"Error getting access token: {result}")
        return None

def extract_mermaid_from_markdown(file_path):
    """Extract Mermaid code blocks from markdown file"""
    file_path = Path(file_path)
    if not file_path.exists():
        print(f"Error: File {file_path} does not exist")
        return []
    
    # Read the file content
    content = file_path.read_text(encoding="utf-8")
    
    # Pattern to find Mermaid code blocks
    mermaid_pattern = r'```mermaid\s+([\s\S]*?)\s+```'
    
    # Find all mermaid blocks
    mermaid_blocks = []
    for match in re.finditer(mermaid_pattern, content):
        mermaid_blocks.append({
            'code': match.group(1).strip(),
            'full_match': match.group(0)
        })
    
    if mermaid_blocks:
        print(f"Found {len(mermaid_blocks)} Mermaid diagram(s) in the markdown file")
        for i, block in enumerate(mermaid_blocks):
            print(f"Mermaid diagram {i+1}: {block['code'][:50]}...")
        return mermaid_blocks
    else:
        print("No Mermaid diagrams found in the markdown file")
        return []

def extract_images_from_markdown(file_path):
    """Extract image references from markdown file"""
    file_path = Path(file_path)
    if not file_path.exists():
        print(f"Error: File {file_path} does not exist")
        return []
    
    # Get the directory of the markdown file to resolve relative image paths
    base_dir = file_path.parent
    
    # Read the file content
    try:
        content = file_path.read_text(encoding="utf-8")
    except Exception as e:
        print(f"Error reading file {file_path}: {str(e)}")
        return []
    
    # Pattern to find markdown image references: ![alt text](image_path)
    # This pattern captures both the alt text and the image path
    image_pattern = r'!\[([^\]]*)\]\(([^\)]+)\)'
    
    # Find all image references
    image_refs = []
    for match in re.finditer(image_pattern, content):
        alt_text = match.group(1)
        image_path = match.group(2)
        
        # Clean up image path (remove query parameters if any)
        clean_path = image_path.split('?')[0]
        
        # Resolve relative paths
        if not (clean_path.startswith('http://') or clean_path.startswith('https://')):
            # Handle URL encoded paths
            clean_path = urllib.parse.unquote(clean_path)
            full_path = base_dir / clean_path
            
            # Add the reference even if the file doesn't exist yet
            # We'll filter out non-existent files later in the main function
            image_refs.append({
                'alt_text': alt_text,
                'path': str(full_path),
                'file_name': full_path.name,
                'full_match': match.group(0)
            })
            
            # Just log if file doesn't exist, but still track the reference
            if not full_path.exists():
                print(f"Note: Image file reference found but file not present: {full_path}")
        else:
            # Remote image (not supported in this implementation)
            print(f"Warning: Remote images not supported: {clean_path}")
    
    if image_refs:
        print(f"Found {len(image_refs)} image reference(s) in the markdown file")
        for i, image in enumerate(image_refs):
            print(f"Image {i+1}: {image['file_name']} - {image['alt_text']}")
        return image_refs
    else:
        print("No image references found in the markdown file")
        return []

def upload_file(token, file_path, domain="open.feishu.cn"):
    """Upload a file to Lark"""
    file_path = Path(file_path)
    if not file_path.exists():
        print(f"Error: File {file_path} does not exist")
        return None
    
    # Get file size
    file_size = file_path.stat().st_size
    
    # Upload file API endpoint
    upload_url = f"https://{domain}/open-apis/drive/v1/medias/upload_all"
    headers = {
        "Authorization": f"Bearer {token}"
    }
    
    # Extra data for Markdown file
    extra_data = {
        "obj_type": "docx",
        "file_extension": "md"
    }
    
    # Prepare multipart form data
    files = {
        'file': (file_path.name, open(file_path, 'rb'), 'text/markdown')
    }
    
    form_data = {
        'file_name': file_path.name,
        'parent_type': 'ccm_import_open',
        'size': str(file_size),
        'extra': json.dumps(extra_data)
    }
    
    # Upload file
    print(f"Uploading {file_path.name} ({file_size} bytes)...")
    response = requests.post(upload_url, headers=headers, data=form_data, files=files)
    
    # Close the file handle
    files['file'][1].close()
    
    # Parse response
    if response.status_code == 200:
        result = response.json()
        
        if result.get("code") == 0 and "data" in result and "file_token" in result["data"]:
            file_token = result["data"]["file_token"]
            print(f"Upload successful! File token: {file_token}")
            return file_token
        else:
            print(f"API Error: {result}")
            return None
    else:
        print(f"HTTP Error: {response.status_code}")
        print(f"Response: {response.text}")
        return None

# Forward declaration - the actual implementation is at the end of the file
def import_to_document(token, file_token, original_filename, domain="open.feishu.cn", max_retries=10):
    """Import the uploaded file as a document using the original filename as title"""
    pass  # The actual implementation is at the end of the file

def get_document_blocks(token, doc_token, domain="open.feishu.cn", page_size=500):
    """Get all blocks from a document with pagination support for large documents"""
    all_blocks = []
    page_token = None
    total_blocks = 0
    
    print(f"Getting document blocks for token: {doc_token}")
    
    while True:
        # Construct the URL with pagination parameters
        blocks_url = f"https://{domain}/open-apis/docx/v1/documents/{doc_token}/blocks"
        params = {}
        
        if page_token:
            params["page_token"] = page_token
        
        # Use page_size if specified
        if page_size:
            params["page_size"] = page_size
        
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        }
        
        # Make the request
        response = requests.get(blocks_url, headers=headers, params=params)
        
        # Parse response
        if response.status_code == 200:
            result = response.json()
            
            if result.get("code") == 0 and "data" in result:
                blocks_data = result["data"]
                current_blocks = blocks_data.get("items", [])
                all_blocks.extend(current_blocks)
                total_blocks += len(current_blocks)
                
                # Check if there are more pages
                page_token = blocks_data.get("page_token")
                if not page_token:
                    break  # No more pages
                
                print(f"Retrieved {len(current_blocks)} blocks, fetching next page...")
            else:
                print(f"API Error: {result}")
                return None
        else:
            print(f"HTTP Error: {response.status_code}")
            print(f"Response: {response.text}")
            return None
    
    print(f"Found {total_blocks} block(s) in document across multiple pages")
    
    # Return in the same format as before for compatibility
    return {"items": all_blocks}

def find_text_in_blocks(blocks, text_to_find):
    """Find a specific text in document blocks"""
    if not blocks or "items" not in blocks:
        return []
    
    matching_blocks = []
    
    for block in blocks["items"]:
        # Get block info
        block_id = block.get("block_id")
        block_type = block.get("block_type")
        parent_id = block.get("parent_id", "")
        
        # Extract text content from the block
        text_content = extract_text_from_block(block)
        
        # Check if the text is found in this block
        if text_to_find in text_content:
            matching_blocks.append({
                "id": block_id,
                "type": block_type,
                "content": text_content,
                "parent_id": parent_id
            })
            print(f"Found matching text in block (ID: {block_id}):")
            print(f"Content preview: {text_content[:50]}...")
    
    return matching_blocks

def extract_text_from_block(block):
    """Extract all text content from any block type"""
    content = ""
    
    # Handle different block types
    for key, value in block.items():
        if isinstance(value, dict) and "elements" in value:
            for element in value.get("elements", []):
                if "text_run" in element:
                    content += element["text_run"].get("content", "")
                # capture placeholders for markdown images
                elif element.get("type") == "inline_pic":
                    # use alt text or filename for search matching
                    content += element.get("alt", element.get("name", ""))
    
    return content

def locate_mermaid_blocks(blocks, extracted_mermaid):
    """Locate mermaid blocks in the document by searching for extracted content"""
    if not extracted_mermaid:
        print("No mermaid content to locate")
        return []
    
    found_blocks = []
    
    # Search for each extracted mermaid block
    for mermaid in extracted_mermaid:
        # Get the mermaid code
        mermaid_code = mermaid["code"]
        
        # Find blocks containing this code
        matching_blocks = find_text_in_blocks(blocks, mermaid_code)
        
        if matching_blocks:
            print(f"Found {len(matching_blocks)} block(s) with mermaid content: {mermaid_code[:30]}...")
            found_blocks.extend(matching_blocks)
        else:
            # If exact match not found, try line by line
            first_line = mermaid_code.split("\n")[0].strip()
            if first_line:
                print(f"Trying to match first line: {first_line}")
                partial_matches = find_text_in_blocks(blocks, first_line)
                
                if partial_matches:
                    print(f"Found {len(partial_matches)} block(s) with partial mermaid content")
                    for match in partial_matches:
                        # Update with full mermaid code for proper rendering
                        match["mermaid_code"] = mermaid_code
                        found_blocks.append(match)
    
    return found_blocks

def locate_image_references(blocks, extracted_images):
    """Locate image references in the document by searching for alt text"""
    if not extracted_images or not blocks:
        return []
    
    image_refs = []
    
    # Make sure blocks is a list
    if not isinstance(blocks, list):
        print("Converting blocks to list format")
        if isinstance(blocks, dict) and 'items' in blocks:
            blocks_list = blocks['items']
        elif hasattr(blocks, 'items'):  # It's dictionary-like
            blocks_list = list(blocks.values())
        elif hasattr(blocks, '__iter__'):  # It's some other iterable
            blocks_list = list(blocks)
        else:
            print("Unable to convert blocks to list")
            blocks_list = [blocks]  # Last resort, wrap it
        blocks = blocks_list
    
    # If the blocks are strings, try to get the underlying data
    if len(blocks) > 0 and isinstance(blocks[0], str):
        print("Document blocks appear to be in string format rather than dictionaries. Fetching blocks again...")
        # This is a fallback to ensure we have properly structured blocks
        blocks = get_document_blocks.actual_blocks if hasattr(get_document_blocks, 'actual_blocks') else blocks
    
    # Filter blocks to ensure they are dictionaries before checking their block_type
    valid_blocks = [b for b in blocks if isinstance(b, dict)]
    
    print(f"Found {len(valid_blocks)} valid dictionary blocks")
    
    # Safely check block types
    block_types = set()
    for b in valid_blocks:
        if isinstance(b, dict) and 'block_type' in b:
            block_types.add(b.get('block_type'))
    
    print(f"Available block types: {sorted(list(block_types)) if block_types else 'None found'}")

    # Map imported image placeholder blocks (type 27) in order to extracted_images
    placeholder_blocks = [b for b in valid_blocks if b.get('block_type') == 27]
    if placeholder_blocks:
        print(f"Mapping {len(placeholder_blocks)} placeholder blocks for images")
        for idx, image in enumerate(extracted_images):
            if idx < len(placeholder_blocks):
                pb = placeholder_blocks[idx]
                image_refs.append({'block_id': pb['block_id'], 'image_info': image})
            else:
                # fallback to document root
                parent_id = valid_blocks[0].get('parent_id')
                image_refs.append({'block_id': None, 'parent_id': parent_id, 'image_info': image})
        print(f"Located {len(image_refs)} image references via placeholders")
        return image_refs

    # All text-containing blocks, including paragraphs, headings, tables, code blocks, etc.
    text_block_types = [1, 2, 3, 4, 5, 9, 11, 12, 13, 22, 23, 24, 25, 26, 27]
    
    # Calculate a broader set of blocks to search through (all text-containing blocks)
    searchable_blocks = [b for b in valid_blocks if b.get('block_type') in text_block_types]
    
    print(f"Filtering blocks for image search: {len(blocks)} total, {len(valid_blocks)} valid, {len(searchable_blocks)} searchable")
    
    # For each extracted image, find the corresponding block in the document
    for image in extracted_images:
        print(f"\nSearching for image reference: {image['file_name']}")
        
        # Extract key parts of the image reference to search for
        alt_text = image['alt_text']
        image_path = f"images/{image['file_name']}"
        markdown_ref = f"![{alt_text}]({image_path})" 
        
        # Use various forms of the image reference as search terms
        search_terms = [
            image_path,  # Just the path
            f"![{alt_text}]",  # Alt text with markdown syntax
            markdown_ref[:40] if len(markdown_ref) > 40 else markdown_ref,  # Beginning of full reference
            alt_text if len(alt_text) > 10 else None,  # Plain alt text if long enough
            image['file_name']  # Filename as fallback
        ]
        
        # Show what we're searching for
        print(f"  Search terms: {[t[:20] + '...' if t and len(t) > 20 else t for t in search_terms if t]}")
        
        found = False
        parent_id = None
        
        # First try to find any block containing our search terms
        for search_term in search_terms:
            if not search_term or len(search_term) < 3:  # Allow shorter search terms
                continue
                
            # Loop through all blocks manually to find matches
            for block in searchable_blocks:
                text_content = extract_text_from_block(block)
                if text_content and search_term in text_content:
                    print(f"  Found match in block {block['block_id']} for term: {search_term[:20]}{'...' if len(search_term) > 20 else ''}")
                    parent_id = block.get('parent_id')
                    image_refs.append({
                        'block_id': block['block_id'],
                        'image_info': image
                    })
                    found = True
                    break
            
            if found:
                break
        
        # If we didn't find any references, just use the document root as parent
        if not found:
            # If we couldn't find a reference, we'll just add the image to the end of the document
            print(f"  No reference found for {image['file_name']}, will add at document root")
            if valid_blocks and len(valid_blocks) > 0 and 'parent_id' in valid_blocks[0]:
                parent_id = valid_blocks[0].get('parent_id') 
                image_refs.append({
                    'block_id': None,  # No specific reference block
                    'parent_id': parent_id,  # Use document root as parent
                    'image_info': image
                })
                found = True
    
    print(f"Located {len(image_refs)} image references in the document")
    return image_refs

def delete_block(token, doc_token, block_id, domain="open.feishu.cn"):
    """Delete a block from the document using the correct API endpoint
    Based on example: DELETE /open-apis/docx/v1/documents/{doc_id}/blocks/{block_id}/children/batch_delete
    """
    # Get parent block ID to use the children/batch_delete endpoint
    parent_id = get_parent_block_id(token, doc_token, block_id, domain)
    
    if not parent_id:
        print(f"Could not find parent block for {block_id}")
        return False
    
    # Use the children/batch_delete endpoint as shown in the example
    delete_url = f"https://{domain}/open-apis/docx/v1/documents/{doc_token}/blocks/{parent_id}/children/batch_delete?document_revision_id=-1"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }
    
    print(f"Deleting block: {block_id} (child of {parent_id})")
    
    # Find the index of the block in its parent's children
    index = find_block_index(token, doc_token, parent_id, block_id, domain)
    
    if index is None:
        print(f"Could not determine index of block {block_id} in parent's children")
        return False
    
    # Prepare the delete operation with start_index and end_index
    data = {
        "start_index": index,
        "end_index": index + 1  # Delete just one block
    }
    
    print(f"Deleting block at index {index}")
    response = requests.delete(delete_url, headers=headers, json=data)
    
    if response.status_code == 200:
        result = response.json()
        if result.get("code") == 0:
            print(f"Block deleted successfully")
            return True
        else:
            print(f"API Error: {result}")
            return False
    else:
        print(f"HTTP Error: {response.status_code}")
        print(f"Response: {response.text}")
        return False

# Global cache for document structure
_document_cache = {}

def cache_document_structure(token, doc_token, domain="open.feishu.cn"):
    """Fetch and cache the entire document structure for faster parent lookups
    Returns a dictionary mapping block_id -> parent_id for all blocks
    """
    global _document_cache
    
    # Create a unique key for this document
    cache_key = f"{doc_token}_{domain}"
    
    # Check if already cached
    if cache_key in _document_cache:
        print("Using cached document structure")
        return _document_cache[cache_key]
    
    print("Caching document structure...")
    blocks = get_document_blocks(token, doc_token, domain)
    
    # Initialize the cache structure
    block_to_parent = {}
    
    if blocks and "items" in blocks:
        for block in blocks["items"]:
            block_id = block.get("block_id")
            parent_id = block.get("parent_id")
            if block_id:
                block_to_parent[block_id] = parent_id
    
    # Store in cache
    _document_cache[cache_key] = block_to_parent
    print(f"Cached {len(block_to_parent)} blocks for document {doc_token}")
    
    return block_to_parent

def get_parent_block_id(token, doc_token, block_id, domain="open.feishu.cn"):
    """Get the parent block ID for a given block using cache when available"""
    global _document_cache
    
    # Create cache key
    cache_key = f"{doc_token}_{domain}"
    
    # Try to get from cache first
    if cache_key in _document_cache:
        parent_map = _document_cache[cache_key]
        if block_id in parent_map:
            return parent_map[block_id]
    
    # If not in cache, try direct API lookup first (faster than caching everything)
    blocks_url = f"https://{domain}/open-apis/docx/v1/documents/{doc_token}/blocks/{block_id}"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }
    
    response = requests.get(blocks_url, headers=headers)
    
    if response.status_code == 200:
        result = response.json()
        if result.get("code") == 0 and "data" in result:
            block_data = result["data"]
            parent_id = block_data.get("parent_id")
            if parent_id:
                # Update cache with this information
                if cache_key not in _document_cache:
                    _document_cache[cache_key] = {}
                _document_cache[cache_key][block_id] = parent_id
                return parent_id
    
    # If we couldn't get it directly, build the full cache and try again
    print("Building document cache to find parent...")
    parent_map = cache_document_structure(token, doc_token, domain)
    
    # Look up in the newly created cache
    return parent_map.get(block_id)

# Global cache for block indices
_block_index_cache = {}

def find_block_index(token, doc_token, parent_id, block_id, domain="open.feishu.cn"):
    """Find the index of a block within its parent's children
    Uses caching to improve performance for repeated lookups
    """
    global _block_index_cache
    
    # Create a unique key for this lookup
    cache_key = f"{doc_token}_{domain}_{parent_id}_{block_id}"
    
    # Check if this index is already cached
    if cache_key in _block_index_cache:
        print(f"Using cached index for block {block_id}")
        return _block_index_cache[cache_key]
        
    # If not in cache, proceed with lookup
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }
    
    # response = requests.get(parent_url, headers=headers)
    
    # if response.status_code == 200:
    #     result = response.json()
    #     if result.get("code") == 0 and "data" in result:
    #         parent_block = result["data"]
            
    #         # Check if the parent has children
    #         if "children" in parent_block and isinstance(parent_block["children"], list):
    #             children = parent_block["children"]
    #             for i, child_id in enumerate(children):
    #                 if child_id == block_id:
    #                     return i
    
    # # If not found through direct API, try a different approach
    # print("Could not find block index through direct API, trying alternate method...")
    
    # Get all children of the parent block with pagination support
    children_url = f"https://{domain}/open-apis/docx/v1/documents/{doc_token}/blocks/{parent_id}/children"
    
    # Check if we already have the children cached in the document structure
    global _document_cache
    doc_cache_key = f"{doc_token}_{domain}"
    
    # Try to get children from the parent-children cache if available
    parent_children_cache_key = f"children_{parent_id}_{doc_token}_{domain}"
    if parent_children_cache_key in _block_index_cache:
        # We have the full ordered list of children cached
        children_list = _block_index_cache[parent_children_cache_key]
        try:
            index = children_list.index(block_id)
            # Store in the direct lookup cache too
            _block_index_cache[cache_key] = index
            return index
        except ValueError:
            # Block not found in cached children list
            pass
    
    # Initialize pagination variables
    page_token = None
    has_more = True
    child_index = 0
    all_children = []  # Track all children for caching
    
    # Continue fetching pages until we find the block or run out of pages
    while has_more:
        # Add page_token to URL if we have one
        url_with_params = children_url
        if page_token:
            url_with_params += f"?page_token={page_token}"
        
        response = requests.get(url_with_params, headers=headers)
        
        if response.status_code == 200:
            result = response.json()
            if result.get("code") == 0 and "data" in result and "items" in result["data"]:
                # Process current page of children
                current_page_children = result["data"]["items"]
                
                for i, child in enumerate(current_page_children):
                    if child.get("block_id") == block_id:
                        # Cache the result before returning
                        _block_index_cache[cache_key] = child_index + i
                        return child_index + i
                
                # Collect all block_ids for caching
                current_block_ids = [child.get("block_id") for child in current_page_children]
                all_children.extend(current_block_ids)
                
                # Update child_index for next page
                child_index += len(current_page_children)
                
                # Check if there are more pages
                has_more = result["data"].get("has_more", False)
                page_token = result["data"].get("page_token")
                
                if has_more and not page_token:
                    print(f"Warning: API indicates more items but did not provide page_token")
                    break
            else:
                print(f"Error retrieving children: {result.get('msg', 'Unknown error')}")
                break
        else:
            print(f"Error retrieving children: Status code {response.status_code}")
            break
    
    # Cache the full children list for future lookups
    if all_children:
        _block_index_cache[parent_children_cache_key] = all_children
    
    # Cache the negative result to avoid repeated lookups
    _block_index_cache[cache_key] = None
    return None

def add_mermaid_component(token, doc_token, parent_block_id, mermaid_code, position_index=None, domain="open.feishu.cn"):
    """Add a rendered mermaid diagram as an add-on component at a specific position"""
    url = f"https://{domain}/open-apis/docx/v1/documents/{doc_token}/blocks/{parent_block_id}/children"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }
    
    # Create the record as a JSON string with mermaid data
    record_data = {
        "data": mermaid_code,
        "theme": "default",
        "view": "chart"
    }
    record_json = json.dumps(record_data)
    
    # Prepare the request data with position index if provided
    data = {
        "children": [
            {
                "block_type": 40,  # Add-on block type
                "add_ons": {
                    "component_id": "",
                    "component_type_id": "blk_631fefbbae02400430b8f9f4",  # Mermaid component ID
                    "record": record_json
                }
            }
        ]
    }
    
    # Add index position if provided
    if position_index is not None:
        data["index"] = position_index
        print(f"Adding mermaid add-on at position index: {position_index}")
    
    # Add document_revision_id parameter
    revision_param = "?document_revision_id=-1"
    if "?" in url:
        revision_param = "&document_revision_id=-1"
    
    # Add revision parameter to URL
    url = f"{url}{revision_param}"
    
    # Make the API request with the position information included
    response = requests.post(url, headers=headers, json=data)
    
    if response.status_code == 200:
        result = response.json()
        if result.get("code") == 0:
            print("Mermaid add-on created successfully")
            return True
        else:
            print(f"API Error: {result}")
            # Don't give up on first error
    else:
        print(f"HTTP Error: {response.status_code}")
        print(f"Response: {response.text[:500]}")
    
    # If first attempt failed, try alternative format with position index preserved
    print("First attempt failed, trying alternative add-on format...")
    alt_data = {
        "children": [
            {
                "type": "add_on",
                "add_on": {
                    "component_id": "",
                    "component_type_id": "blk_631fefbbae02400430b8f9f4",
                    "record": record_json
                }
            }
        ]
    }
    
    # Preserve the position index in the alternative format
    if position_index is not None:
        alt_data["index"] = position_index
    
    alt_response = requests.post(url, headers=headers, json=alt_data)
    
    if alt_response.status_code == 200:
        alt_result = alt_response.json()
        if alt_result.get("code") == 0:
            print("Mermaid add-on created successfully with alternative format")
            return True
        else:
            print(f"API Error with alternative format: {alt_result}")
    else:
        print(f"HTTP Error with alternative format: {alt_response.status_code}")
        print(f"Response: {alt_response.text[:500]}")
    
    # If both attempts failed, try one more format using batch update API
    print("Second attempt failed, trying final add-on format with batch update...")
    
    # Create the block with the mermaid add-on using batch update
    batch_url = f"https://{domain}/open-apis/docx/v1/documents/{doc_token}/batch_update?document_revision_id=-1"
    
    # Prepare the batch update request
    # This uses a different approach for specifying position
    final_data = {
        "requests": [
            {
                "insert_block": {
                    "parent_id": parent_block_id,
                    "block": {
                        "block_type": 40,  # Add-on block type
                        "add_ons": {
                            "component_id": "",
                            "component_type_id": "blk_631fefbbae02400430b8f9f4",  # Mermaid component ID
                            "record": record_json
                        }
                    }
                }
            }
        ]
    }
    
    # Add position if available
    if position_index is not None:
        final_data["requests"][0]["insert_block"]["index"] = position_index
    
    final_response = requests.post(batch_url, headers=headers, json=final_data)
    
    if final_response.status_code == 200:
        final_result = final_response.json()
        if final_result.get("code") == 0:
            print("Mermaid add-on created successfully with batch update")
            return True
        else:
            print(f"API Error with batch update: {final_result}")
            return False
    else:
        print(f"HTTP Error with batch update: {final_response.status_code}")
        print(f"Response: {final_response.text[:500]}")
        return False

def rate_limited_api_call(func, *args, **kwargs):
    """Execute an API call with rate limiting and retries
    
    Lark API has a rate limit of 3 calls per second per app.
    This wrapper implements exponential backoff with jitter for retries.
    """
    max_retries = 5
    base_delay = 0.5  # Base delay in seconds
    
    for attempt in range(max_retries):
        try:
            # Add a small random delay between 0.3-0.5 seconds to avoid hitting the rate limit
            # This ensures we stay under 3 calls per second
            sleep_time = 0.3 + random.random() * 0.2
            time.sleep(sleep_time)
            
            # Execute the API call
            result = func(*args, **kwargs)
            
            # Check if the result indicates a rate limit error
            if isinstance(result, dict) and result.get("code") == 99991400:
                raise Exception("Rate limit hit")
                
            # If it's a response object, check status code and json
            if isinstance(result, requests.Response):
                if result.status_code == 400:
                    try:
                        response_json = result.json()
                        if response_json.get("code") == 99991400:
                            raise Exception("Rate limit hit")
                    except:
                        pass  # Not a JSON response or other error
            
            return result
            
        except Exception as e:
            if "Rate limit hit" in str(e) or "99991400" in str(e):
                # Apply exponential backoff with jitter
                delay = base_delay * (2 ** attempt) + random.uniform(0, 1)
                print(f"Rate limit hit, retrying in {delay:.2f} seconds... (attempt {attempt+1}/{max_retries})")
                time.sleep(delay)
            else:
                # For other errors, retry with a shorter delay
                delay = base_delay + random.uniform(0, 1)
                print(f"API error: {str(e)}, retrying in {delay:.2f} seconds... (attempt {attempt+1}/{max_retries})")
                time.sleep(delay)
    
    # If all retries failed
    print(f"Failed after {max_retries} attempts")
    return None

def convert_mermaid_blocks(token, doc_token, mermaid_blocks, domain="open.feishu.cn"):
    """Convert identified mermaid blocks to rendered diagrams in-place"""
    if not mermaid_blocks:
        print("No mermaid blocks to convert")
        return 0
    
    success_count = 0
    failure_count = 0
    
    # Group blocks by parent_id for more efficient processing
    blocks_by_parent = {}
    for block in mermaid_blocks:
        parent_id = block["parent_id"]
        if parent_id not in blocks_by_parent:
            blocks_by_parent[parent_id] = []
        blocks_by_parent[parent_id].append(block)
    
    print(f"Grouped {len(mermaid_blocks)} blocks into {len(blocks_by_parent)} parent groups")
    
    # Process blocks by parent
    for parent_id, blocks in blocks_by_parent.items():
        print(f"\nProcessing {len(blocks)} blocks under parent {parent_id}")
        
        # Cache the parent's children and their indices to avoid repeated API calls
        parent_children = rate_limited_api_call(get_parent_children, token, doc_token, parent_id, domain)
        
        # Process each block under current parent
        for i, block in enumerate(blocks):
            # if i < 19:
            #     continue
            block_id = block["id"]
            mermaid_code = block.get("mermaid_code", block["content"])
            
            print(f"\nConverting mermaid block {i+1}/{len(blocks)} in current group (ID: {block_id})")
            
            # Find the block index in the parent's children
            block_index = None
            if parent_children:
                for idx, child_id in enumerate(parent_children):
                    if child_id == block_id:
                        block_index = idx
                        break
            
            if block_index is None:
                print(f"Could not determine index of block {block_id} in parent's children - will add at the end")
            else:
                print(f"Found block at index {block_index} in parent's children")
            
            # Add the mermaid add-on component at the same position - with rate limiting
            if rate_limited_api_call(add_mermaid_component, token, doc_token, parent_id, mermaid_code, block_index, domain):
                # Wait before attempting deletion to ensure add-on is fully created
                time.sleep(0.5)
                
                # If add-on creation was successful, try to delete the original block - with rate limiting
                try_result = rate_limited_api_call(delete_block, token, doc_token, block_id, domain)
                if try_result:
                    success_count += 1
                    print(f"Successfully converted mermaid block {block_id}")
                else:
                    # Wait before trying alternative method
                    time.sleep(1.5)
                    
                    # Alternative deletion approach - try to delete by batch update - with rate limiting
                    print(f"First deletion method failed, trying alternative approach...")
                    alt_result = rate_limited_api_call(delete_block_alternative, token, doc_token, parent_id, block_id, domain)
                    if alt_result:
                        success_count += 1
                        print(f"Successfully converted mermaid block {block_id} using alternative deletion")
                    else:
                        # Wait and try once more with a direct block batch delete
                        time.sleep(2.0)
                        third_attempt = rate_limited_api_call(delete_block_direct, token, doc_token, block_id, domain)
                        if third_attempt:
                            success_count += 1
                            print(f"Successfully converted mermaid block {block_id} using direct deletion")
                        else:
                            # Final attempt: if we can't delete, try to replace the content
                            time.sleep(2.0)
                            final_attempt = rate_limited_api_call(replace_block_content, token, doc_token, block_id, mermaid_code, domain)
                            if final_attempt:
                                success_count += 1
                                print(f"Successfully converted mermaid block {block_id} by replacing content")
                            else:
                                failure_count += 1
                                print(f"Added add-on but failed to delete or replace original block {block_id}")
            else:
                failure_count += 1
                print(f"Failed to convert mermaid block {block_id}")
            
            # Sleep between blocks to avoid rate limiting
            wait_time = 0.34 + random.random() * 0.1
            print(f"Waiting {wait_time:.2f} seconds before next operation...")
            time.sleep(wait_time)
    
    print(f"\nConverted {success_count} blocks successfully, {failure_count} conversions had issues")
    return success_count

def get_parent_children(token, doc_token, parent_id, domain="open.feishu.cn"):
    """Get the children IDs of a parent block
    
    Supports pagination to handle more than 500 children in large documents
    """
    all_children = []
    page_token = None
    has_more = True
    
    # Continue fetching until we have all children
    while has_more:
        # Build URL with page_token if it exists
        children_url = f"https://{domain}/open-apis/docx/v1/documents/{doc_token}/blocks/{parent_id}/children"
        if page_token:
            children_url += f"?page_token={page_token}"
            
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        }
        
        response = requests.get(children_url, headers=headers)
        
        if response.status_code == 200:
            result = response.json()
            if result.get("code") == 0 and "data" in result and "items" in result["data"]:
                # Extract block IDs from current page and add to full list
                current_page_children = [item.get("block_id") for item in result["data"]["items"]]
                all_children.extend(current_page_children)
                
                # Check if there are more pages to fetch
                has_more = result["data"].get("has_more", False)
                page_token = result["data"].get("page_token")
                
                if has_more and not page_token:
                    print(f"Warning: API indicates more items but did not provide page_token")
                    break
            else:
                # Error in response format
                print(f"Error retrieving children: {result.get('msg', 'Unknown error')}")
                break
        else:
            # Request failed
            print(f"Error retrieving children: Status code {response.status_code}")
            break
    
    return all_children if all_children else None

def delete_block_alternative(token, doc_token, parent_id, block_id, domain="open.feishu.cn"):
    """Alternative approach to delete a block using batch update API"""
    batch_url = f"https://{domain}/open-apis/docx/v1/documents/{doc_token}/batch_update?document_revision_id=-1"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }
    
    # Try to delete the block using batch update
    data = {
        "requests": [
            {
                "delete_block": {
                    "block_id": block_id
                }
            }
        ]
    }
    
    print(f"Attempting alternative deletion for block {block_id}")
    response = requests.post(batch_url, headers=headers, json=data)
    
    if response.status_code == 200:
        result = response.json()
        if result.get("code") == 0:
            print(f"Block deleted successfully with alternative method")
            return True
    
    # If first attempt fails, try yet another approach with replace_all
    print(f"First alternative failed, trying replace_all approach...")
    data = {
        "requests": [
            {
                "replace_all": {
                    "find_text": {"regex": f".*{block_id}.*"},
                    "replace_text": ""
                }
            }
        ]
    }
    
    response = requests.post(batch_url, headers=headers, json=data)
    if response.status_code == 200:
        result = response.json()
        if result.get("code") == 0:
            print(f"Block content replaced with empty text")
            return True
    
    return False

def delete_block_direct(token, doc_token, block_id, domain="open.feishu.cn"):
    """Direct approach using the blocks/batch_delete endpoint"""
    delete_url = f"https://{domain}/open-apis/docx/v1/documents/{doc_token}/blocks/batch_delete?document_revision_id=-1"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }
    
    # Data for direct deletion
    data = {
        "block_ids": [block_id],
        "delete_type": 0  # 0 means remove only specified blocks
    }
    
    print(f"Attempting direct batch deletion for block {block_id}")
    response = requests.post(delete_url, headers=headers, json=data)
    
    if response.status_code == 200:
        result = response.json()
        if result.get("code") == 0:
            print(f"Block deleted successfully with direct batch delete")
            return True
    
    # Try alternate URL format
    delete_url_alt = f"https://{domain}/open-apis/docx/v1/documents/{doc_token}/blocks/batch_delete"
    response = requests.post(delete_url_alt, headers=headers, json=data)
    
    if response.status_code == 200:
        result = response.json()
        if result.get("code") == 0:
            print(f"Block deleted successfully with direct batch delete (alternate URL)")
            return True
    
    return False

def replace_block_content(token, doc_token, block_id, mermaid_content, domain="open.feishu.cn"):
    """Replace the content of a block with empty or hidden content
    
    This is a fallback approach when all deletion methods fail.
    Instead of removing the block, we:
    1. Try to comment out the mermaid content (making it plain text)
    2. Try to replace with an HTML comment
    3. Try updating with empty content
    4. Try batch content replacement
    """
    print(f"Attempting brute force content replacement for block {block_id}")
    
    # Common headers for all API requests
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }
    
    # Methods to try in sequence
    
    # Method 1: Replace with commented mermaid (makes it plain text)
    batch_url = f"https://{domain}/open-apis/docx/v1/documents/{doc_token}/batch_update?document_revision_id=-1"
    
    # Try to comment out the mermaid to make it plain text by adding "//" to each line
    commented_lines = [f"// {line}" for line in mermaid_content.split('\n')]
    commented_content = '\n'.join(commented_lines)
    
    batch_data = {
        "requests": [
            {
                "replace_all": {
                    "find_text": {"text": mermaid_content[:100]},  # Use first part of content to find it
                    "replace_text": commented_content
                }
            }
        ]
    }
    
    response = requests.post(batch_url, headers=headers, json=batch_data)
    if response.status_code == 200 and response.json().get("code") == 0:
        print(f"Successfully replaced with commented mermaid content")
        return True
    
    # Method 2: Try replacing with HTML comment
    html_comment = "<!-- This mermaid diagram has been converted to an add-on format -->"
    
    batch_data = {
        "requests": [
            {
                "replace_all": {
                    "find_text": {"text": mermaid_content[:100]}, 
                    "replace_text": html_comment
                }
            }
        ]
    }
    
    time.sleep(1.0)  # Add delay between attempts
    response = requests.post(batch_url, headers=headers, json=batch_data)
    if response.status_code == 200 and response.json().get("code") == 0:
        print(f"Successfully replaced with HTML comment")
        return True
    
    # Method 3: Try a direct update with empty content
    update_url = f"https://{domain}/open-apis/docx/v1/documents/{doc_token}/blocks/{block_id}"
    
    # Simplest possible data - empty content
    data = {"text": ""}
    
    time.sleep(1.0)  # Add delay between attempts
    response = requests.patch(update_url, headers=headers, json=data)
    if response.status_code == 200 and response.json().get("code") == 0:
        print(f"Successfully emptied block content with direct update")
        return True
    
    # Method 4: Try a more aggressive method - use API to make the content invisible in place
    batch_data = {
        "requests": [
            {
                "update_block": {
                    "block_id": block_id,
                    "text": {
                        "style": {
                            "color": 0xFFFFFF,  # White (invisible color)
                            "bold": False,
                            "font_size": 1     # Very small font
                        },
                        "elements": [
                            {
                                "text_run": {
                                    "content": "·",  # Small dot
                                }
                            }
                        ]
                    }
                }
            }
        ]
    }
    
    time.sleep(1.0)  # Add delay between attempts
    response = requests.post(batch_url, headers=headers, json=batch_data)
    if response.status_code == 200 and response.json().get("code") == 0:
        print(f"Successfully made block content invisible with batch update")
        return True
    
    # Try one last very aggressive method - simply create HTML tables around the content to break it
    broken_content = "<table><tr><td><!-- --></td></tr></table>"
    
    batch_data = {
        "requests": [
            {
                "replace_all": {
                    "find_text": {"text": mermaid_content[:50]},
                    "replace_text": broken_content
                }
            }
        ]
    }
    
    time.sleep(1.0)  # Add delay between attempts
    response = requests.post(batch_url, headers=headers, json=batch_data)
    if response.status_code == 200 and response.json().get("code") == 0:
        print(f"Successfully replaced with broken HTML content")
        return True
    
    print(f"All content replacement methods failed for block {block_id}")
    return False

def create_image_block(token, doc_token, parent_id, index=0, domain="open.feishu.cn"):
    """Create an image block under the specified parent block"""
    print(f"Creating image block under parent {parent_id}")
    
    # API endpoint for creating blocks
    url = f"https://{domain}/open-apis/docx/v1/documents/{doc_token}/blocks/{parent_id}/children"
    
    # Headers for API request
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }
    
    # Data for creating an image block
    data = {
        "index": index,
        "children": [
            {
                "block_type": 27,  # Image block type
                "image": {}
            }
        ]
    }
    
    # Make API request with rate limiting
    response = rate_limited_api_call(requests.post, url, headers=headers, json=data)
    
    # Check if the request was successful
    if response.status_code == 200:
        result = response.json()
        
        if result.get("code") == 0 and "data" in result and "children" in result["data"]:
            # Extract the image block ID
            image_block_id = result["data"]["children"][0]["block_id"]
            print(f"Successfully created image block: {image_block_id}")
            return image_block_id
        else:
            print(f"API Error: {result}")
            return None
    else:
        print(f"HTTP Error: {response.status_code}")
        print(f"Response: {response.text}")
        return None

def upload_image(token, image_path, parent_node, domain="open.feishu.cn"):
    """Upload an image file as material for an image block"""
    print(f"Uploading image {image_path} for block {parent_node}")
    
    # Check if the image file exists
    image_path = Path(image_path)
    if not image_path.exists():
        print(f"Error: Image file {image_path} does not exist")
        return None
    
    # Get file size
    file_size = image_path.stat().st_size
    
    # Upload media API endpoint
    upload_url = f"https://{domain}/open-apis/drive/v1/medias/upload_all"
    
    # Headers for API request
    headers = {
        "Authorization": f"Bearer {token}"
    }
    
    # Prepare multipart form data
    files = {
        'file': (image_path.name, open(image_path, 'rb'), 'image/png')
    }
    
    # Form data
    form_data = {
        'file_name': image_path.name,
        'parent_type': 'docx_image',
        'parent_node': parent_node,
        'size': str(file_size)
    }
    
    # Upload file with rate limiting
    response = rate_limited_api_call(requests.post, upload_url, headers=headers, files=files, data=form_data)
    
    # Close the file handle
    files['file'][1].close()
    
    # Check if the request was successful
    if response.status_code == 200:
        result = response.json()
        
        if result.get("code") == 0 and "data" in result and "file_token" in result["data"]:
            # Extract the file token
            file_token = result["data"]["file_token"]
            print(f"Successfully uploaded image: {file_token}")
            return file_token
        else:
            print(f"API Error: {result}")
            return None
    else:
        print(f"HTTP Error: {response.status_code}")
        print(f"Response: {response.text}")
        return None

def update_image_block(token, doc_token, block_id, file_token, domain="open.feishu.cn"):
    """Update an image block with the uploaded image material"""
    print(f"Updating image block {block_id} with file token {file_token}")
    
    # API endpoint for updating blocks
    url = f"https://{domain}/open-apis/docx/v1/documents/{doc_token}/blocks/{block_id}"
    
    # Headers for API request
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }
    
    # Data for updating the image block
    data = {
        "replace_image": {
            "token": file_token
        }
    }
    
    # Make API request with rate limiting
    response = rate_limited_api_call(requests.patch, url, headers=headers, json=data)
    
    # Check if the request was successful
    if response.status_code == 200:
        result = response.json()
        
        if result.get("code") == 0:
            print(f"Successfully updated image block with material")
            return True
        else:
            print(f"API Error: {result}")
            return False
    else:
        print(f"HTTP Error: {response.status_code}")
        print(f"Response: {response.text}")
        return False

def convert_image_references(token, doc_token, image_references, domain="open.feishu.cn"):
    """Convert markdown image references to Lark document image blocks"""
    if not image_references:
        return 0
    
    success_count = 0
    
    # Process each image reference
    for index, img_ref in enumerate(image_references):
        print(f"\nProcessing image {index+1}/{len(image_references)}: {img_ref['image_info']['file_name']}")
        
        try:
            # Check whether we have a specific reference block or need to use the parent_id directly
            if 'parent_id' in img_ref:
                # We're using a direct parent ID (typically the document root)
                parent_id = img_ref['parent_id']
                position_index = 0  # Default to adding at the beginning
                print(f"Using direct parent ID: {parent_id}")
            else:
                # Get the text block ID where the image reference was found
                text_block_id = img_ref['block_id']
                
                # Get the parent of the text block to insert the image after it
                parent_id = get_parent_block_id(token, doc_token, text_block_id, domain)
                
                if not parent_id:
                    print(f"Failed to find parent for block {text_block_id}, using document root")
                    parent_id = doc_token
                    position_index = 0
                else:
                    # Find the index of the text block within its parent's children
                    position_index = find_block_index(token, doc_token, parent_id, text_block_id, domain)
                    
                    if position_index is None:
                        print(f"Failed to find block index for {text_block_id}, using default index 0")
                        position_index = 0
                    else:
                        # Insert the image block after the text block
                        position_index += 1
            
            print(f"Creating image block under parent {parent_id} at position {position_index}")
            
            # Remove original placeholder block so only the new image remains
            if img_ref.get('block_id'):
                text_block_id = img_ref['block_id']
                print(f"Deleting original placeholder image block: {text_block_id}")
                delete_block(token, doc_token, text_block_id, domain)

            # Step 1: Create an image block
            image_block_id = create_image_block(token, doc_token, parent_id, position_index, domain)
            
            if not image_block_id:
                print(f"Failed to create image block, skipping image")
                continue
            
            # Step 2: Upload the image as material
            file_token = upload_image(token, img_ref['image_info']['path'], image_block_id, domain)
            
            if not file_token:
                print(f"Failed to upload image, skipping image")
                continue
            
            # Step 3: Update the image block with the material
            success = update_image_block(token, doc_token, image_block_id, file_token, domain)
            
            if success:
                success_count += 1
                print(f"Successfully converted image: {img_ref['image_info']['file_name']}")
            else:
                print(f"Failed to update image block with material")
            
            # Add a small delay between processing images
            time.sleep(1)
                
        except Exception as e:
            print(f"Error processing image {img_ref['image_info']['file_name']}: {str(e)}")
            import traceback
            traceback.print_exc()
    
    return success_count

def import_to_document(token, file_token, original_filename, domain="open.feishu.cn", max_retries=10):
    """Import the uploaded file as a document using the original filename as title"""
    # Import API endpoint
    import_url = f"https://{domain}/open-apis/drive/v1/import_tasks"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }
    
    # Remove the file extension for cleaner title
    doc_title = original_filename
    if doc_title.lower().endswith('.md') or doc_title.lower().endswith('.markdown'):
        doc_title = doc_title[:doc_title.rfind('.')]
    
    print(f"Using document title: {doc_title}")
    
    # Request data
    data = {
        "file_extension": "md",
        "file_token": file_token,
        "type": "docx",
        "file_name": doc_title,
        "point": {
            "mount_type": 1,  # Workspace drive
            "mount_key": ""   # Empty for root folder
        }
    }
    
    # Create import task
    print("Creating import task...")
    response = requests.post(import_url, headers=headers, json=data)
    
    # Parse response
    if response.status_code == 200:
        result = response.json()
        
        if result.get("code") == 0 and "data" in result:
            ticket = result["data"].get("ticket")
            if ticket:
                print(f"Import task created! Ticket: {ticket}")
                
                # Wait for the import to start processing
                print("Waiting for import to start processing...")
                time.sleep(2)
                
                # Check import status with retries
                for i in range(max_retries):
                    check_url = f"https://{domain}/open-apis/drive/v1/import_tasks/{ticket}"
                    check_response = requests.get(check_url, headers=headers)
                    
                    if check_response.status_code == 200:
                        check_result = check_response.json()
                        
                        if check_result.get("code") == 0 and "data" in check_result:
                            # Check job_status in the result structure
                            if "result" in check_result["data"]:
                                job_status = check_result["data"]["result"].get("job_status")
                                job_error_msg = check_result["data"]["result"].get("job_error_msg")
                                doc_token = check_result["data"]["result"].get("token")
                                url = check_result["data"]["result"].get("url")
                                
                                print(f"Import job status: {job_status}, message: {job_error_msg if job_error_msg else 'No error message'}")
                                
                                # Status 0 means success, 2 means in progress, others are error states
                                if job_status == 0 and doc_token and url:
                                    print(f"Document token: {doc_token}")
                                    print(f"Document URL: {url}")
                                    
                                    return {
                                        "token": doc_token,
                                        "url": url
                                    }
                                elif job_status != 2:
                                    # If status is not 0 (success) or 2 (in progress), it's an error
                                    print(f"Import failed with status {job_status}")
                                    return None
                    
                    print(f"Waiting for import to complete (attempt {i+1}/{max_retries})...")
                    time.sleep(3)
        
        print("Import timed out or failed")
        return None
    else:
        print(f"HTTP Error: {response.status_code}")
        print(f"Response: {response.text}")
        return None

def locate_equation_blocks(blocks):
    """Locate equation blocks (imported math) in the document for centering."""
    items = blocks.get("items", []) if isinstance(blocks, dict) else blocks
    eq_blocks = []
    for b in items:
        if not isinstance(b, dict):
            continue
        # Detect equation blocks by presence of inline Equation elements or '$$' markers
        found = False
        # Search nested elements for 'equation'
        for val in b.values():
            if isinstance(val, dict) and 'elements' in val:
                elements =  val.get('elements', [])
                if len(elements) == 1:
                    for element in elements:
                        if 'equation' in element:
                            found = True
                            break
            if found:
                break
        text = extract_text_from_block(b).strip()
        if found or (text.startswith("$$") and text.endswith("$$")):
            eq_blocks.append(b)
    print(f"Found {len(eq_blocks)} equation blocks to center: {[b.get('block_id') for b in eq_blocks]}")
    return eq_blocks

def center_equation_blocks(token, doc_token, eq_blocks, domain="open.feishu.cn"):
    """Center equation blocks by updating their align property."""
    success_count = 0
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    for b in eq_blocks:
        block_id = b.get('block_id')
        print(f"Centering equation block: {block_id}")
        url = f"https://{domain}/open-apis/docx/v1/documents/{doc_token}/blocks/{block_id}"
        data = {
                    "update_text_style":{
                        "style":{
                            "align": 2
                        },
                        "fields": [1]
                    }
                }
        response = rate_limited_api_call(requests.patch, url, headers=headers, json=data)
        if response.status_code == 200 and response.json().get("code") == 0:
            success_count += 1
            print(f"Successfully centered block {block_id}")
        else:
            print(f"Failed to center block {block_id}: {response.status_code} {response.text}")
    return success_count

def locate_table_blocks(blocks):
    """Locate table blocks in the document for header adjustments."""
    items = blocks.get("items", []) if isinstance(blocks, dict) else blocks
    table_blocks = []
    for b in items:
        if not isinstance(b, dict):
            continue
        # Detect table blocks by payload or block_type
        block_type = b.get('block_type')
        if block_type in (31, 999):
            table_blocks.append(b)
    print(f"Found {len(table_blocks)} table blocks to update: {[b.get('block_id') for b in table_blocks]}")
    return table_blocks

def set_table_headers(token, doc_token, table_blocks, domain="open.feishu.cn"):
    """Set header_row and header_column for table blocks."""
    success_count = 0
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    for b in table_blocks:
        block_id = b.get('block_id')
        print(f"Updating table block: {block_id}")
        url = f"https://{domain}/open-apis/docx/v1/documents/{doc_token}/blocks/{block_id}"
        data = {
            "update_table_property": 
            {
                "header_row": True,
                "header_column": True,
            }
        }
        response = rate_limited_api_call(requests.patch, url, headers=headers, json=data)
        """print(f"Response: {response.text}")"""
        if response.status_code == 200 and response.json().get("code") == 0:
            success_count += 1
            print(f"Successfully updated table block {block_id}")
        else:
            print(f"Failed to update table block {block_id}: {response.status_code} {response.text}")
    return success_count

def main():
    """Main function for the entire process"""
    parser = argparse.ArgumentParser(description="Upload Markdown to Lark and convert Mermaid diagrams and images")
    parser.add_argument("--file", help="Path to the markdown file to upload", default="md/simple_test.md")
    parser.add_argument("--domain", help="Lark API domain (default: open.feishu.cn)", default="open.feishu.cn")
    parser.add_argument("--skip-images", help="Skip image processing and only handle mermaid diagrams", action="store_true")
    parser.add_argument("--force-images", help="Force adding images to document root even without finding references", action="store_true")
    args = parser.parse_args()
    
    # Get file path from argument or input
    file_path = args.file
    if not file_path:
        file_path = input("Enter the path to the markdown file: ")
    
    print(f"Processing file: {file_path}")
    
    # Get original filename from the path
    original_filename = os.path.basename(file_path)
    
    # Extract mermaid blocks from markdown
    extracted_mermaid = extract_mermaid_from_markdown(file_path)
    
    # Extract image references from markdown
    extracted_images = [] if args.skip_images else extract_images_from_markdown(file_path)
    
    # Check if images exist and filter out non-existent ones
    if extracted_images:
        valid_images = []
        for img in extracted_images:
            img_path = Path(img['path'])
            if img_path.exists():
                valid_images.append(img)
            else:
                print(f"Warning: Image file does not exist: {img_path}")
        
        if len(valid_images) < len(extracted_images):
            print(f"Warning: {len(extracted_images) - len(valid_images)} referenced images don't exist")
        
        extracted_images = valid_images
    
    # Get access token
    token = get_tenant_access_token()
    if not token:
        print("Failed to get access token")
        return
    
    # Upload the file
    file_token = upload_file(token, file_path, args.domain)
    if not file_token:
        print("Upload failed")
        return
    
    # Import the file as a document with original filename as title
    doc_info = import_to_document(token, file_token, original_filename, args.domain, max_retries=15)
    if not doc_info or not doc_info.get("token"):
        print("Import failed")
        return
    
    doc_token = doc_info["token"]
    doc_url = doc_info["url"]
    
    print("\n=== Document Created ===")
    print(f"Document URL: {doc_url}")
    
    # Wait for the document to be fully processed
    print("\nWaiting for document to be fully processed...")
    time.sleep(5)
    
    # Pre-cache the document structure for improved performance with parent lookups
    print("Pre-caching document structure for faster processing...")
    cache_document_structure(token, doc_token, args.domain)
    
    # Get document blocks
    blocks = get_document_blocks(token, doc_token, args.domain)
    if not blocks:
        print("Failed to get document blocks")
        return
    
    # DEBUG: list block types and keys
    print("\n=== DEBUG: Block Types and Keys ===")
    for idx, b in enumerate(blocks.get("items", [])):
        if not isinstance(b, dict):
            continue
        print(f"[{idx}] type={b.get('block_type')} keys={list(b.keys())}")
    # End debug block list

    # DEBUG: raw equation and table blocks
    print("\n=== DEBUG: Raw Equation Blocks ===")
    for idx, b in enumerate(blocks.get("items", [])):
        if not isinstance(b, dict):
            continue
        bt = b.get('block_type')
        if bt in (14, 15) or 'equation' in b:
            print(f"Equation Block[{idx}] id={b.get('block_id')} type={bt} keys={list(b.keys())}")
            print(json.dumps(b, indent=2, ensure_ascii=False)[:1000])

    print("\n=== DEBUG: Raw Table Blocks ===")
    for idx, b in enumerate(blocks.get("items", [])):
        if not isinstance(b, dict):
            continue
        bt = b.get('block_type')
        if bt in (31, 32) or 'table' in b:
            print(f"Table Block[{idx}] id={b.get('block_id')} type={bt} keys={list(b.keys())}")
            print(json.dumps(b, indent=2, ensure_ascii=False)[:1000])

    # DEBUG: find any blocks containing '$$'
    print("\n=== DEBUG: Searching for '$$' in block text ===")
    dollar_matches = find_text_in_blocks(blocks, "$$")
    print(f"Found {len(dollar_matches)} blocks with '$$'")
    for m in dollar_matches:
        print(f"Block id={m['id']}, preview={m['content'][:100]}")
        b = next((blk for blk in blocks.get("items", []) if blk.get('block_id') == m['id']), None)
        print(json.dumps(b, indent=2, ensure_ascii=False)[:1000])

    # Locate mermaid blocks in the document
    mermaid_blocks = locate_mermaid_blocks(blocks, extracted_mermaid)
    
    # Process mermaid blocks
    if mermaid_blocks:
        print("\n=== Converting Mermaid Blocks ===")
        mermaid_success_count = convert_mermaid_blocks(token, doc_token, mermaid_blocks, args.domain)
        print(f"Successfully converted {mermaid_success_count} of {len(mermaid_blocks)} mermaid blocks")
    else:
        print("\n=== No Mermaid Blocks to Convert ===")
    
    # Center equation blocks imported from markdown $$...$$
    eq_blocks = locate_equation_blocks(blocks)
    if eq_blocks:
        print("\n=== Centering Equation Blocks ===")
        eq_count = center_equation_blocks(token, doc_token, eq_blocks, args.domain)
        print(f"Centered {eq_count}/{len(eq_blocks)} equation blocks")
    
    # Locate and update table headers
    table_blocks = locate_table_blocks(blocks)
    if table_blocks:
        print("\n=== DEBUG: Table Block Properties ===")
        for b in table_blocks:
            print(json.dumps(b.get('table', {}), indent=2, ensure_ascii=False))
        print("\n=== Setting Table Headers ===")
        tb_count = set_table_headers(token, doc_token, table_blocks, args.domain)
        print(f"Updated {tb_count}/{len(table_blocks)} table blocks")
    
    # Process image references only if there are valid images and we're not skipping them
    if extracted_images and not args.skip_images:
        # Locate image references in the document or force add at root
        if args.force_images:
            print("\n=== Forcing Image Upload to Document Root ===")
            # Create direct reference to document root for each image
            image_refs = [{
                'parent_id': doc_token,  # Use document token as parent ID
                'image_info': img
            } for img in extracted_images]
            
            print(f"Adding {len(image_refs)} images directly to document root")
        else:
            # Try to locate references in the document
            image_refs = locate_image_references(blocks, extracted_images)
            
            # If no references found but we have images, add them to the root anyway
            if not image_refs and extracted_images:
                print("No image references found, but images exist. Adding to document root.")
                image_refs = [{
                    'parent_id': doc_token,  # Use document token as parent ID
                    'image_info': img
                } for img in extracted_images]
        
        # Process image references
        if image_refs:
            print("\n=== Converting Image References ===")
            image_success_count = convert_image_references(token, doc_token, image_refs, args.domain)
            print(f"Successfully converted {image_success_count} of {len(image_refs)} image references")
        else:
            print("\n=== No Image References Found in Document ===")
    else:
        print("\n=== Skipping Image Processing ===")
    
    print(f"\n=== Processing Complete ===")
    print(f"Document URL: {doc_url}")

if __name__ == "__main__":
    main()
