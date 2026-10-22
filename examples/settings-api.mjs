// Copy this file into your frontend's API/services directory.
export function createSettingsApi({
  baseUrl = 'http://localhost:5000/api',
  getToken,
} = {}) {
  if (typeof getToken !== 'function') {
    throw new TypeError('getToken must return your current login token');
  }

  const apiUrl = baseUrl.replace(/\/+$/, '');

  async function request(path, method = 'GET', body) {
    const token = await getToken();
    if (!token) {
      const error = new Error('Please log in to access settings');
      error.status = 401;
      throw error;
    }

    const headers = { Authorization: `Bearer ${token}` };
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    const response = await fetch(`${apiUrl}/settings/${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const data = await response.json().catch(() => null);

    if (!response.ok || data?.success === false) {
      const error = new Error(data?.message || `Settings request failed (${response.status})`);
      error.status = response.status;
      throw error;
    }
    if (!data || data.success !== true) {
      throw new Error('Unexpected settings response. Check the backend API URL.');
    }

    return data;
  }

  return {
    async getProfile() {
      const data = await request('profile');
      return data.profile;
    },
    async updateProfile(updates) {
      const data = await request('profile', 'PATCH', updates);
      return data.profile;
    },
    changePassword({ currentPassword, newPassword }) {
      return request('password', 'PATCH', { currentPassword, newPassword });
    },
  };
}
