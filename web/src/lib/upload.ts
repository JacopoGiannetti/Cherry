import { getStorage, ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { firebaseApp } from './auth';
import { IS_MOCK } from './store';

// Foto e video delle ricette scritte a mano, nello spazio dell'utente su Storage.
// Il link di download ha un token: si mostra ovunque (anche nelle liste condivise).

const storage = () => getStorage(firebaseApp);

/** Riduce la foto a 1600px in JPEG: dal telefono arrivano 4-8 MB, ne bastano 300 KB. */
async function compress(file: File, max = 1600): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((ok, ko) => canvas.toBlob((b) => (b ? ok(b) : ko(new Error('encode'))), 'image/jpeg', 0.85));
  } catch {
    return file; // formati che il browser non decodifica (es. HEIC su Chrome): si carica com'è
  }
}

function put(path: string, blob: Blob, contentType: string, onProgress?: (p: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const task = uploadBytesResumable(ref(storage(), path), blob, { contentType, cacheControl: 'public, max-age=31536000' });
    task.on('state_changed',
      (s) => onProgress?.(s.totalBytes ? s.bytesTransferred / s.totalBytes : 0),
      (e) => reject(new Error(e.code === 'storage/unauthorized' ? 'That file is too big or not allowed.' : 'Upload failed. Check your connection.')),
      async () => resolve(await getDownloadURL(task.snapshot.ref)));
  });
}

export async function uploadPhoto(uid: string, file: File, onProgress?: (p: number) => void): Promise<string> {
  if (IS_MOCK) return URL.createObjectURL(file);
  const blob = await compress(file);
  const type = blob.type || file.type || 'image/jpeg';
  return put(`users/${uid}/photos/${crypto.randomUUID()}.${type.includes('png') ? 'png' : 'jpg'}`, blob, type, onProgress);
}

export const MAX_VIDEO_MB = 300;

export async function uploadVideo(uid: string, file: File, onProgress?: (p: number) => void): Promise<string> {
  if (file.size > MAX_VIDEO_MB * 1024 * 1024) throw new Error(`Videos can be up to ${MAX_VIDEO_MB} MB.`);
  if (IS_MOCK) return URL.createObjectURL(file);
  const ext = (file.name.split('.').pop() || 'mp4').toLowerCase().slice(0, 5);
  return put(`users/${uid}/videos/${crypto.randomUUID()}.${ext}`, file, file.type || 'video/mp4', onProgress);
}
