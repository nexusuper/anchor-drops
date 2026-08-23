// One-off admin route to inspect and fix the Messenger persistent menu's
// webview URLs, which were pointing at a pre-rename domain
// (clear-flow-nexusupers-projects.vercel.app) that no longer serves this
// site. Delete this file once the fix is confirmed — it is not meant to be
// a permanent admin feature.
import { verifyAdminWithLockout } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';

const adminRate = rateLimit({ windowMs: 60_000, max: 10 });
const FB_GRAPH_URL = 'https://graph.facebook.com/v18.0';

export default async function handler(req, res) {
  if (!adminRate(req, res)) return;
  if (!await verifyAdminWithLockout(req, res)) return;

  const token = process.env.FB_PAGE_ACCESS_TOKEN;
  if (!token) return res.status(500).json({ error: 'FB_PAGE_ACCESS_TOKEN not configured' });

  if (req.method === 'GET') {
    const r = await fetch(`${FB_GRAPH_URL}/me/messenger_profile?fields=persistent_menu,get_started,ice_breakers,greeting&access_token=${token}`);
    const data = await r.json();
    return res.status(r.ok ? 200 : 500).json(data);
  }

  if (req.method === 'POST' && req.body?.action === 'fix') {
    const persistent_menu = [
      {
        locale: 'default',
        composer_input_disabled: false,
        call_to_actions: [
          { type: 'web_url', title: 'Place an Order', url: 'https://www.anchordropscdo.com/order', webview_height_ratio: 'full' },
          { type: 'web_url', title: 'View Prices', url: 'https://www.anchordropscdo.com/products', webview_height_ratio: 'full' },
          { type: 'phone_number', title: 'Talk to a person', payload: '+639758555055' },
        ],
      },
    ];
    const r = await fetch(`${FB_GRAPH_URL}/me/messenger_profile?access_token=${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ persistent_menu }),
    });
    const data = await r.json();
    return res.status(r.ok ? 200 : 500).json(data);
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
