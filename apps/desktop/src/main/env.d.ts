/// <reference types="electron-vite/node" />

interface ImportMetaEnv {
  readonly MAIN_VITE_WORKOS_CLIENT_ID: string
  readonly MAIN_VITE_API_ENV: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
