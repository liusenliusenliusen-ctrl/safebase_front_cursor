import { test, expect } from "@playwright/test";
import { registerViaUI, uniqueUsername, buttonWithLabel } from "./helpers";

test.describe("日记", () => {
  test("创建日记并在列表中展示", async ({ page }) => {
    const username = uniqueUsername("diary");
    await registerViaUI(page, username);

    await page.getByRole("link", { name: "日记" }).click();
    await page.waitForURL("/diary");
    await expect(page.getByRole("heading", { name: "我的日记" })).toBeVisible();

    const title = `E2E 日记标题 ${Date.now()}`;
    const content = `E2E 日记正文：今天完成了一次自动化测试。`;

    await buttonWithLabel(page, "写日记").click();
    const drawer = page.getByRole("dialog", { name: "写日记" });
    await expect(drawer).toBeVisible();

    await drawer.getByPlaceholder("一句话标题，也可以留空").fill(title);
    await drawer.getByPlaceholder("写下今天想说的…").fill(content);
    await buttonWithLabel(drawer, "保存").click();
    await expect(drawer).toBeHidden({ timeout: 10_000 });

    await expect(page.getByText(title)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(content.slice(0, 12))).toBeVisible();
  });
});
