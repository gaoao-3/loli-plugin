const API_BASE = '/api';

export async function request(path, options = {}) {
  const { withMeta = false, ...fetchOptions } = options;
  const token = localStorage.getItem('loli-dashboard-token');
  const url = `${API_BASE}${path}`;
  
  const headers = { ...fetchOptions.headers };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  if (!(fetchOptions.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  let res;
  try {
    res = await fetch(url, { ...fetchOptions, headers });
    
    if (res.status === 401) {
      localStorage.removeItem('loli-dashboard-token');
      // Dispatch custom event to trigger auth overlay in App.vue
      window.dispatchEvent(new CustomEvent('loli-unauthorized'));
      throw new Error('未授权，请输入安全验证令牌');
    }
    
    if (!res.ok) {
      const text = await res.text();
      let message = text;
      try {
        message = JSON.parse(text)?.error || text;
      } catch {}
      // Express 默认错误页是 HTML，提取 <pre> 里的纯文本
      if (/^\s*</.test(message)) {
        const pre = message.match(/<pre>([\s\S]*?)<\/pre>/i);
        message = (pre ? pre[1] : message.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
      }
      throw Object.assign(new Error(message || `HTTP ${res.status}`), { status: res.status });
    }
    
    if (res.status === 204) return withMeta ? { data: null, headers: res.headers } : null;
    const contentType = res.headers.get('content-type') || '';
    const data = contentType.includes('application/json') ? await res.json() : await res.text();
    return withMeta ? { data, headers: res.headers } : data;
  } catch (err) {
    if (res?.status !== 401) {
      // Dispatch error toast event
      window.dispatchEvent(new CustomEvent('loli-error-toast', { detail: err.message }));
    }
    throw err;
  }
}

export const api = {
  get: (path) => request(path),
  getWithMeta: (path) => request(path, { withMeta: true }),
  post: (path, body) => request(path, {
    method: 'POST',
    ...(body ? { body: body instanceof FormData ? body : JSON.stringify(body) } : {})
  }),
  put: (path, body, headers = {}) => request(path, {
    method: 'PUT',
    headers,
    body: JSON.stringify(body)
  }),
  delete: (path) => request(path, { method: 'DELETE' })
};
