/**
 * Centralized fetch utility for Zenin Admin.
 * Handles base URL resolution and standard headers.
 */

function resolveAdminApiUrl() {
  if (typeof window === 'undefined') return 'http://localhost:4000/api/admin';
  const hostname = window.location.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return 'http://localhost:4000/api/admin';
  }
  // Production mapping: admin.zenin.capital -> backend-api/api/admin
  return 'https://zenin-mx6w.onrender.com/api/admin'; 
}

const ADMIN_API_BASE_URL = resolveAdminApiUrl();

export async function adminFetch(endpoint, options = {}) {
  const url = endpoint.startsWith('http') 
    ? endpoint 
    : `${ADMIN_API_BASE_URL}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;

  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  try {
    const response = await fetch(url, {
      ...options,
      credentials: options.credentials || 'include',
      headers
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || `API Error: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error(`Admin API Error (${endpoint}):`, error);
    throw error;
  }
}
