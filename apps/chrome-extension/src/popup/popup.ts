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
    
    // Build URL with tabId so the input window can send message directly to background
    const inputUrl = `${chrome.runtime.getURL('markdown-input.html')}?tabId=${targetTabId}`

    // Create a new window for markdown input
    await chrome.windows.create({
      url: inputUrl,
      type: 'popup',
      width: 800,
      height: 600,
      focused: true,
    })

    // Close the extension popup immediately; the input window will handle the rest
    window.close();

  }

  pasteMarkdownButton.addEventListener('click', () => {
    handlePasteMarkdown().catch(console.error)
  })
}
