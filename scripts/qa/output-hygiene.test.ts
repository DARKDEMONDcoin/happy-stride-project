import { expect, test } from "bun:test";
import { extractImagePrompt, stripImagePrompt } from "../../src/lib/image-gen.server";
import { scorePost } from "../../src/lib/post-quality";

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
