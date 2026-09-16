/**
 * A file size for people, the way the owner asked for it: kilobytes up to a
 * megabyte ("342 KB", never "0.3 MB" or "512 B"), then megabytes with one
 * decimal ("1.2 MB"). One helper for the web and the phone, so a photo reads
 * the same size in the message it was sent in and in the list it lands in.
 */
const KB = 1024;
const MB = KB * KB;

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes < MB) {
    // Anything that exists is at least 1 KB; "0 KB" would read as empty.
    return `${Math.max(1, Math.round(bytes / KB))} KB`;
  }
  return `${(bytes / MB).toFixed(1)} MB`;
}
