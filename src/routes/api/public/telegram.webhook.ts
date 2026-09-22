import { createFileRoute } from "@tanstack/react-router";

import { secretsMatch } from "@/lib/timing-safe";

/**
 * ويبهوك تيليجرام: يستقبل رسائل صاحب البيزنس (بوت خاص بكل مساحة عمل) ويرد
 * بمسودة أو بنتيجة الطلب. الأمان: سرّ مشتق من توكن البوت في ترويسة تيليجرام.
 */
type TgUpdate = {
  message?: TgMessage;
  edited_message?: TgMessage;
  channel_post?: TgMessage;
};
type TgMessage = {
  chat?: { id?: number };
  from?: { id?: number };
  text?: string;
  caption?: string;
};

export const Route = createFileRoute("/api/public/telegram/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const workspaceId = new URL(request.url).searchParams.get("ws") ?? "";
        if (!/^[0-9a-f-]{36}$/i.test(workspaceId)) {
          return new Response("bad request", { status: 400 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { loadTelegramConfig, webhookSecret, telegramReply } = await import(
          "@/lib/telegram.server"
        );
        const config = await loadTelegramConfig(supabaseAdmin, workspaceId);
        if (!config) return new Response("not found", { status: 404 });

        const provided = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
        if (!secretsMatch(provided, await webhookSecret(config.botToken))) {
          return new Response("forbidden", { status: 403 });
        }

        let update: TgUpdate;
        try {
          update = (await request.json()) as TgUpdate;
        } catch {
          return new Response("bad request", { status: 400 });
        }

        const message = update.message ?? update.edited_message;
        const chatId = message?.chat?.id;
        if (!message || typeof chatId !== "number") return Response.json({ ok: true });

        const text = (message.text ?? message.caption ?? "").trim();
        try {
          if (!text) {
            await telegramReply(
              config.botToken,
              chatId,
              "أرسل طلبك نصاً من فضلك — أتعامل حالياً مع الرسائل النصية.",
            );
            return Response.json({ ok: true });
          }
          const { handleCommandMessage } = await import("@/lib/command-core.server");
          const reply = await handleCommandMessage(supabaseAdmin, {
            channel: "telegram",
            externalId: String(chatId),
            text,
          });
          await telegramReply(config.botToken, chatId, reply);
        } catch (e) {
          const detail = e instanceof Error ? e.message : "خطأ غير معروف";
          console.error("[telegram] handling failed:", detail);
          try {
            await telegramReply(
              config.botToken,
              chatId,
              `تعذّر تنفيذ الطلب: ${detail.slice(0, 300)}`,
            );
          } catch {
            /* تجاهل فشل الإبلاغ */
          }
        }

        // تيليجرام يعيد الإرسال عند أي رد غير ناجح — نرد دائماً بنجاح بعد المعالجة.
        return Response.json({ ok: true });
      },
    },
  },
});
