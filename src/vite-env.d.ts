/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** OAuth client ID (Web application) for Google Drive sync; unset hides the feature. See CLAUDE.md. */
  readonly VITE_GOOGLE_CLIENT_ID?: string;
}
