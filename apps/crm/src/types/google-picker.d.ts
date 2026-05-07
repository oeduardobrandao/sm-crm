// apps/crm/src/types/google-picker.d.ts

declare namespace google.accounts.oauth2 {
  interface TokenClient {
    requestAccessToken(opts?: { prompt?: string }): void;
  }
  interface TokenResponse {
    access_token: string;
    error?: string;
  }
  function initTokenClient(config: {
    client_id: string;
    scope: string;
    callback: (response: TokenResponse) => void;
  }): TokenClient;
  function revoke(token: string, callback: () => void): void;
}

declare namespace google.picker {
  enum Action { PICKED = 'picked', CANCEL = 'cancel' }
  enum Feature { MULTISELECT_ENABLED = 'multiselect' }

  interface ResponseObject {
    action: Action;
    docs: PickerDocument[];
  }

  interface PickerDocument {
    id: string;
    name: string;
    mimeType: string;
    sizeBytes?: number;
    url: string;
    thumbnails?: { url: string }[];
    mediaMetadata?: { width?: number; height?: number };
  }

  class DocsView {
    constructor();
    setIncludeFolders(include: boolean): this;
    setSelectFolderEnabled(enabled: boolean): this;
    setMimeTypes(mimeTypes: string): this;
  }

  class PickerBuilder {
    setAppId(appId: string): this;
    setOAuthToken(token: string): this;
    setDeveloperKey(key: string): this;
    addView(view: DocsView): this;
    enableFeature(feature: Feature): this;
    setCallback(callback: (data: ResponseObject) => void): this;
    build(): Picker;
  }

  interface Picker {
    setVisible(visible: boolean): void;
    dispose(): void;
  }
}

declare namespace gapi {
  function load(api: string, callback: () => void): void;
}
