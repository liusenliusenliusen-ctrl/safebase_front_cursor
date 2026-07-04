import { test, expect } from "@playwright/test";
import { E2E_PASSWORD, authSubmitButton, registerViaUI, uniqueUsername } from "./helpers";

test.describe("注册与登录", () => {
  test("新用户注册后进入对话页", async ({ page }) => {
    const username = uniqueUsername("reg");
    await registerViaUI(page, username);
    await expect(page.getByRole("link", { name: "对话" })).toBeVisible();
    await expect(page.getByPlaceholder("在这里写下你想说的…")).toBeVisible();
  });

  test("已注册用户可登录", async ({ page }) => {
    const username = uniqueUsername("login");
    await registerViaUI(page, username);

    await page.getByRole("button", { name: "退出登录" }).click();
    await page.waitForURL("/auth");

    await page.getByRole("tab", { name: "登录" }).click();
    await page.getByPlaceholder("用户名").fill(username);
    await page.getByPlaceholder("登录密码").fill(E2E_PASSWORD);
    await authSubmitButton(page).click();
    await page.waitForURL("/");
    await expect(page.getByText(username)).toBeVisible();
  });
});
