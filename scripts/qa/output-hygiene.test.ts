import { expect, test } from "bun:test";
import { extractImagePrompt, stripImagePrompt } from "../../src/lib/image-gen.server";
import { scorePost } from "../../src/lib/post-quality";
import { extractPostText, sanitizePostBody } from "../../src/lib/post-format";

const output =
  "# عنوان المنشور\n\nنص عربي جاهز للنشر يحمل وعداً واضحاً.\n\n**وصف الصورة:** A cinematic photo of an Arabic coffee shop, warm light, shallow depth of field.\n\nخاتمة عربية.";

test("authored image prompt is used then removed from the delivered text", () => {
  expect(extractImagePrompt(output)).toContain("cinematic photo");
  const cleaned = stripImagePrompt(output);
  expect(cleaned).not.toContain("cinematic photo");
  expect(cleaned).toContain("نص عربي جاهز للنشر");
  expect(cleaned).toContain("خاتمة عربية");
});

test("Arabic body content is never stripped as a prompt block", () => {
  const arabicOnly = "# عنوان\n\nفقرة عربية كاملة بلا أي برومبت.\n\n```\nمثال عربي داخل كتلة\n```";
  expect(stripImagePrompt(arabicOnly)).toContain("مثال عربي داخل كتلة");
});

test("autopilot hard blockers reject over-limit X posts before scheduling", () => {
  const report = scorePost({ text: "ن".repeat(600), provider: "x" });
  expect(report.blockers.length).toBeGreaterThan(0);
});

test("publishing strips platform strategy and measurement notes", () => {
  const dirty = `خبر موثّق وواضح للجمهور.\n\nمنشور مخصص لمنصة فيسبوك: شارك المنشور مع شخص يفضّل الخبر الموثّق على العنوان المثير (مؤشر القياس: متابعة عدد المشاركات بعد 48 ساعة).`;
  expect(sanitizePostBody(dirty)).toBe("خبر موثّق وواضح للجمهور.");
});

test("an explicit post section wins over longer employee commentary", () => {
  const response = `## نص المنشور\n\nعرض ٥٠٪ حتى منتصف الليل. اطلب الآن.\n\n## التوقيت والقياس\n\nهذا شرح طويل جداً موجّه لصاحب العمل عن توقيت النشر ومؤشرات القياس ولا يجب أن يدخل المنشور أبداً.`;
  expect(extractPostText(response)).toBe("عرض ٥٠٪ حتى منتصف الليل. اطلب الآن.");
});

test("Telegram uses its real message limit", () => {
  const report = scorePost({ text: "ن".repeat(4097), provider: "telegram", hasMedia: false });
  expect(report.blockers.some((check) => check.id === "limit")).toBe(true);
});
