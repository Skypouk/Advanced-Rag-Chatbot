/// <reference types="vite/client" />

/** Environment variables exposed to the client bundle. */
interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
