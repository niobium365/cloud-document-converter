/**
 * Two-step executor for Lark user_change API calls.
 */
export async function postChangeMap(
  changeMap: Record<string, any>,
  pageBlockId: string,
  memberId: string,
  csrf: string
): Promise<boolean> {
  // Stage 1: dummy op to sync versions
  const dummyChangeMap: Record<string, any> = {};
  for (const [id, payload] of Object.entries(changeMap)) {
    if (payload.version > 0) {
      dummyChangeMap[id] = {
        id,
        version: 1,
        payload: { ops: [{ p: ['background_color'], action: { od: 'rgb(2,2,2)' } }] }
      };
    }
  }

  if (Object.keys(dummyChangeMap).length) {
    const dummyBody = {
      member_id: String(memberId),
      uuid: crypto.randomUUID(),
      page_id: pageBlockId,
      change_map: dummyChangeMap
    };
    console.log('Dummy POST → /space/api/docx/blocks/user_change', dummyBody);
    const dummyResp = await fetch('/space/api/docx/blocks/user_change', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json;charset=UTF-8', ...(csrf ? { 'x-csrftoken': csrf } : {}) },
      body: JSON.stringify(dummyBody)
    });
    const dummyJson: any = await dummyResp.json();
    console.log('dummyJson:', dummyJson);
    if (dummyJson?.data?.block_map) {
      const blockMap = dummyJson.data.block_map as Record<string, { id: string; version: number }>;
      for (const [bid, info] of Object.entries(blockMap)) {
        if (changeMap[bid]) changeMap[bid].version = info.version;
      }
    }
  }

  // Final user_change request
  const body = {
    member_id: String(memberId),
    uuid: crypto.randomUUID(),
    page_id: pageBlockId,
    change_map: changeMap
  };
  const paths = ['/space/api/docx/blocks/user_change'];
  let resp: Response | null = null;
  let lastErr: any = null;
  for (const p of paths) {
    try {
      const r = await fetch(p, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json;charset=UTF-8', ...(csrf ? { 'x-csrftoken': csrf } : {}) },
        body: JSON.stringify(body)
      });
      if (r.ok) { resp = r; break; }
    } catch (e) {
      lastErr = e;
    }
  }
  if (!resp) throw lastErr ?? new Error('user_change request failed');
  let json: any = {};
  try { json = await resp.json(); } catch (e) { console.warn('Non-JSON response from user_change', e); }
  return resp.ok && json?.code === 0;
}
