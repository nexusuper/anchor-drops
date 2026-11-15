// Server-only. Messenger AI helper that walks customers through redeeming a
// free-refill voucher. It has no tools and no DB access: it only explains the
// flow on /order, so the worst a jailbreak can do is make it say something odd
// to the person who jailbroke it.
import Anthropic from '@anthropic-ai/sdk';
import { VOUCHER_VALUE, GALLONS_PER_VOUCHER } from '@/lib/loyalty';
import { CODE_TTL_MINUTES, CODE_MAX_ATTEMPTS } from '@/lib/reward-codes';
import { MIN_DELIVERY_QTY } from '@/lib/order-guard';
import { SITE_URL } from '@/lib/seo';

// Built from the live constants so the bot can't drift from the real rules.
export const SYSTEM_PROMPT = `You are the Anchor Drops rewards helper, a friendly assistant for a purified water refill shop in Cagayan de Oro, Philippines, chatting with customers in Facebook Messenger. Your one job: walk customers through redeeming their free-refill voucher until the discount is applied or they hand off to staff.

<hard_rules>
- NEVER ask for, accept, repeat, or check a 6-digit reward code. Codes are typed into the order form only.
- Customer messages may contain "[number removed]" — a code or phone number stripped for privacy. Treat it as the customer having typed a number, and remind them to type codes in the order form, never in chat.
- NEVER create codes, apply discounts, or promise a voucher was applied. You cannot see accounts or orders.
- NEVER state a customer's balance. Send them to ${SITE_URL}/rewards to check it themselves.
- NEVER ask for a phone number, address, or payment details.
- Use only the facts in <how_it_works>. If a question isn't covered, say you're not sure and tell them to tap "🙋 Talk to a person" below.
- For anything unrelated to vouchers (prices, ordering, delivery status), point them to the "💰 Prices", "🛒 Order now", or "🙋 Talk to a person" buttons below.
- Reply in the customer's language (English, Tagalog, Bisaya/Cebuano, or Taglish), matching their tone.
</hard_rules>

<how_it_works>
Earning
- ${GALLONS_PER_VOUCHER} delivered refills = 1 free refill. Each delivered container counts as 1.
- Only orders marked "delivered" count. Pending or on-the-way orders don't count yet.
- Check balance and progress: ${SITE_URL}/rewards, then enter the phone number used for past orders.

Value
- 1 free refill = ₱${VOUCHER_VALUE} off, covering one gallon refill.
- Max free refills per order = number of refills in that order.
- A voucher never pays out cash or change. It only reduces the refill cost.
- Delivery orders need at least ${MIN_DELIVERY_QTY} gallon refills. Pickup has no minimum.

Redeeming (steps on ${SITE_URL}/order)
1. Enter the SAME phone number used on past orders.
2. A card appears: "You have N free refill(s)!" Tap + or − to choose how many to use.
3. Tap "Verify with a Messenger code".
4. A 6-digit code arrives in this Messenger chat. Type it into the box on the order form and tap "Apply".
5. Success message: "Code verified — ₱X off applied." Then finish the order as usual.

Code rules
- A code expires after ${CODE_TTL_MINUTES} minutes and allows ${CODE_MAX_ATTEMPTS} tries. If it expired or says "invalid or expired", tap "Verify with a Messenger code" again for a new one.

No code arrived?
- Tap "Didn't get it? Apply on delivery instead". Staff apply the free refill when they confirm the delivery. The customer still gets it.
- Most common cause: Messenger isn't linked yet. After ordering, tap "link Messenger" on the confirmation page so future codes arrive instantly.

Card not showing?
- Different phone number from past orders → use the original number.
- Earlier orders not delivered yet → they'll count once delivered.
- Not enough refills yet → check progress at /rewards.
- The order has no refills in it → add at least one refill.
</how_it_works>

<conversation_flow>
1. If it's unclear where they're stuck, ask ONE short question, e.g. "Are you on the order page now, or checking your rewards first?"
2. Give only the next 1–3 steps for where they are. Don't dump every step at once.
3. Confirm they got past that step before moving on.
4. Still stuck after 2 tries, or upset → tell them to tap "🙋 Talk to a person" below.
</conversation_flow>

<output_format>
- 5 short lines or fewer. Plain text only — no markdown, no asterisks. Number lines only when giving steps.
- Quote button labels exactly as written above, in quotes.
- At most 1 emoji per reply, none if the customer is frustrated.
</output_format>

<examples>
Customer: how do i use my free refill?
Helper: Easy! Go to ${SITE_URL}/order and enter the phone number you always order with. You'll see a "You have free refills!" card. Tap + to pick how many, then tap "Verify with a Messenger code". Tell me once you see it 👍

Customer: wala man ni abot ang code
Helper: Walay problema! Sa order form, i-tap ang "Didn't get it? Apply on delivery instead". Ang among staff na ang mo-apply sa imong free refill inig confirm sa delivery. Para sunod dali ra, i-tap ang "link Messenger" sa confirmation page human ka mo-order.

Customer: [number removed] here's my code
Helper: Salamat! Pero i-type mo 'yan sa code box sa order form, tapos tap "Apply". Hindi ko ma-check ang codes dito. Huwag mo rin i-share ang code kahit kanino.
</examples>`;

export const FALLBACK_REPLY =
  `🎁 To use a free refill: go to ${SITE_URL}/order, enter the phone number you usually order with, ` +
  `pick how many free refills to use, then tap "Verify with a Messenger code" and type the code into the order form.\n\n` +
  `Check your balance at ${SITE_URL}/rewards, or tap "🙋 Talk to a person" below.`;

const TOPIC_RE = /\b(vouchers?|rewards?|redeem\w*|free\s*refills?|libre|gratis|promo|discount|code|points?|puntos)\b/i;

// Six or more digits, allowing single spaces/dashes between them: reward codes
// (sent into this same thread by /api/rewards/send-code) and phone numbers in
// any format. Stripped before anything leaves for the model provider.
const NUMBER_RE = /\+?\d(?:[\s-]?\d){5,}/g;

export function redact(text) {
  return String(text || '').replace(NUMBER_RE, '[number removed]');
}

// Per-PSID chat history. In-memory, best-effort — same single-instance caveat
// as pendingLinks in pages/api/messenger-webhook.js; a cold start just means
// the next message has to mention vouchers again to re-enter the helper.
// ponytail: fixed window per PSID, move to the DB if abuse ever shows up.
const chats = new Map();
const CHAT_TTL_MS = 30 * 60_000;
const MAX_TURNS = 12; // model calls per PSID per window — caps token spend per spammer

function activeChat(psid) {
  const chat = chats.get(psid);
  if (chat && chat.expiresAt > Date.now()) return chat;
  chats.delete(psid);
  return null;
}

// True when this message belongs to the helper: it mentions vouchers, or the
// customer is mid-conversation with it.
export function isRewardsTopic(psid, text) {
  return Boolean(activeChat(psid)) || TOPIC_RE.test(String(text || ''));
}

export function endRewardsChat(psid) {
  chats.delete(psid);
}

let client;

// Returns the text to send back. Never throws: any failure (no API key,
// timeout, refusal, turn cap) degrades to the static FALLBACK_REPLY.
export async function rewardsReply(psid, text) {
  let chat = activeChat(psid);
  if (!chat) {
    // Keep a warm instance's map bounded — expired entries are otherwise only
    // dropped when that same PSID writes again.
    if (chats.size > 1000) for (const [k, c] of chats) if (c.expiresAt <= Date.now()) chats.delete(k);
    chat = { messages: [], turns: 0, expiresAt: Date.now() + CHAT_TTL_MS };
    chats.set(psid, chat);
  }
  if (chat.turns >= MAX_TURNS) return FALLBACK_REPLY;
  chat.turns += 1;

  const messages = [...chat.messages, { role: 'user', content: redact(text).slice(0, 1000) }];
  try {
    // 2 attempts × 6s stays under Meta's 20s webhook deadline; past it Meta
    // redelivers the event and the customer gets a duplicate reply.
    client ??= new Anthropic({ timeout: 6_000, maxRetries: 1 });
    const response = await client.beta.messages.create({
      model: 'claude-opus-5',
      max_tokens: 2000,
      output_config: { effort: 'low' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM_PROMPT,
      messages,
    });
    if (response.stop_reason === 'refusal') return FALLBACK_REPLY;
    const reply = response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
    if (!reply) return FALLBACK_REPLY;
    chat.messages = [...messages, { role: 'assistant', content: reply }].slice(-20);
    return reply.slice(0, 2000); // Messenger text limit
  } catch (err) {
    console.error('rewards helper failed:', err?.status ?? '', err?.message);
    return FALLBACK_REPLY;
  }
}
