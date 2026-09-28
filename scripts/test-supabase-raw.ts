const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/` : 'https://placeholder.supabase.co/rest/v1/');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key';

async function test() {
  const res = await fetch(url, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
  });
  console.log('Status:', res.status);
  const data = await res.json();
  console.log('Definitions/Tables in OpenAPI:', Object.keys(data.definitions || {}));
}

test();
