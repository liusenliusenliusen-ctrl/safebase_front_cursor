import { test, expect } from "@playwright/test";
import { registerViaUI, uniqueUsername, buttonWithLabel } from "./helpers";

test.describe("对话", () => {
  test("发送后用户消息立即显示，并收到助手回复", async ({ page }) => {
    test.slow();
    const username = uniqueUsername("chat");
    await registerViaUI(page, username);

    const userMsg = `E2E 对话测试 ${Date.now()}`;
    const input = page.getByPlaceholder("在这里写下你想说的…");
    await input.fill(userMsg);
    await buttonWithLabel(page, "发送").click();

    // 用户消息应立刻出现在列表中（不必等模型）
    await expect(page.getByText(userMsg, { exact: true })).toBeVisible({
      timeout: 8_000,
    });

    const messageList = page
      .locator('div[style*="overflow: auto"]')
      .filter({ has: page.getByText(userMsg, { exact: true }) });

    // 先进入流式阶段（思考或光标）
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
        { timeout: 20_000, intervals: [200, 500, 1000] }
      )
      .toBe(true);

    // 等待助手回复完成（依赖 OPENROUTER_API_KEY）
    await expect
      .poll(
        async () => {
          const text = await messageList.innerText();
          const rest = text
            .replace(userMsg, "")
            .replace(/正在思考…/g, "")
            .trim();
          const streaming = (await messageList.locator(".stream-cursor").count()) > 0;
          return !streaming && rest.length > 8;
        },
        { timeout: 90_000, intervals: [1000, 2000, 3000] }
      )
      .toBe(true);
  });
});
