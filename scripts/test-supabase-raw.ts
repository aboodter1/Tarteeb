const url = 'https://damyfubyjdrrrgggncja.supabase.co/rest/v1/';
const key = 'sb_publishable_U0n-84iuyCwmqhe5tBSM1w_c-u0VJOT';

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
