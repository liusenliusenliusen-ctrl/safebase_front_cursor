import { expect, type Page } from "@playwright/test";

export const E2E_PASSWORD = "e2e-pass-123";

export function uniqueUsername(prefix = "e2e"): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Ant Design 按钮文案可能带空格，如「注 册」 */
export function authSubmitButton(page: Page) {
  return page.locator("form button[type='submit']");
}

/** 按可见文案点击按钮（兼容 Ant Design 字间空格，如「保 存」） */
export function buttonWithLabel(page: Page | ReturnType<Page["locator"]>, label: string) {
  const pattern = new RegExp(label.split("").join("\\s*"));
  return page.getByRole("button", { name: pattern }).first();
}

/** 在 /auth 完成注册并进入主站 */
export async function registerViaUI(
  page: Page,
  username: string,
  password = E2E_PASSWORD
): Promise<void> {
  await page.goto("/auth");
  await page.getByRole("tab", { name: "注册" }).click();
  await page.getByPlaceholder("用户名").fill(username);
  await page.getByPlaceholder("登录密码").fill(password);
  await authSubmitButton(page).click();
  await page.waitForURL("/");
  await expect(page.getByText("Safebase")).toBeVisible();
  await expect(page.getByText(username)).toBeVisible();
}
