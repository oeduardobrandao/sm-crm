// =============================================
// CRM Fluxo - Instagram Integration Service
// =============================================
import { supabase } from '../lib/supabase';

const EDGE_FUNCTION_URL = import.meta.env.VITE_SUPABASE_URL + '/functions/v1/instagram-integration';

async function getAuthHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  return {
    'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY as string,
    'Authorization': `Bearer ${session?.access_token}`,
    'Content-Type': 'application/json'
  };
}

export async function getInstagramAuthUrl(clientId: number): Promise<string> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${EDGE_FUNCTION_URL}/auth/${clientId}`, { headers });
  
  if (!res.ok) {
     const data = await res.json().catch(() => ({}));
     throw new Error(data.message || 'Error generating auth url');
  }
  
  const data = await res.json();
  return data.url;
}

export async function disconnectInstagram(clientId: number): Promise<void> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${EDGE_FUNCTION_URL}/disconnect/${clientId}`, {
      method: 'POST',
      headers
  });
  
  if (!res.ok) {
     const data = await res.json().catch(() => ({}));
     throw new Error(data.message || 'Error disconnecting');
  }
}

export async function syncInstagramData(clientId: number): Promise<void> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${EDGE_FUNCTION_URL}/sync/${clientId}`, { 
      method: 'POST',
      headers 
  });
  
  if (!res.ok) {
     const data = await res.json().catch(() => ({}));
     if (data.code === 'TOKEN_EXPIRED') {
         throw new Error('TOKEN_EXPIRED');
     }
     throw new Error(data.message || 'Error syncing data');
  }
}

export async function getInstagramSummary(clientId: number): Promise<any> {
    const headers = await getAuthHeaders();
    const res = await fetch(`${EDGE_FUNCTION_URL}/summary/${clientId}`, { headers });
    
    if (!res.ok) {
       const data = await res.json().catch(() => ({}));
       throw new Error(data.message || 'Error fetching summary');
    }
    
    const data = await res.json();
    if (data.exists === false) return null;
    return data;
}

export async function getInstagramPosts(clientId: number, page: number = 1): Promise<any> {
    const headers = await getAuthHeaders();
    const res = await fetch(`${EDGE_FUNCTION_URL}/posts/${clientId}?page=${page}`, { headers });
    
    if (!res.ok) {
       const data = await res.json().catch(() => ({}));
       throw new Error(data.message || 'Error fetching posts');
    }
    
    return res.json();
}

export async function publishInstagramPost(clientId: number, caption: string, imageUrl: string): Promise<any> {
    const headers = await getAuthHeaders();
    const res = await fetch(`${EDGE_FUNCTION_URL}/publish/${clientId}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ caption, media_url: imageUrl })
    });

    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || 'Error publishing post');
    }

    return res.json();
}
