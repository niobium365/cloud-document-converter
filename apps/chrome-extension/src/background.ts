import { type Message } from './common/message'

enum MenuItemId {
  DOWNLOAD_DOCX_AS_MARKDOWN = 'download_docx_as_markdown',
  COPY_DOCX_AS_MARKDOWN = 'copy_docx_as_markdown',
  OPTIMIZE_DOCX = 'optimize_docx',
}

// Capture member_id from early network traffic (user_change / room/watch)
chrome.webRequest.onBeforeRequest.addListener(
  details => {
    try {
      const url = new URL(details.url)
      // /space/api/room/watch?member_id=...
      const mid = url.pathname.includes('/space/api/room/watch')
        ? url.searchParams.get('member_id')
        : undefined
      if (mid) {
        chrome.storage.local.set({ earlyMemberId: mid })
        return
      }
      // /blocks/user_change POST body contains JSON with member_id
      if (
        url.pathname.includes('/blocks/user_change') &&
        details.requestBody?.raw?.length
      ) {
        const bytes = details.requestBody.raw[0].bytes
        if (bytes) {
          const bodyStr = new TextDecoder().decode(bytes)
          const parsed = JSON.parse(bodyStr)
          if (parsed?.member_id) {
            chrome.storage.local.set({ earlyMemberId: String(parsed.member_id) })
          }
          // Capture full user_change request payload for debugging
          //chrome.storage.local.set({ lastUserChangeParsed: parsed })
          //console.log('Captured full /blocks/user_change payload:', parsed)
        }
      }
    } catch {
      /* ignore */
    }
    return undefined
  },
  {
    urls: [
      "*://*/blocks/user_change*",
      "*://*/space/api/room/watch*",
    ],
  },
  ["requestBody"],
)

// Pending page block version tracking
interface PendingVersion { pageId: string; version: number; }
const pendingVersions: Record<string, PendingVersion> = {};

// Capture page block version from outgoing /blocks/user_change requests
chrome.webRequest.onBeforeRequest.addListener(
  details => {
    try {
      const url = new URL(details.url);
      if (
        url.pathname.includes('/blocks/user_change') &&
        details.requestBody?.raw?.length
      ) {
        const bytes = details.requestBody.raw[0].bytes;
        if (bytes) {
          const bodyStr = new TextDecoder().decode(bytes);
          const parsed = JSON.parse(bodyStr);
          const pageId: string = parsed.page_id;
          const pageEntry = parsed.change_map?.[pageId];
          if (pageId && pageEntry?.version != null) {
            pendingVersions[details.requestId] = { pageId, version: pageEntry.version };
          }
        }
      }
    } catch {}
    return undefined;
  },
  { urls: ["*://*/blocks/user_change*", "*://*/space/api/docx/blocks/user_change*", "*://*/space/api/docx/*batch_update*"] },
  ["requestBody"]
);

// On response, cache new page block version
console.log('[CDC] Background onCompleted listener added');
chrome.webRequest.onCompleted.addListener(
  details => {
    console.log('[CDC] user_change completed', details.requestId, details.statusCode);
    try {
      const pending = pendingVersions[details.requestId];
      if (pending && details.statusCode === 200) {
        console.log('[CDC] caching new version', pending.pageId, pending.version + 1);
        const newVer = pending.version + 1;
        chrome.storage.local.set({ [`cdc_page_version_${pending.pageId}`]: newVer });
      }
    } catch {}
    delete pendingVersions[details.requestId];
  },
  { urls: ["*://*/blocks/user_change*", "*://*/space/api/docx/blocks/user_change*", "*://*/space/api/docx/*batch_update*"] }
);

// Capture CSRF token from outgoing requests
chrome.webRequest.onBeforeSendHeaders.addListener(
  details => {
    try {
      for (const h of details.requestHeaders || []) {
        if (h.name.toLowerCase() === 'x-csrftoken') {
          chrome.storage.local.set({ csrfToken: h.value });
          console.log('Captured csrfToken:', h.value);
          break;
        }
      }
    } catch {
      /* ignore */
    }
    return undefined;
  },
  { urls: ["*://*/space/api/docx/blocks/user_change*", "*://*/space/api/docx/*batch_update*"] },
  ["requestHeaders"]
);

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MenuItemId.DOWNLOAD_DOCX_AS_MARKDOWN,
    title: chrome.i18n.getMessage('download_docx_as_markdown'),
    documentUrlPatterns: [
      'https://*.feishu.cn/*',
      'https://*.feishu.net/*',
      'https://*.larksuite.com/*',
      'https://*.feishu-pre.net/*',
      'https://*.larkoffice.com/*',
    ],
    contexts: ['page', 'editable'],
  })

  chrome.contextMenus.create({
    id: MenuItemId.COPY_DOCX_AS_MARKDOWN,
    title: chrome.i18n.getMessage('copy_docx_as_markdown'),
    documentUrlPatterns: [
      'https://*.feishu.cn/*',
      'https://*.feishu.net/*',
      'https://*.larksuite.com/*',
      'https://*.feishu-pre.net/*',
      'https://*.larkoffice.com/*',
    ],
    contexts: ['page', 'editable'],
  })

  chrome.contextMenus.create({
    id: MenuItemId.OPTIMIZE_DOCX,
    title: chrome.i18n.getMessage('optimize_docx'),
    documentUrlPatterns: [
      'https://*.feishu.cn/*',
      'https://*.feishu.net/*',
      'https://*.larksuite.com/*',
      'https://*.feishu-pre.net/*',
      'https://*.larkoffice.com/*',
    ],
    contexts: ['page', 'editable'],
  })
})

const executeScriptByFlag = async (flag: string | number, tabId: number) => {
  switch (flag) {
    case MenuItemId.DOWNLOAD_DOCX_AS_MARKDOWN:
      await chrome.scripting.executeScript({
        files: ['bundles/scripts/download-lark-docx-as-markdown.js'],
        target: { tabId },
        world: 'MAIN',
      })
      break
    case MenuItemId.COPY_DOCX_AS_MARKDOWN:
      await chrome.scripting.executeScript({
        files: ['bundles/scripts/copy-lark-docx-as-markdown.js'],
        target: { tabId },
        world: 'MAIN',
      })
      break
    case MenuItemId.OPTIMIZE_DOCX:
      // First, mirror captured memberId from extension storage into page localStorage so
      // the optimize script (running in MAIN world) can access it without chrome APIs.
      await chrome.scripting.executeScript({
        func: () => {
          chrome.storage.local.get(['earlyMemberId','csrfToken'], (res: any) => {
            const mid = res.earlyMemberId;
            if (mid) {
              try { window.localStorage.setItem('cdc_early_member_id', String(mid)); } catch {}
            }
            const csrf = res.csrfToken;
            if (csrf) {
              try { window.localStorage.setItem('cdc_csrf_token', String(csrf)); } catch {}
            }
          });
        },
        target: { tabId },
      })
      await chrome.scripting.executeScript({
        files: ['bundles/scripts/optimize-lark-docx.js'],
        target: { tabId },
        world: 'MAIN',
      })
      break
    default:
      break
  }
}

chrome.contextMenus.onClicked.addListener(({ menuItemId }, tab) => {
  if (tab?.id !== undefined) {
    executeScriptByFlag(menuItemId, tab.id).catch(console.error)
  }
})

chrome.runtime.onMessage.addListener((_message, sender, sendResponse) => {
  const message = _message as Message

  const executeScript = async () => {
    const activeTabs = await chrome.tabs.query({
      currentWindow: true,
      active: true,
    })

    const activeTabId = activeTabs.at(0)?.id

    if (activeTabs.length === 1 && activeTabId !== undefined) {
      await executeScriptByFlag(message.flag, activeTabId)
    }
  }

  executeScript().then(sendResponse).catch(console.error)

  return true
})
