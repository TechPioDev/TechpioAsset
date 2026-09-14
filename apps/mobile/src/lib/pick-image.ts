import type { ApiClient } from './api-client';

/**
 * Choosing a saved photo, and sending a bill photo to POST /invoices/upload.
 *
 * Used by "Scan from a photo" (scan tab), "Choose from gallery" (invoices list
 * and capture tab). Not unit-tested: it is a thin wrapper over native modules.
 */

export interface PickedImage {
  uri: string;
  name: string;
  type: string;
}

export type PickOutcome =
  | { kind: 'picked'; image: PickedImage }
  | { kind: 'cancelled' }
  | { kind: 'denied' }
  /** The installed app predates the picker (an older APK running newer JS). */
  | { kind: 'unavailable' };

export const PICKER_UNAVAILABLE_MESSAGE =
  'Choosing a saved photo needs the latest version of the app. Update PioAssets and try again.';

/**
 * Opens the system photo picker for one image.
 *
 * Loaded on demand rather than imported at the top: expo-image-picker is a
 * native module, and a static import in a build without it throws while the
 * screen module loads - taking the whole scan tab down, not just this button.
 *
 * No permission is requested first. Android 13+ and iOS 14+ hand the app only
 * the photo the person chose through the system picker, which needs none; older
 * systems prompt from inside launchImageLibraryAsync and reject if refused.
 */
export async function pickImageFromLibrary(): Promise<PickOutcome> {
  let ImagePicker: typeof import('expo-image-picker');
  try {
    ImagePicker = await import('expo-image-picker');
  } catch {
    return { kind: 'unavailable' };
  }
  try {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: false,
      // Below 1 so iOS re-encodes HEIC as JPEG, which every reader here takes.
      quality: 0.8,
      exif: false,
    });
    const asset = result.canceled ? null : result.assets?.[0];
    if (!asset?.uri) return { kind: 'cancelled' };
    const type = asset.mimeType ?? 'image/jpeg';
    const extension = type === 'image/png' ? 'png' : 'jpg';
    return {
      kind: 'picked',
      image: { uri: asset.uri, name: asset.fileName ?? `photo-${Date.now()}.${extension}`, type },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/permission/i.test(message)) return { kind: 'denied' };
    return { kind: 'unavailable' };
  }
}

export interface InvoiceUploadResult {
  invoice: { id: string; invoiceNumber: string; verificationStatus: string };
  extraction: { ran: boolean; simulated: boolean; reason?: string };
}

/** POST /invoices/upload with one photo (INVOICES_UPLOAD on the server). */
export function uploadInvoiceImage(
  api: ApiClient,
  image: PickedImage,
): Promise<InvoiceUploadResult> {
  const form = new FormData();
  // React Native's FormData accepts a { uri, name, type } file descriptor.
  form.append('file', image as unknown as Blob);
  return api.request<InvoiceUploadResult>('/invoices/upload', { formData: form });
}
