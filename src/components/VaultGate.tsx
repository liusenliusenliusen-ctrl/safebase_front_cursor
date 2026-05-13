import { useVaultStore } from "@/stores/vaultStore";
import { VaultUnlockModal } from "./VaultUnlockModal";

/**
 * 登录后必须解锁保险箱（内存中的 AES 密钥）才能使用日记与对话。
 */
export function VaultGate({ children }: { children: React.ReactNode }) {
  const unlocked = useVaultStore((s) => s.unlocked);

  return (
    <>
      <VaultUnlockModal open={!unlocked} onUnlocked={() => {}} />
      {unlocked ? children : null}
    </>
  );
}
