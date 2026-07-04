import { test, expect } from "@playwright/test";
import { registerViaUI, uniqueUsername, buttonWithLabel } from "./helpers";

/** 长自述 E2E（多段年份与关系创伤关键词） */
const LONG_INTAKE = `你好，疗愈伴侣，我跟你说一说我大概的情况。我是男性，35岁，1991年出生，我在2020年-2022年经历了两段感情，基本上不到一年就结束了。我感觉我并不是很喜欢她们。然后我在2024年的时候通过交友软件遇到了一个NPD，我们并未确定情侣关系，但她让我体会到前所未有的痛苦。似乎心里某个重要的东西崩塌了。
后来我才知道，她是显性NPD，她持续地进行贬低、三角测量、服从性测试，以及大量倾倒情绪垃圾。把我弄得几乎抑郁。后来我实在受不了了终于下定决心断连了。
当时似乎整个价值体系崩塌了，而其实在之前的三十多年里，这个体系一直摇摇欲坠。
后来我开始反思，我开始了解了NPD的概念，我开始研究心理学，我开始意识到自己带着很多未愈的创伤。我开始疗愈自己的痛苦。
到2025年，我觉得我似乎走出来了。然后我又经历了刻骨铭心痛彻心扉的一段关系。这段关系中，女生是我很早就认识的。2018年我们是同事。我追求过她很多次，但是她都拒绝了。但是并没有明确拒绝，也不说明原因。每次被拒绝我都很难受。后来断断续续地联系，到2025年我发现她似乎又对我很感兴趣。于是我提出在一起，然后她答应了。我当时很开心，并没有多想。
但是后来当我们发生了一次边缘性行为，她告诉我她在2022年左右跟其他人在一起过，并且发生过关系。这让我又突然非常痛苦，茶饭不思夜不能寐。几个月来几乎都不能睡好觉。`;

const DEPTH_SIGNALS = [
  "NPD",
  "价值",
  "拒绝",
  "2024",
  "2025",
  "茶饭",
  "模式",
  "创伤",
  "崩塌",
];

function countDepthSignals(text: string): number {
  return DEPTH_SIGNALS.filter((s) => text.includes(s)).length;
}

async function waitForAssistantReply(
  page: import("@playwright/test").Page,
  userMsg: string
): Promise<string> {
  const messageList = page
    .locator('div[style*="overflow: auto"]')
    .filter({ has: page.getByText(userMsg, { exact: false }).first() });

  await expect
    .poll(
      async () => {
        const thinking = await messageList
          .getByText("正在思考…")
          .isVisible()
          .catch(() => false);
        const cursor = await messageList
          .locator(".stream-cursor")
          .isVisible()
          .catch(() => false);
        return thinking || cursor;
      },
      { timeout: 45_000, intervals: [300, 500, 1000] }
    )
    .toBe(true);

  await expect
    .poll(
      async () => {
        const text = await messageList.innerText();
        const rest = text
          .replace(userMsg, "")
          .replace(/正在思考…/g, "")
          .trim();
        const streaming =
          (await messageList.locator(".stream-cursor").count()) > 0;
        return !streaming && rest.length > 8;
      },
      { timeout: 300_000, intervals: [2000, 3000, 5000] }
    )
    .toBe(true);

  const full = await messageList.innerText();
  return full.replace(userMsg, "").replace(/正在思考…/g, "").trim();
}

test.describe("对话深度", () => {
  test("长自述应收到整合型深度回复（非泛化短答）", async ({ page }) => {
    test.setTimeout(360_000);
    test.slow();

    const username = uniqueUsername("depth");
    await registerViaUI(page, username);

    const input = page.getByPlaceholder("在这里写下你想说的…");
    await input.fill(LONG_INTAKE);
    await buttonWithLabel(page, "发送").click();

    await expect(page.getByText(LONG_INTAKE.slice(0, 40))).toBeVisible({
      timeout: 10_000,
    });

    const reply = await waitForAssistantReply(page, LONG_INTAKE.slice(0, 40));

    expect(reply.length).toBeGreaterThanOrEqual(380);
    expect(countDepthSignals(reply)).toBeGreaterThanOrEqual(3);
    expect(reply).not.toMatch(/^[^。]{0,120}吗？\s*$/);
  });
});
