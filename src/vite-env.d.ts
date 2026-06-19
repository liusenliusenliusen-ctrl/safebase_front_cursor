/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 留空时 dev 走 Vite proxy → http://127.0.0.1:8000 */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
