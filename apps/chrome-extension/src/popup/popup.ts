document.querySelectorAll<HTMLElement>('[data-locale]').forEach(elem => {
  elem.innerText = chrome.i18n.getMessage(elem.dataset['locale'] ?? '')
})

const copyButton: HTMLElement | null = document.getElementById(
  'copy_docx_as_markdown',
)
if (copyButton) {
  const handleCopy = async () => {
    await chrome.runtime.sendMessage({ flag: 'copy_docx_as_markdown' })

    window.close()
  }

  copyButton.addEventListener('click', () => {
    handleCopy().catch(console.error)
  })
}

const downloadButton: HTMLElement | null = document.getElementById(
  'download_docx_as_markdown',
)
if (downloadButton) {
  const handleDownload = async () => {
    await chrome.runtime.sendMessage({ flag: 'download_docx_as_markdown' })

    window.close()
  }

  downloadButton.addEventListener('click', () => {
    handleDownload().catch(console.error)
  })
}

const optimizeButton: HTMLElement | null = document.getElementById(
  'optimize_docx',
)
if (optimizeButton) {
  const handleOptimize = async () => {
    await chrome.runtime.sendMessage({ flag: 'optimize_docx' })

    window.close()
  }

  optimizeButton.addEventListener('click', () => {
    handleOptimize().catch(console.error)
  })
}

const pasteMarkdownButton: HTMLElement | null = document.getElementById(
  'paste_markdown',
)
if (pasteMarkdownButton) {
  const handlePasteMarkdown = async (): Promise<void> => {
    // Capture the active Lark tab ID
    const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true, windowType: 'normal' });
    const targetTabId = activeTab?.id;
    if (!targetTabId) {
      console.error('Cannot find target Lark tab');
      return;
    }
    // Open a separate window for markdown input instead of a modal
    // This allows for a larger input area not constrained by popup size
    
    // Create a new window with specified dimensions
    const inputWindow = await chrome.windows.create({
      url: chrome.runtime.getURL('markdown-input.html'),
      type: 'popup',
      width: 800,
      height: 600,
      focused: true
    })
    
    // Store the window ID to track it
    const windowId = inputWindow?.id
    if (!windowId) {
      console.error('Failed to create markdown input window')
      return
    }
    
    // Set up a listener for messages from the input window
    const messageListener = (message: any, sender: chrome.runtime.MessageSender, sendResponse: () => void): boolean => {
      if (message.flag === 'markdown_submitted' && message.markdownText) {
        // Send markdown text to background
        chrome.runtime.sendMessage({ 
          flag: 'paste_markdown',
          markdownText: message.markdownText,
          tabId: targetTabId
        })
        
        // Clean up and close the popup
        chrome.runtime.onMessage.removeListener(messageListener)
        window.close()
      } else if (message.flag === 'markdown_cancelled') {
        // Just clean up and close the popup on cancel
        chrome.runtime.onMessage.removeListener(messageListener)
        window.close()
      }
      return true // Required for async response handling
    }
    
    // Add the listener
    chrome.runtime.onMessage.addListener(messageListener)
    

  }

  pasteMarkdownButton.addEventListener('click', () => {
    handlePasteMarkdown().catch(console.error)
  })
}
