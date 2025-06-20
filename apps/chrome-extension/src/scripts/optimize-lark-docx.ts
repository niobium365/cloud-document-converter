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

(async function runPoc() {
  const csrf = localStorage.getItem('cdc_csrf_token');
  if (!csrf) {
    Toast.warning({ content: 'Missing CSRF token' });
    return;
  }
  try {
    const resp = await fetch('/space/api/docx/blocks/user_change', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json;charset=UTF-8',
        'x-csrftoken': csrf,
      },
      credentials: 'include',
      body: JSON.stringify({ ...POC_PAYLOAD, uuid: crypto.randomUUID() }),
    });
    const json = await resp.json().catch(() => ({}));
    console.log('POC result →', resp.status, json);
    if (resp.ok && json.data?.code === 0) {
      Toast.success({ content: 'POC conversion succeeded!' });
      // Refresh in-editor view via doc_highlight
        try {
          await fetch('/baike/v2/api/doc_highlight', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json;charset=UTF-8',
              'x-csrftoken': csrf,
            },
            credentials: 'include',
            body: JSON.stringify({
              doc_id: POC_PAYLOAD.page_id,
              doc_type: 'docx',
              blocks: [
                {
                  text: '',
                  id: POC_PAYLOAD.page_id,
                  version: String(json.data.block_map[POC_PAYLOAD.page_id].version),
                },
              ],
              include_mine_words: false,
              is_editing: true,
              obj_id: '7517567469006028828',
              is_editable: true,
            }),
          })
        } catch (e) {
          console.warn('doc_highlight error', e)
        }
        location.reload();
    } else {
      Toast.warning({ content: `POC error: ${json.msg || json.data?.detail || resp.status}` });
    }
  } catch (err: any) {
    console.error(err);
    Toast.warning({ content: 'Network error.' });
  }
})();