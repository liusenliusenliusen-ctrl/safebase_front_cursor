import { create } from "zustand";
import {
  decrypt,
  deriveKeyFromPasswordBase64Salt,
  encrypt,
  generateUserSaltBase64,
  VAULT_VERIFIER_PLAINTEXT,
} from "@/lib/encryption";
import { supabase } from "@/lib/supabase";

interface VaultState {
  cryptoKey: CryptoKey | null;
  unlocked: boolean;
  userSaltB64: string | null;
  error: string | null;
  clearError: () => void;
  lock: () => void;
  unlockWithMasterPassword: (masterPassword: string) => Promise<void>;
}

export const useVaultStore = create<VaultState>((set) => ({
  cryptoKey: null,
  unlocked: false,
  userSaltB64: null,
  error: null,
  clearError: () => set({ error: null }),
  lock: () =>
    set({
      cryptoKey: null,
      unlocked: false,
      userSaltB64: null,
    }),
  unlockWithMasterPassword: async (masterPassword: string) => {
    set({ error: null });
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      set({ error: "未登录" });
      return;
    }

    const { data: row, error: selErr } = await supabase
      .from("user_crypto")
      .select("salt, verifier_ciphertext, verifier_iv, verifier_salt")
      .eq("user_id", user.id)
      .maybeSingle();

    if (selErr) {
      set({ error: selErr.message });
      return;
    }

    try {
      if (!row?.salt) {
        const saltB64 = generateUserSaltBase64();
        const cryptoKey = await deriveKeyFromPasswordBase64Salt(
          masterPassword,
          saltB64
        );
        const ver = await encrypt(VAULT_VERIFIER_PLAINTEXT, cryptoKey);
        const { error: insErr } = await supabase.from("user_crypto").insert({
          user_id: user.id,
          salt: saltB64,
          verifier_ciphertext: ver.ciphertextB64,
          verifier_iv: ver.ivB64,
          verifier_salt: ver.saltB64,
        });
        if (insErr) {
          set({ error: insErr.message });
          return;
        }
        set({ cryptoKey, unlocked: true, userSaltB64: saltB64 });
        return;
      }

      const saltB64 = row.salt as string;
      const cryptoKey = await deriveKeyFromPasswordBase64Salt(
        masterPassword,
        saltB64
      );

      const vCipher = row.verifier_ciphertext as string | null;
      const vIv = row.verifier_iv as string | null;
      const vSalt = row.verifier_salt as string | null;

      if (!vCipher || !vIv || !vSalt) {
        set({
          error:
            "保险箱校验数据不完整，请在 Supabase Studio 删除该用户的 user_crypto 行后重新设置主密码",
        });
        return;
      }
      const plain = await decrypt(
        { ciphertextB64: vCipher, ivB64: vIv, saltB64: vSalt },
        cryptoKey
      );
      if (plain !== VAULT_VERIFIER_PLAINTEXT) {
        set({ error: "保险箱密码错误" });
        return;
      }

      set({ cryptoKey, unlocked: true, userSaltB64: saltB64 });
    } catch {
      set({ error: "保险箱密码错误" });
    }
  },
}));
