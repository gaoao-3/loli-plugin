const API_BASE = '/api';

export async function request(path, options = {}) {
  const token = localStorage.getItem('loli-dashboard-token');
  const url = `${API_BASE}${path}`;
  
  const headers = { ...options.headers };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  if (!(options.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  let res;
  try {
    res = await fetch(url, { ...options, headers });
    
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
      throw new Error(message || `HTTP ${res.status}`);
    }
    
    if (res.status === 204) return null;
    const contentType = res.headers.get('content-type') || '';
    return contentType.includes('application/json') ? res.json() : res.text();
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
  post: (path, body) => request(path, {
    method: 'POST',
    ...(body ? { body: body instanceof FormData ? body : JSON.stringify(body) } : {})
  }),
  put: (path, body) => request(path, {
    method: 'PUT',
    body: JSON.stringify(body)
  }),
  delete: (path) => request(path, { method: 'DELETE' })
};
