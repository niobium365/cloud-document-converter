// Create a debug console that appears on the page
const createDebugConsole = () => {
  // Remove any existing debug console
  const existingConsole = document.getElementById('custom-debug-console');
  if (existingConsole) {
    document.body.removeChild(existingConsole);
  }

  // Create the debug console container
  const debugConsole = document.createElement('div');
  debugConsole.id = 'custom-debug-console';
  debugConsole.style.cssText = `
    position: fixed;
    bottom: 10px;
    left: 10px;
    width: 600px;
    max-height: 300px;
    background: rgba(0, 0, 0, 0.8);
    color: white;
    font-family: monospace;
    font-size: 12px;
    padding: 10px;
    border-radius: 5px;
    z-index: 999999;
    overflow-y: auto;
    box-shadow: 0 0 10px rgba(0, 0, 0, 0.5);
  `;

  // Add a header with controls
  const header = document.createElement('div');
  header.style.cssText = `
    display: flex;
    justify-content: space-between;
    margin-bottom: 5px;
    padding-bottom: 5px;
    border-bottom: 1px solid #444;
  `;
  
  const title = document.createElement('span');
  title.textContent = 'Debug Console';
  title.style.fontWeight = 'bold';
  
  const clearButton = document.createElement('button');
  clearButton.textContent = 'Clear';
  clearButton.style.cssText = `
    background: #333;
    color: white;
    border: none;
    padding: 2px 8px;
    border-radius: 3px;
    cursor: pointer;
  `;
  clearButton.onclick = () => {
    const logContainer = document.getElementById('debug-log-container');
    if (logContainer) logContainer.innerHTML = '';
  };
  
  header.appendChild(title);
  header.appendChild(clearButton);
  debugConsole.appendChild(header);

  // Create log container
  const logContainer = document.createElement('div');
  logContainer.id = 'debug-log-container';
  logContainer.style.cssText = `
    display: flex;
    flex-direction: column;
  `;
  debugConsole.appendChild(logContainer);

  // Add to body
  document.body.appendChild(debugConsole);

  // Make it draggable
  let isDragging = false;
  let offsetX, offsetY;

  header.style.cursor = 'move';
  header.addEventListener('mousedown', (e) => {
    isDragging = true;
    offsetX = e.clientX - debugConsole.getBoundingClientRect().left;
    offsetY = e.clientY - debugConsole.getBoundingClientRect().top;
  });

  document.addEventListener('mousemove', (e) => {
    if (isDragging) {
      debugConsole.style.left = (e.clientX - offsetX) + 'px';
      debugConsole.style.top = (e.clientY - offsetY) + 'px';
      debugConsole.style.bottom = 'auto';
    }
  });

  document.addEventListener('mouseup', () => {
    isDragging = false;
  });

  // Return the console API
  return {
    log: function(...args) {
      appendLogEntry(args, 'log');
    },
    warn: function(...args) {
      appendLogEntry(args, 'warn');
    },
    error: function(...args) {
      appendLogEntry(args, 'error');
    },
    clear: function() {
      const logContainer = document.getElementById('debug-log-container');
      if (logContainer) logContainer.innerHTML = '';
    }
  };
};

// Helper to append log entries
function appendLogEntry(args, type) {
  const logContainer = document.getElementById('debug-log-container');
  if (!logContainer) return;
  
  // Limit to 20 entries
  if (logContainer.children.length >= 20) {
    logContainer.removeChild(logContainer.firstChild);
  }
  
  const entry = document.createElement('div');
  entry.style.cssText = `
    padding: 3px 0;
    border-bottom: 1px solid #333;
    word-break: break-all;
    white-space: pre-wrap;
  `;
  
  // Style based on log type
  if (type === 'warn') {
    entry.style.color = '#ffcc00';
  } else if (type === 'error') {
    entry.style.color = '#ff6666';
  }
  
  // Format the arguments
  const formattedArgs = args.map(arg => {
    if (typeof arg === 'object') {
      try {
        return JSON.stringify(arg, null, 2);
      } catch (e) {
        return String(arg);
      }
    }
    return String(arg);
  }).join(' ');
  
  entry.textContent = formattedArgs;
  logContainer.appendChild(entry);
  
  // Auto-scroll to bottom
  logContainer.scrollTop = logContainer.scrollHeight;
}

// Create and expose the debug console
const debugConsole = createDebugConsole();

// Override console methods if desired
const originalConsole = {
  log: console.log,
  warn: console.warn,
  error: console.error
};

// Uncomment these lines to override the native console methods
console.log = function(...args) {
  debugConsole.log(...args);
  originalConsole.log.apply(console, args);
};

console.warn = function(...args) {
  debugConsole.warn(...args);
  originalConsole.warn.apply(console, args);
};

console.error = function(...args) {
  debugConsole.error(...args);
  originalConsole.error.apply(console, args);
};

// Expose custom console functions
window.console_log = debugConsole.log;
window.console_warn = debugConsole.warn;
window.console_error = debugConsole.error;

// Let the user know it's ready
debugConsole.log('Debug console initialized. Use console_log(), console_warn(), or console_error() to log messages.');
