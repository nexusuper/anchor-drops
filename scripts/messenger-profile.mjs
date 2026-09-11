// One-time (idempotent) Messenger profile setup: Get Started button, greeting,
// and the persistent menu. Payloads must match handlePostback() in
// pages/api/messenger-webhook.js.
//
//   FB_PAGE_ACCESS_TOKEN=... node scripts/messenger-profile.mjs          # apply
//   FB_PAGE_ACCESS_TOKEN=... node scripts/messenger-profile.mjs --show   # read back
//   FB_PAGE_ACCESS_TOKEN=... node scripts/messenger-profile.mjs --delete # remove
//
// Re-run after changing the menu; POST overwrites the whole profile.

const TOKEN = process.env.FB_PAGE_ACCESS_TOKEN;
if (!TOKEN) {
  console.error('FB_PAGE_ACCESS_TOKEN not set');
  process.exit(1);
}

const URL_BASE = 'https://graph.facebook.com/v18.0/me/messenger_profile';
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.anchordropscdo.com';

const profile = {
  get_started: { payload: 'GET_STARTED' },
  greeting: [
    {
      locale: 'default',
      text: 'Hi {{user_first_name}}! 💧 Anchor Drops delivers fresh purified water in Cagayan de Oro. Tap Get Started to order or check prices.',
    },
  ],
  persistent_menu: [
    {
      locale: 'default',
      composer_input_disabled: false,
      call_to_actions: [
        { type: 'postback', title: '🛒 Order water', payload: 'MENU_ORDER' },
        { type: 'postback', title: '💰 Prices', payload: 'MENU_PRICES' },
        { type: 'postback', title: '🙋 Talk to a person', payload: 'MENU_HUMAN' },
        { type: 'web_url', title: '🌐 Website', url: SITE_URL, webview_height_ratio: 'full' },
      ],
    },
  ],
};

async function call(method, body) {
  const res = await fetch(URL_BASE + (method === 'GET' ? '?fields=get_started,greeting,persistent_menu' : ''), {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json();
  if (data.error) {
    console.error('Facebook API error:', data.error.message);
    process.exit(1);
  }
  console.log(JSON.stringify(data, null, 2));
}

const arg = process.argv[2];
if (arg === '--show') await call('GET');
else if (arg === '--delete') await call('DELETE', { fields: ['get_started', 'greeting', 'persistent_menu'] });
else await call('POST', profile);
