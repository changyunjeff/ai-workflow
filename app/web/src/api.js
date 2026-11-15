// Thin client for the local service (docs/05-产线文件与接口.md). All paths are relative ("api/...")
// because the service serves this page and the API from the same origin.
import { mockRequest } from './mock.js';

const mockParam = new URLSearchParams(window.location.search).get('mock');
export const IS_MOCK = mockParam !== null && mockParam !== '0';

async function request(method, path, body) {
  if (IS_MOCK) return mockRequest(method, path, body);
  let res;
  try {
    res = await fetch(`api/${path}`, {
      method,
      cache: 'no-store',
      headers: method === 'POST' ? { 'Content-Type': 'application/json' } : undefined,
      body: method === 'POST' ? JSON.stringify(body || {}) : undefined,
    });
  } catch {
    throw new Error('连不上本机服务。请确认服务还开着。');
  }
  let data = null;
  try { data = await res.json(); } catch { /* not JSON */ }
  if (data && typeof data === 'object') return data;
  throw new Error(`本机服务没有正常回应（HTTP ${res.status}）。`);
}

// GET: throws on {"ok": false}. POST: returns the body as is; callers show data.error verbatim.
async function get(path) {
  const data = await request('GET', path);
  if (data.ok === false) throw new Error(data.error || '本机服务说读取失败，但没说原因。');
  return data;
}
const post = (path, body) => request('POST', path, body);
const itemPath = (id) => `item/${encodeURIComponent(id)}`;

export const api = {
  state: () => get('state'),
  switchLine: (id) => post('lines/switch', { id }),
  // samples: the materials every trial run is checked against
  addSample: (name, text) => post('line/sample', name ? { name, text } : { text }),
  removeSample: (name) => post('line/sample/remove', { name }),
  itemToSample: (id) => post(`${itemPath(id)}/sample`),
  item: (id) => get(itemPath(id)),
  // read-only: one run of the current version's latest trial / of the pending AI change's trial
  trialItem: (id) => get(`trial/${itemPath(id)}`),
  proposalItem: (id) => get(`proposal/${itemPath(id)}`),
  feed: (text, title) => post('item', title ? { text, title } : { text }),
  decide: (id, node, approve, reason) => post(`${itemPath(id)}/decide`, approve ? { node, approve: true } : { node, approve: false, reason }),
  run: (id, from, only) => post(`${itemPath(id)}/run`, { from, only }),
  abandon: (id) => post(`${itemPath(id)}/abandon`),
  saveNode: (id, patch, trial) => post('line/node', { id, patch, trial }),
  saveLayout: (layout) => post('line/layout', { layout }),
  approve: (force) => post('line/approve', force ? { force: true } : {}),
  unapprove: () => post('line/unapprove'),
  revert: (to) => post('line/revert', { to }),
  trial: () => post('line/trial'),
  ai: (scope, text) => post('ai', { scope, text }),
  aiAccept: (force) => post('ai/accept', force ? { force: true } : {}),
  aiReject: () => post('ai/reject'),
  open: (item, file) => post('open', file ? { item, file } : { item }),
};
