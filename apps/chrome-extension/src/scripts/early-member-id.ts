/**
 * early-member-id.ts
 * Runs at document_start to capture member_id before Lark clears cookies/globals.
 */
;(() => {
  try {
    const cookieMatch = document.cookie.match(/(?:^|;\s)(?:c_uid_v2|c_uid|uid|__tea__ug__uid)=([^;]+)/)
    if (cookieMatch) {
      const id = decodeURIComponent(cookieMatch[1])
      localStorage.setItem('cdc_early_member_id', id)
    }
    const cfg = (window as any).__USER_CONFIG__
    if (cfg?.member_id && !localStorage.getItem('cdc_early_member_id')) {
      localStorage.setItem('cdc_early_member_id', String(cfg.member_id))
    }
  } catch {
    /* silent */
  }
})()

// sniff network /blocks/user_change to cache member_id if not already captured
;(() => {
  const origFetch = window.fetch
  window.fetch = async (...args) => {
    try {
      const [input, init] = args as [RequestInfo, RequestInit?]
      let url = typeof input === 'string' ? input : (input as Request).url
      if (url.includes('/blocks/user_change') || url.includes('/space/api/room/watch')) {
        // 1. member_id in request body (/blocks/user_change)
        const bodyStr = init?.body
        if (typeof bodyStr === 'string') {
          const parsed = JSON.parse(bodyStr)
          if (parsed?.member_id) {
            localStorage.setItem('cdc_early_member_id', String(parsed.member_id))
          }
        }
        // 2. member_id in query params (/space/api/room/watch)
        if (url.includes('/space/api/room/watch')) {
          try {
            const mid = new URL(url).searchParams.get('member_id')
            if (mid) {
              localStorage.setItem('cdc_early_member_id', mid)
            }
          } catch {}
        }
        // Restore only if captured
        if (localStorage.getItem('cdc_early_member_id')) {
          window.fetch = origFetch
        }
      }
    } catch {}
    return origFetch(...(args as Parameters<typeof window.fetch>))
  }
})()
