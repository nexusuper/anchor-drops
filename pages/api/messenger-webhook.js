// Facebook Messenger Webhook
// Receives messages and stores customer PSID for notifications
import { getSupabase } from '@/lib/supabaseAdmin';
import { verifyWebhookSignature } from '@/lib/facebook';
import { timingSafeEqual } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { ORDER_NUMBER_SEARCH_RE } from '@/lib/order-number';
import { normalizePhonePH, phoneVariants } from '@/lib/order-guard';
import { PRODUCTS, BUSINESS_PHONE_DISPLAY } from '@/lib/products';
import { SITE_URL } from '@/lib/seo';

const VERIFY_TOKEN = process.env.FB_VERIFY_TOKEN;
// GET is Facebook's one-time verify handshake; POST is the untrusted inbound
// webhook that drives DB writes and outbound sends, so it gets its own tighter cap.
const verifyRate = rateLimit({ windowMs: 60_000, max: 60 });
const eventRate = rateLimit({ windowMs: 60_000, max: 30 });

export const config = { api: { bodyParser: false } };

const MAX_BODY_SIZE = 1024 * 256;

function rawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY_SIZE) {
        req.destroy();
        reject(new Error('Payload too large'));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  const limited = req.method === 'POST' ? eventRate : verifyRate;
  if (!(await limited(req, res))) return;

  // Webhook verification (GET request from Facebook)
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && VERIFY_TOKEN && timingSafeEqual(token, VERIFY_TOKEN)) {
      res.setHeader('Content-Type', 'text/plain');
      return res.status(200).send(String(challenge).replace(/[^0-9]/g, ''));
    }
    return res.status(403).json({ error: 'Verification failed' });
  }

  // Incoming messages (POST request)
  if (req.method === 'POST') {
    let raw;
    try {
      raw = await rawBody(req);
    } catch {
      return res.status(413).json({ error: 'Payload too large' });
    }
    const appSecret = process.env.FB_APP_SECRET;
    if (!appSecret) {
      return res.status(500).json({ error: 'Webhook not configured' });
    }
    const sig = req.headers['x-hub-signature-256'];
    if (!verifyWebhookSignature(sig, raw, appSecret)) {
      return res.status(403).json({ error: 'Invalid signature' });
    }

    let body;
    try { body = JSON.parse(raw.toString()); } catch {
      return res.status(400).json({ error: 'Invalid JSON' });
    }

    if (body.object !== 'page') {
      return res.status(404).json({ error: 'Not a page event' });
    }

    // Process each entry
    for (const entry of body.entry || []) {
      for (const event of entry.messaging || []) {
        const senderPsid = event.sender?.id;
        console.log('[messenger-debug] event keys:', Object.keys(event), 'senderPsid:', senderPsid);

        // Stamps every inbound event, independent of whether this PSID is
        // bound to a customer/order yet — Meta's 24h messaging window is a
        // property of the PSID conversation itself. Read by
        // lib/facebook.js's sendMessengerMessage() to decide whether an
        // outbound send can go untagged (see migration 0035).
        if (senderPsid) {
          try {
            const { data: convoData, error: convoError } = await getSupabase()
              .from('messenger_conversations')
              .upsert({ psid: senderPsid, last_inbound_at: new Date().toISOString() })
              .select();
            console.log('[messenger-debug] upsert result:', JSON.stringify({ convoData, convoError }));
          } catch (convoThrown) {
            console.error('[messenger-debug] upsert threw:', convoThrown);
          }
        }

        // Quick replies arrive as a message with a quick_reply payload, NOT as a
        // postback — routing them through handleMessage would drop them into the
        // free-text fallback and the menu buttons would appear to do nothing.
        if (event.message?.quick_reply?.payload) {
          await handlePostback(senderPsid, event.message.quick_reply.payload);
        } else if (event.message?.text) {
          await handleMessage(senderPsid, event.message.text);
        }

        if (event.postback?.payload) {
          await handlePostback(senderPsid, event.postback.payload);
        }

        // m.me?ref=<orderId> deep-link (from the confirmation page). The ref value
        // is attacker-craftable exactly like a typed message (anyone can open
        // m.me/<page>?ref=<guess> themselves), so it gets the same phone-gate as
        // the typed-message path below rather than binding on sight.
        const ref = event.referral?.ref || event.postback?.referral?.ref;
        if (ref) {
          const orderRef = extractOrderRef(ref);
          if (orderRef) await requestOrConfirmLink(senderPsid, orderRef, extractPhone(ref));
        }
      }
    }

    // Always return 200 quickly to Facebook
    return res.status(200).json({ status: 'ok' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

const ORDER_ID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

// Pull an order reference out of free text. Both handles have to work here:
// the confirmation page prints the customer-facing order number and puts THAT
// in its m.me ?ref= deep link (pages/order/confirmation.js — `handle` prefers
// order_number and only falls back to the uuid), so a uuid-only matcher meant
// no inbound event ever bound a PSID and every reward code was undeliverable.
// Returns { column, value } ready for a Supabase .eq(), or null.
function extractOrderRef(str) {
  const text = String(str || '');
  const num = text.match(ORDER_NUMBER_SEARCH_RE);
  if (num) return { column: 'order_number', value: num[0].toUpperCase() };
  const uuid = text.match(ORDER_ID_RE);
  if (uuid) return { column: 'id', value: uuid[0].toLowerCase() };
  return null;
}

const PHONE_RE = /(?:\+?63|0)9\d{9}/;

function extractPhone(str) {
  const match = String(str || '').match(PHONE_RE);
  return match ? match[0] : null;
}

// order_number is short and partly guessable (see lib/order-number.js's own
// entropy note), and unlike a UUID it's meant to be typed/shared by hand — so
// knowing it alone isn't proof of ownership. A pending bind (order found, phone
// not yet confirmed) is held here per PSID until the customer also states the
// phone number on the order, in this message or a follow-up one. Best-effort
// only (in-memory, one Vercel instance, same limitation as lib/rate-limit.js) —
// worst case the customer just has to send both again after a cold start.
const pendingLinks = new Map();
const PENDING_TTL_MS = 10 * 60_000;

function phoneMatchesOrder(phone, orderPhone) {
  if (!phone || !orderPhone) return false;
  return phoneVariants(orderPhone).includes(normalizePhonePH(phone));
}

// Bind a customer's Messenger PSID to an order (and their customer record).
// Returns true if a binding happened. Never throws to the caller.
async function bindOrder(senderPsid, order) {
  await getSupabase().from('orders').update({ messenger_psid: senderPsid }).eq('id', order.id);
  if (order.customer_id) {
    await getSupabase().from('customers').update({ messenger_psid: senderPsid }).eq('id', order.customer_id);
  }
  // sendReply is try/caught internally, so an FB API error here can't 500 the webhook
  // after the DB write already committed. Status is deliberately not echoed here —
  // it would confirm a guessed order number to whoever guessed it.
  await sendReply(senderPsid, `Got it — your order is linked.`);
}

// Look up ref, and either bind immediately (UUID — 128 bits, not guessable) or
// require the order's phone number before binding (order_number — guessable).
// Returns 'linked' | 'pending' | 'not_found'.
async function requestOrConfirmLink(senderPsid, ref, phoneInSameMessage) {
  const supabase = getSupabase();
  const { data: order } = await supabase
    .from('orders')
    .select('id, phone, messenger_psid, status, created_at, customer_id')
    .eq(ref.column, ref.value)
    .maybeSingle();

  // Only orders still in-flight and created recently can be linked — closes
  // the window where a stale/completed order ID (e.g. from an old screenshot)
  // could be used by a stranger to bind their Messenger to someone else's order.
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const eligible = order && !order.messenger_psid && !['delivered', 'cancelled'].includes(order.status) && order.created_at > thirtyDaysAgo;
  if (!eligible) return 'not_found';

  if (ref.column === 'id') {
    await bindOrder(senderPsid, order);
    return 'linked';
  }

  if (phoneMatchesOrder(phoneInSameMessage, order.phone)) {
    pendingLinks.delete(senderPsid);
    await bindOrder(senderPsid, order);
    return 'linked';
  }

  pendingLinks.set(senderPsid, { order, expiresAt: Date.now() + PENDING_TTL_MS });
  return 'pending';
}

const MENU = [
  { title: '🛒 Order water', payload: 'MENU_ORDER' },
  { title: '💰 Prices', payload: 'MENU_PRICES' },
  { title: '🙋 Talk to a person', payload: 'MENU_HUMAN' },
];

// "Talk to a person" mutes the bot for this PSID so the auto-replies don't talk
// over the owner. In-memory, best-effort — same single-instance caveat as
// pendingLinks above; worst case the bot resumes early after a cold start.
const humanHandoff = new Map();
const HANDOFF_TTL_MS = 60 * 60_000;

function inHandoff(senderPsid) {
  const until = humanHandoff.get(senderPsid);
  if (!until) return false;
  if (until < Date.now()) {
    humanHandoff.delete(senderPsid);
    return false;
  }
  return true;
}

function priceList() {
  return PRODUCTS
    .filter((p) => p.id !== 'slim5')
    .map((p) => `• ${p.name} — ₱${p.refill} refill (+₱${p.container} with container)`)
    .join('\n');
}

async function handleMessage(senderPsid, messageText) {
  const pending = pendingLinks.get(senderPsid);
  if (pending && pending.expiresAt > Date.now()) {
    const phone = extractPhone(messageText);
    if (phone && phoneMatchesOrder(phone, pending.order.phone)) {
      pendingLinks.delete(senderPsid);
      await bindOrder(senderPsid, pending.order);
      return;
    }
  }

  const orderRef = extractOrderRef(messageText);
  if (orderRef) {
    const result = await requestOrConfirmLink(senderPsid, orderRef, extractPhone(messageText));
    if (result === 'not_found') {
      await sendReply(senderPsid,
        `❌ Sorry, I couldn't find order #${orderRef.value}.

` +
        `Please double-check the Order ID from your confirmation page and try again.`,
        MENU
      );
    } else if (result === 'pending') {
      await sendReply(senderPsid,
        `To confirm this is your order, please also send the phone number used to place it.`
      );
    }
    return;
  }

  // Owner is handling this thread — stay quiet.
  if (inHandoff(senderPsid)) return;

  await sendReply(senderPsid,
    `👋 Hi! I'm the Anchor Drops assistant.

` +
    `What can I help you with?`,
    MENU
  );
}

async function handlePostback(senderPsid, payload) {
  switch (payload) {
    case 'MENU_ORDER':
      humanHandoff.delete(senderPsid);
      await sendReply(senderPsid,
        `🛒 Order here: ${SITE_URL}/order

` +
        `After you place it, send me your Order ID and I'll post delivery updates in this chat. 💧`,
        MENU
      );
      return;
    case 'MENU_PRICES':
      humanHandoff.delete(senderPsid);
      await sendReply(senderPsid,
        `💰 Our prices:
${priceList()}

` +
        `Delivery fee depends on your barangay — the exact total shows at checkout: ${SITE_URL}/order`,
        MENU
      );
      return;
    case 'MENU_HUMAN':
      humanHandoff.set(senderPsid, Date.now() + HANDOFF_TTL_MS);
      await sendReply(senderPsid,
        `🙋 Sure — leave your message here and our team will reply shortly.

` +
        `Need us now? Call or text ${BUSINESS_PHONE_DISPLAY}.`
      );
      return;
    case 'GET_STARTED':
    default:
      humanHandoff.delete(senderPsid);
      await sendReply(senderPsid,
        `👋 Welcome to Anchor Drops!

` +
        `We deliver fresh purified water right to your door.

` +
        `Pick an option below, or send your Order ID to get delivery updates here. 💧`,
        MENU
      );
  }
}

async function sendReply(recipientPsid, messageText, quickReplies) {
  const FB_PAGE_ACCESS_TOKEN = process.env.FB_PAGE_ACCESS_TOKEN;
  if (!FB_PAGE_ACCESS_TOKEN) {
    console.log('FB_PAGE_ACCESS_TOKEN not set, skipping reply');
    return;
  }

  try {
    await fetch('https://graph.facebook.com/v18.0/me/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${FB_PAGE_ACCESS_TOKEN}` },
      body: JSON.stringify({
        recipient: { id: recipientPsid },
        message: {
          text: messageText,
          ...(quickReplies?.length
            ? { quick_replies: quickReplies.map((qr) => ({ content_type: 'text', title: qr.title, payload: qr.payload })) }
            : {}),
        },
        // Always a reply to an inbound message, so the 24h window is open and no
        // MESSAGE_TAG (which needs unapproved App Review) is needed.
        messaging_type: 'RESPONSE',
      }),
    });
  } catch (error) {
    console.error('Error sending Messenger reply:', error);
  }
}
