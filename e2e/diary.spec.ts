import { test, expect } from "@playwright/test";
import { registerViaUI, uniqueUsername } from "./helpers";

test.describe("日记", () => {
  test("连续日记：书写今天并在日期栏可见", async ({ page }) => {
    const username = uniqueUsername("diary");
    await registerViaUI(page, username);

    await page.getByRole("link", { name: "日记" }).click();
    await page.waitForURL("/diary");
    await expect(page.getByRole("heading", { name: "日记" })).toBeVisible();

    const content = `E2E 连续日记：今天完成了一次自动化测试。${Date.now()}`;
    const todayArea = page.locator("textarea.journal-textarea").last();
    await expect(todayArea).toBeVisible({ timeout: 10_000 });
    await todayArea.fill(content);

    await expect(page.getByText("已保存").first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(".journal-dates")).toBeVisible();
    await expect(page.getByText(content.slice(0, 18))).toBeVisible();
  });
});
