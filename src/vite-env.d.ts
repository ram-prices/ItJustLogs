/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** OAuth client ID (Web application) for Google Drive sync; unset hides the feature. See CLAUDE.md. */
  readonly VITE_GOOGLE_CLIENT_ID?: string;
}

/** The commit and UTC time of this build (vite.config.ts buildId), shown in the footer. */
declare const __BUILD__: string;
