import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, CheckCircle2, Loader2, Wand2, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { scorePost } from "@/lib/post-quality";
import { improvePostQuality } from "@/lib/post-improve.functions";

type Props = {
  text: string;
  providers: string[];
  hasMedia: boolean;
  bannedWords?: string[];
  tone?: string | undefined;
  industry?: string | undefined;
  /** عند تمريرها تظهر أداة إعادة الكتابة التلقائية. */
  onApply?: (text: string) => void;
};

/**
 * فحص ما قبل النشر: لا درجات ولا كلام إنشائي — مشاكل حقيقية فقط
 * (تجاوز حد المنصة، كلمة ممنوعة، غياب دعوة للفعل…) وزر يعيد الكتابة فعلياً.
 * حين لا توجد مشكلة تظهر سطر واحد فقط ولا تشغل مساحة.
 */
export function PostQuality({
  text,
  providers,
  hasMedia,
  bannedWords = [],
  tone,
  industry,
  onApply,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [variants, setVariants] = useState<
    { text: string; score: number; angle?: string | undefined }[]
  >([]);
  const runImprove = useServerFn(improvePostQuality);

  const reports = useMemo(() => {
    const list = providers.length ? providers : ["facebook"];
    return list
      .map((provider) => scorePost({ text, provider, hasMedia, bannedWords }))
      .sort((a, b) => a.score - b.score);
  }, [text, providers, hasMedia, bannedWords]);

  const weakest = reports[0];

  /** المشاكل الفعلية فقط، بلا تكرار بين المنصات. */
  const issues = useMemo(() => {
    const seen = new Set<string>();
    const out: { key: string; severity: "fail" | "warn"; label: string; hint: string }[] = [];
    for (const report of reports) {
      for (const check of report.checks) {
        if (check.severity === "pass") continue;
        const key = `${check.id}:${check.hint}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          key,
          severity: check.severity === "fail" ? "fail" : "warn",
          label: report.providerLabel,
          hint: check.hint,
        });
      }
    }
    return out.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "fail" ? -1 : 1));
  }, [reports]);

  const improve = async () => {
    if (!weakest) return;
    setBusy(true);
    setError("");
    setVariants([]);
    try {
      const res = await runImprove({
        data: {
          text,
          provider: weakest.provider,
          hasMedia,
          bannedWords,
          ...(tone ? { tone } : {}),
          ...(industry ? { industry } : {}),
          variants: 2,
        },
      });
      if (!res.variants.length) setError("تعذّر توليد نسخة أفضل الآن — جرّب مرة أخرى بعد قليل.");
      setVariants(res.variants.map((v) => ({ text: v.text, score: v.score, angle: v.angle })));
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "تعذّرت إعادة الكتابة الآن — تحقّق من الاتصال وأعد المحاولة.",
      );
    } finally {
      setBusy(false);
    }
  };

  if (!weakest || !text.trim()) return null;

  const failures = issues.filter((i) => i.severity === "fail").length;

  return (
    <div className="mt-3">
      {issues.length ? (
        <div className="rounded-xl border border-border bg-card/70 p-3">
          <div className="flex items-center gap-2 text-[11px] font-bold">
            {failures ? (
              <XCircle className="size-3.5 text-coral" />
            ) : (
              <AlertTriangle className="size-3.5 text-gold-deep" />
            )}
            <span>
              {failures
                ? `${failures} مشكلة تمنع نشراً ناجحاً`
                : `${issues.length} ملاحظة قد ترفع النتيجة`}
            </span>
          </div>
          <ul className="mt-2 space-y-1.5">
            {issues.slice(0, 5).map((item) => (
              <li key={item.key} className="flex items-start gap-1.5 text-[11px] leading-relaxed">
                {item.severity === "fail" ? (
                  <XCircle className="mt-0.5 size-3.5 shrink-0 text-coral" />
                ) : (
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-gold-deep" />
                )}
                <span className="text-ink-soft">
                  {reports.length > 1 ? <span className="font-bold">{item.label} — </span> : null}
                  {item.hint}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <CheckCircle2 className="size-3.5 text-jade-deep" />
          المنشور مطابق لحدود المنصات المختارة — جاهز للنشر.
        </p>
      )}

      {onApply && issues.length ? (
        <div className="mt-2">
          <Button
            type="button"
            onClick={improve}
            disabled={busy}
            variant="outline"
            size="sm"
            className="h-8 rounded-full text-[11px] font-bold"
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Wand2 className="size-3.5" />}
            {busy ? "أعيد الكتابة…" : "أعد كتابته بشكل أفضل"}
          </Button>
          {error ? <p className="mt-2 text-[11px] font-bold text-coral">{error}</p> : null}
          {variants.length ? (
            <div className="mt-2 space-y-2">
              {variants.map((v, i) => (
                <div key={i} className="rounded-xl border border-border bg-card/70 p-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[11px] font-bold">نسخة {i + 1}</span>
                    <Button
                      type="button"
                      onClick={() => onApply(v.text)}
                      size="sm"
                      className="h-7 rounded-full px-3 text-[11px] font-bold"
                    >
                      استخدم هذه
                    </Button>
                  </div>
                  {v.angle ? (
                    <p className="mt-1 text-[10px] text-muted-foreground">{v.angle}</p>
                  ) : null}
                  <p
                    className="mt-1.5 max-h-40 overflow-auto whitespace-pre-line text-[11px] leading-relaxed text-ink-soft"
                    dir="auto"
                  >
                    {v.text}
                  </p>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
