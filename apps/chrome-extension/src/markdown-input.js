document.addEventListener('DOMContentLoaded', () => {
  // Parse tabId from URL query string
  const query = new URLSearchParams(window.location.search);
  const tabIdParam = query.get('tabId');
  const targetTabId = tabIdParam ? Number(tabIdParam) : undefined;
  const textarea = document.getElementById('markdown-textarea');
  const submitButton = document.getElementById('submit-button');
  const cancelButton = document.getElementById('cancel-button');

  // Focus the textarea when the window opens
  textarea.focus();

  // Handle submit button click
  submitButton.addEventListener('click', () => {
    const markdownText = textarea.value.trim();
    if (!markdownText) {
      console.error('No markdown provided');
      return;
    }

    // Send the markdown text directly to the background
    chrome.runtime.sendMessage({
      flag: 'paste_markdown',
      markdownText: markdownText,
      tabId: targetTabId
    }, () => {
      // Give the message time to be received before closing
      setTimeout(() => window.close(), 100);
    });
  });

  // Handle cancel button click
  cancelButton.addEventListener('click', () => {
    chrome.runtime.sendMessage({
      flag: 'markdown_cancelled'
    }, () => {
      // Give the message time to be received before closing
      setTimeout(() => window.close(), 100);
    });
  });

  // Handle keyboard shortcuts
  document.addEventListener('keydown', (event) => {
    // Submit on Ctrl+Enter or Cmd+Enter
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      submitButton.click();
    }
    // Cancel on Escape
    if (event.key === 'Escape') {
      cancelButton.click();
    }
  });
});
