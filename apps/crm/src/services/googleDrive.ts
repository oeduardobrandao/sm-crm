// apps/crm/src/services/googleDrive.ts

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string;
const APP_ID = import.meta.env.VITE_GOOGLE_APP_ID as string;
const API_KEY = import.meta.env.VITE_GOOGLE_API_KEY as string;

const SCOPES = 'https://www.googleapis.com/auth/drive.readonly';

const ACCEPTED_MIME_TYPES = [
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'video/mp4', 'video/quicktime', 'video/webm',
  'application/pdf',
];

let gapiLoaded = false;
let gisLoaded = false;
let accessToken: string | null = null;
let tokenClient: google.accounts.oauth2.TokenClient | null = null;

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  thumbnailUrl: string | null;
  viewUrl: string;
  width: number | null;
  height: number | null;
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const script = document.createElement('script');
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

export async function loadPickerSdk(): Promise<void> {
  if (!gapiLoaded) {
    await loadScript('https://apis.google.com/js/api.js');
    await new Promise<void>((resolve) => gapi.load('picker', resolve));
    gapiLoaded = true;
  }
  if (!gisLoaded) {
    await loadScript('https://accounts.google.com/gsi/client');
    gisLoaded = true;
  }
}

function requestAccessToken(): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!tokenClient) {
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: (response) => {
          if (response.error) { reject(new Error(response.error)); return; }
          accessToken = response.access_token;
          resolve(response.access_token);
        },
      });
    }
    tokenClient.requestAccessToken({ prompt: accessToken ? '' : 'consent' });
  });
}

async function getAccessToken(): Promise<string> {
  if (accessToken) return accessToken;
  return requestAccessToken();
}

export async function openPicker(): Promise<DriveFile[]> {
  await loadPickerSdk();
  const token = await getAccessToken();

  return new Promise((resolve) => {
    const view = new google.picker.DocsView()
      .setIncludeFolders(true)
      .setSelectFolderEnabled(false)
      .setMimeTypes(ACCEPTED_MIME_TYPES.join(','));

    const picker = new google.picker.PickerBuilder()
      .setAppId(APP_ID)
      .setOAuthToken(token)
      .setDeveloperKey(API_KEY)
      .addView(view)
      .enableFeature(google.picker.Feature.MULTISELECT_ENABLED)
      .setCallback((data: google.picker.ResponseObject) => {
        if (data.action === google.picker.Action.PICKED) {
          const files: DriveFile[] = data.docs.map((doc) => ({
            id: doc.id,
            name: doc.name,
            mimeType: doc.mimeType,
            sizeBytes: doc.sizeBytes ?? 0,
            thumbnailUrl: doc.thumbnails?.[0]?.url
              ?? `https://lh3.googleusercontent.com/d/${doc.id}=s400`,
            viewUrl: doc.url,
            width: doc.mediaMetadata?.width ?? null,
            height: doc.mediaMetadata?.height ?? null,
          }));
          resolve(files);
        } else if (data.action === google.picker.Action.CANCEL) {
          resolve([]);
        }
      })
      .build();

    picker.setVisible(true);
  });
}

export function revokeAccess(): void {
  if (accessToken) {
    google.accounts.oauth2.revoke(accessToken, () => {});
    accessToken = null;
  }
}
