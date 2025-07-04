document.addEventListener('DOMContentLoaded', () => {
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

    // Send the markdown text back to the popup
    chrome.runtime.sendMessage({
      flag: 'markdown_submitted',
      markdownText: markdownText
    });

    // Close this window
    window.close();
  });

  // Handle cancel button click
  cancelButton.addEventListener('click', () => {
    chrome.runtime.sendMessage({
      flag: 'markdown_cancelled'
    });
    window.close();
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
