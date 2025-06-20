import { Toast } from '@dolphin/lark';

const POC_PAYLOAD = {
  member_id: '65891318367513',
  uuid: '53ed145b-693d-4dc0-8a66-c1ffe3605757',
  page_id: 'Me1Xde7GvoxYk7xlhXjcWFXCnFb',
  change_map: {
    Me1Xde7GvoxYk7xlhXjcWFXCnFb: {
      id: 'Me1Xde7GvoxYk7xlhXjcWFXCnFb',
      version: 25,
      payload: {
        ops: [
          { p: ['children', 3], action: { ld: 'SlGjdfmtaoQVHHx4iGTcJtzBnmc' } },
          { p: ['children', 3], action: { li: 'RjoMdfJkoojgJPx49mocPP4En8d' } },
        ],
      },
    },
    RjoMdfJkoojgJPx49mocPP4En8d: {
      id: 'RjoMdfJkoojgJPx49mocPP4En8d',
      version: 0,
      payload: {
        ops: [
          {
            p: [],
            action: {
              oi: {
                type: 'isv',
                children: [],
                comments: [],
                revisions: [],
                author: '6955273262934802433',
                data: {
                  data: `flowchart TD
    A([ABC])
    P1([DEF])
    A --> P1`,
                  theme: 'default',
                  view: 'chart',
                },
                parent_id: 'Me1Xde7GvoxYk7xlhXjcWFXCnFb',
                app_block_id: '',
                block_type_id: 'blk_631fefbbae02400430b8f9f4',
                manifest: { view_type: 'block_h5', app_version: '0.0.100' },
                comment_details: {},
              },
            },
          },
        ],
      },
    },
  },
};

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const generateId = (): string =>
  Array.from({ length: 27 })  // Block IDs are 27-char base62
    .map(() => ALPHABET[Math.floor(Math.random() * ALPHABET.length)])
    .join('');

(async function runPoc() {
  const csrf = localStorage.getItem('cdc_csrf_token');
  if (!csrf) {
    Toast.warning({ content: 'Missing CSRF token' });
    return;
  }
  try {
    // Build dynamic payload to avoid replay
      const originalMap = JSON.parse(JSON.stringify(POC_PAYLOAD.change_map));
      const staticNewId = Object.keys(originalMap).find(id => id !== POC_PAYLOAD.page_id)!;
      const newBlockId = generateId();
      originalMap[newBlockId] = { ...originalMap[staticNewId], id: newBlockId };
      delete originalMap[staticNewId];
      // Update page ops to use newBlockId
      const pageEntry = originalMap[POC_PAYLOAD.page_id];
      pageEntry.payload.ops = pageEntry.payload.ops.map((op: any) =>
        op.action.li ? { ...op, action: { ...op.action, li: newBlockId } } : op
      );
      const requestUuid = crypto.randomUUID();
      const body = {
        member_id: POC_PAYLOAD.member_id,
        uuid: requestUuid,
        page_id: POC_PAYLOAD.page_id,
        change_map: originalMap,
      };
      const resp = await fetch('/space/api/docx/blocks/user_change', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json;charset=UTF-8',
          'x-csrftoken': csrf,
        },
        credentials: 'include',
        body: JSON.stringify(body),
      });
    const json = await resp.json().catch(() => ({}));
    console.log('POC result →', resp.status, json);
    if (resp.ok && json.code === 0) {
      Toast.success({ content: 'POC conversion succeeded!' });
    } else {
      Toast.warning({ content: `POC error: ${json.msg || json.data?.detail || resp.status}` });
    }
  } catch (err: any) {
    console.error(err);
    Toast.warning({ content: 'Network error.' });
  }
})();