/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  /** The Mini App's direct link (https://t.me/<bot>/<app>); platform/deeplink.ts has the default. */
  readonly VITE_TG_APP_LINK?: string;
}
