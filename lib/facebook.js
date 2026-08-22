// Facebook Messenger API helper
// Docs: https://developers.facebook.com/docs/messenger-platform/send-messages

import crypto from 'node:crypto';
import { getSupabase } from '@/lib/supabaseAdmin';

const FB_PAGE_ACCESS_TOKEN = process.env.FB_PAGE_ACCESS_TOKEN;
const FB_API_VERSION = 'v18.0';
const FB_GRAPH_URL = `https://graph.facebook.com/${FB_API_VERSION}`;
const MESSAGING_WINDOW_MS = 24 * 60 * 60 * 1000;

// MESSAGE_TAG sends require Meta App Review approval for pages_messaging,
// which this app has never completed — every tagged send fails with a
// generic "Invalid parameter" error, tagged or not. A customer who messaged
// the Page within the last 24 hours can instead be sent untagged
// (messaging_type: RESPONSE), which needs no review. Outside the window this
// still falls back to the tagged form — no regression there, since it was
// already broken pending review.
async function resolveMessagingType(recipientPsid) {
  const supabase = getSupabase();
  const { data } = await supabase
    .from('messenger_conversations')
    .select('last_inbound_at')
    .eq('psid', recipientPsid)
    .maybeSingle();

  const withinWindow = data && (Date.now() - new Date(data.last_inbound_at).getTime()) < MESSAGING_WINDOW_MS;
  return withinWindow
    ? { messaging_type: 'RESPONSE' }
    : { messaging_type: 'MESSAGE_TAG', tag: 'POST_PURCHASE_UPDATE' };
}

/**
 * Send a message via Facebook Messenger
 * Note: Customer must have initiated conversation with your Page first
 * @param {string} recipientPsid - Page-scoped user ID (PSID)
 * @param {string} messageText - Message to send
 */
export async function sendMessengerMessage(recipientPsid, messageText) {
  if (!FB_PAGE_ACCESS_TOKEN) {
    throw new Error('FB_PAGE_ACCESS_TOKEN not configured');
  }

  const response = await fetch(`${FB_GRAPH_URL}/me/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${FB_PAGE_ACCESS_TOKEN}` },
    body: JSON.stringify({
      recipient: { id: recipientPsid },
      message: { text: messageText },
      ...(await resolveMessagingType(recipientPsid)),
    }),
  });

  const data = await response.json();

  if (data.error) {
    throw new Error(data.error.message || 'Failed to send Messenger message');
  }

  return data;
}

/**
 * Send a message with quick reply buttons
 */
export async function sendMessengerQuickReply(recipientPsid, messageText, quickReplies) {
  if (!FB_PAGE_ACCESS_TOKEN) {
    throw new Error('FB_PAGE_ACCESS_TOKEN not configured');
  }

  const response = await fetch(`${FB_GRAPH_URL}/me/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${FB_PAGE_ACCESS_TOKEN}` },
    body: JSON.stringify({
      recipient: { id: recipientPsid },
      message: {
        text: messageText,
        quick_replies: quickReplies.map(qr => ({
          content_type: 'text',
          title: qr.title,
          payload: qr.payload,
        })),
      },
      messaging_type: 'MESSAGE_TAG',
      tag: 'POST_PURCHASE_UPDATE',
    }),
  });

  const data = await response.json();
  
  if (data.error) {
    throw new Error(data.error.message || 'Failed to send Messenger message');
  }

  return data;
}

/**
 * Send an order receipt template
 */
export async function sendMessengerReceipt(recipientPsid, order) {
  if (!FB_PAGE_ACCESS_TOKEN) {
    throw new Error('FB_PAGE_ACCESS_TOKEN not configured');
  }

  const response = await fetch(`${FB_GRAPH_URL}/me/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${FB_PAGE_ACCESS_TOKEN}` },
    body: JSON.stringify({
      recipient: { id: recipientPsid },
      message: {
        attachment: {
          type: 'template',
          payload: {
            template_type: 'receipt',
            recipient_name: order.customer_name,
            order_number: order.id,
            currency: 'PHP',
            payment_method: order.payment_method === 'cod' ? 'Cash on Delivery' : order.payment_method,
            summary: {
              total_cost: order.total_amount,
            },
            elements: [
              {
                title: `${order.product_type} (${order.container_size})`,
                subtitle: `${order.quantity} refill(s)`,
                quantity: order.quantity,
                price: order.total_amount,
                currency: 'PHP',
              },
            ],
          },
        },
      },
      messaging_type: 'MESSAGE_TAG',
      tag: 'POST_PURCHASE_UPDATE',
    }),
  });

  const data = await response.json();
  
  if (data.error) {
    throw new Error(data.error.message || 'Failed to send receipt');
  }

  return data;
}

/**
 * Verify webhook signature from Facebook
 */
export function verifyWebhookSignature(signature, payload, appSecret) {
  if (!signature || !appSecret) return false;
  const expectedSignature = 'sha256=' + crypto
    .createHmac('sha256', appSecret)
    .update(payload)
    .digest('hex');
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expectedSignature);
  if (sigBuf.length !== expBuf.length) return false;
  return crypto.timingSafeEqual(sigBuf, expBuf);
}
