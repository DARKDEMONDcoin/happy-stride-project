/**
 * تكامل تيليجرام المباشر (بلا وسيط): بوت خاص بكل مساحة عمل.
 * التوكن يُخزَّن مشفّراً في integration_credentials، والنشر والاستقبال يتمّان عبر Bot API.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";

type Admin = SupabaseClient<Database>;

export type TelegramConfig = {
  /** توكن بوت العميل، أو فارغ عند استخدام بوت سهل المشترك. */
  botToken: string;
  /** true عندما تستخدم مساحة العمل بوت سهل الجاهز بدل بوت خاص. */
  shared?: boolean;
  botUsername?: string;
  chatId: string;
  chatTitle?: string;
};

const API = "https://api.telegram.org";

/** الأصل العام الثابت للمشروع — تيليجرام يتطلب رابط https يمكنه الوصول إليه. */
const PROJECT_ID = "03e4d277-af75-46c7-a00d-9e0a26303b1f";
export function publicOrigin(): string {
  const fromEnv = (process.env["PUBLIC_APP_ORIGIN"] ?? "").trim().replace(/\/+$/, "");
  if (fromEnv.startsWith("https://")) return fromEnv;
  return `https://project--${PROJECT_ID}-dev.lovable.app`;
}

export function webhookUrlFor(workspaceId: string): string {
  return `${publicOrigin()}/api/public/telegram/webhook?ws=${workspaceId}`;
}

/** ويبهوك واحد لبوت سهل المشترك — نستنتج مساحة العمل من المحادثة نفسها. */
export function sharedWebhookUrl(): string {
  return `${publicOrigin()}/api/public/telegram/webhook?shared=1`;
}

/** توكن بوت سهل الجاهز (اختياري) — يسمح بالنشر بلا إنشاء بوت من BotFather. */
export async function platformBotToken(): Promise<string> {
  const { getSecret } = await import("./secrets.server");
  return (await getSecret("TELEGRAM_BOT_TOKEN")).trim();
}

/** بيانات بوت سهل الجاهز، أو null إن لم يُضبط أو كان توكنه غير صالح. */
export async function platformBot(): Promise<{ token: string; username: string } | null> {
  const token = await platformBotToken();
  if (!token) return null;
  try {
    const me = await tg<{ username?: string }>(token, "getMe");
    return { token, username: me.username ?? "" };
  } catch (error) {
    console.error("[telegram] platform bot token invalid:", error);
    return null;
  }
}

/** سرّ التحقق من الويبهوك، مشتق من توكن البوت نفسه (لا نخزّن سرّاً إضافياً). */
export async function webhookSecret(botToken: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`telegram-webhook:${botToken}`),
  );
  let binary = "";
  for (const b of new Uint8Array(digest)) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** نداء عام على Bot API مع رسائل خطأ عربية مفهومة. */
export async function tg<T = unknown>(
  botToken: string,
  method: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(`${API}/bot${botToken}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  let payload: { ok?: boolean; result?: T; description?: string } = {};
  try {
    payload = JSON.parse(text) as typeof payload;
  } catch {
    throw new Error(`رد غير متوقع من تيليجرام [${response.status}]: ${text.slice(0, 200)}`);
  }
  if (!response.ok || payload.ok !== true) {
    const detail = payload.description ?? text.slice(0, 200);
    console.error(`[telegram] ${method} failed [${response.status}]: ${detail}`);
    if (/unauthorized/i.test(detail)) {
      throw new Error("توكن البوت غير صحيح — انسخه من BotFather مرة أخرى.");
    }
    if (/chat not found/i.test(detail)) {
      throw new Error(
        "لم نجد القناة — أضف البوت مشرفاً في قناتك وانشر فيها أي رسالة، ثم اضغط «اكتشف» لاختيار القناة بدل كتابة المعرّف.",
      );
    }
    if (/not enough rights|administrator/i.test(detail)) {
      throw new Error("البوت ليس مشرفاً في القناة — أضفه كمشرف بصلاحية نشر الرسائل.");
    }
    throw new Error(`تيليجرام رفض الطلب: ${detail}`);
  }
  return payload.result as T;
}

/** بيانات ربط تيليجرام لمساحة عمل (مفكوكة التشفير). */
export async function loadTelegramConfig(
  admin: Admin,
  workspaceId: string,
): Promise<TelegramConfig | null> {
  const { data } = await admin
    .from("integration_credentials")
    .select("config")
    .eq("workspace_id", workspaceId)
    .eq("provider", "telegram")
    .maybeSingle();
  const { openConfig } = await import("./credential-crypto.server");
  const config = await openConfig<TelegramConfig>(data?.config);
  if (!config?.botToken) return null;
  return config;
}

export async function saveTelegramConfig(
  admin: Admin,
  workspaceId: string,
  config: TelegramConfig,
) {
  const { sealConfig } = await import("./credential-crypto.server");
  const { error } = await admin.from("integration_credentials").upsert(
    {
      workspace_id: workspaceId,
      provider: "telegram",
      config: await sealConfig(config as unknown as Record<string, unknown>),
    },
    { onConflict: "workspace_id,provider" },
  );
  if (error) throw new Error(error.message);

  const account = config.chatTitle ?? config.chatId;
  const { data: updated } = await admin
    .from("integrations")
    .update({ status: "connected", account })
    .eq("workspace_id", workspaceId)
    .eq("provider", "telegram")
    .select("id");
  if (!updated?.length) {
    await admin.from("integrations").insert({
      workspace_id: workspaceId,
      employee_id: "eva",
      provider: "telegram",
      status: "connected",
      account,
    });
  }
}

/** يسجّل ويبهوك البوت ليصل كلام صاحب العمل إلى الفريق. */
export async function registerWebhook(workspaceId: string, botToken: string) {
  await tg(botToken, "setWebhook", {
    url: webhookUrlFor(workspaceId),
    secret_token: await webhookSecret(botToken),
    allowed_updates: ["message", "edited_message", "channel_post"],
    drop_pending_updates: true,
  });
}

/** النشر على قناة/مجموعة تيليجرام: صورة بتعليق أو نص. */
export async function telegramPublish(
  admin: Admin,
  workspaceId: string,
  input: { text: string; imageUrl?: string },
): Promise<{ chatId: string; messageId: number }> {
  const config = await loadTelegramConfig(admin, workspaceId);
  if (!config) throw new Error("تيليجرام غير مربوط بعد — اربطه من الإعدادات ← تيليجرام.");

  const text = input.text.trim();
  if (!text && !input.imageUrl) throw new Error("لا يوجد نص للنشر.");

  // حدود تيليجرام: 4096 حرفاً للرسالة، 1024 لتعليق الصورة.
  if (input.imageUrl && text.length <= 1024) {
    const sent = await tg<{ message_id: number }>(config.botToken, "sendPhoto", {
      chat_id: config.chatId,
      photo: input.imageUrl,
      caption: text || undefined,
    });
    return { chatId: config.chatId, messageId: sent.message_id };
  }

  if (input.imageUrl) {
    await tg(config.botToken, "sendPhoto", { chat_id: config.chatId, photo: input.imageUrl });
  }
  if (text.length > 4096) {
    throw new Error(`نص تيليجرام ${text.length} حرفاً والحد 4096 — اختصره ثم أعد النشر.`);
  }
  const sent = await tg<{ message_id: number }>(config.botToken, "sendMessage", {
    chat_id: config.chatId,
    text,
    disable_web_page_preview: false,
  });
  return { chatId: config.chatId, messageId: sent.message_id };
}

/** رسالة خاصة لأي دردشة (الردود على أوامر صاحب العمل والإشعارات). */
export async function telegramReply(botToken: string, chatId: string | number, text: string) {
  const body = text.length > 4096 ? `${text.slice(0, 4080)}…` : text;
  await tg(botToken, "sendMessage", { chat_id: chatId, text: body });
}

/**
 * يكتشف الدردشات/القنوات المتاحة للبوت من آخر التحديثات.
 * تيليجرام لا يمنح قائمة قنوات؛ لذلك نقرأ آخر الرسائل بعد إيقاف الويبهوك مؤقتاً.
 */
export async function discoverChats(
  botToken: string,
): Promise<{ id: string; title: string; type: string }[]> {
  await tg(botToken, "deleteWebhook", { drop_pending_updates: false }).catch(() => null);
  type Chat = { id: number; title?: string; username?: string; first_name?: string; type?: string };
  const updates = await tg<{ message?: { chat?: Chat }; channel_post?: { chat?: Chat }; my_chat_member?: { chat?: Chat } }[]>(
    botToken,
    "getUpdates",
    { limit: 100, timeout: 0 },
  );
  const seen = new Map<string, { id: string; title: string; type: string }>();
  for (const update of updates) {
    const chat = update.channel_post?.chat ?? update.message?.chat ?? update.my_chat_member?.chat;
    if (!chat?.id) continue;
    const id = String(chat.id);
    if (seen.has(id)) continue;
    seen.set(id, {
      id,
      title: chat.title ?? (chat.username ? `@${chat.username}` : (chat.first_name ?? id)),
      type: chat.type ?? "chat",
    });
  }
  return [...seen.values()];
}
