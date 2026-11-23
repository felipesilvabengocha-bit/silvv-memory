import type { IncomingMessage, ServerResponse } from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import { get, put } from '@vercel/blob';
import { adminAuth } from '../../src/lib/firebase-admin.ts';
import {
  analyzeUniversalInput,
  formatGeminiError,
  generateEmbeddingVector,
  getGeminiHttpStatus,
  type SilvvContextSnapshot,
} from '../../src/lib/gemini.ts';

type ApiRequest = IncomingMessage & { body?: unknown };
type RawChatAttachment = {
  mimeType: string;
  name: string;
  base64Data?: string;
  storagePath?: string;
};
type ChatAttachment = { mimeType: string; originalName: string; base64Data: string };

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

function normalizeMimeType(mimeType: string): string {
  return /^[a-z\d!#$&^_.+-]+\/[a-z\d!#$&^_.+-]+$/i.test(mimeType)
    ? mimeType
    : 'application/octet-stream';
}

function detectFileKind(mimeType: string): 'image' | 'pdf' | 'document' | 'audio' | 'other' {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.startsWith('text/') || /word|document|spreadsheet|presentation|json|xml/i.test(mimeType)) {
    return 'document';
  }
  return 'other';
}

function sanitizeUidForPath(uid: string): string {
  const safe = uid.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safe) throw new Error('Identificador de usuario inválido para almacenamiento.');
  return safe;
}

function getUserPrivateBlobPrefix(uid: string): string {
  return `silvv-private/${sanitizeUidForPath(uid)}/`;
}

function isUserPrivateBlobPath(uid: string, storagePath: string): boolean {
  return (
    storagePath.startsWith(getUserPrivateBlobPrefix(uid)) &&
    !storagePath.includes('\\') &&
    storagePath.split('/').every((segment) => segment && segment !== '.' && segment !== '..')
  );
}

async function readPrivateUploadBuffer(uid: string, storagePath: string): Promise<Buffer> {
  if (!isUserPrivateBlobPath(uid, storagePath)) {
    throw new Error('Acceso denegado a la ruta del archivo.');
  }
  const blob = await get(storagePath, { access: 'private' });
  if (!blob?.stream) throw new Error('El archivo adjunto ya no está disponible.');
  const chunks: Buffer[] = [];
  for await (const chunk of blob.stream as AsyncIterable<Uint8Array>) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function savePrivateUploadBuffer(
  uid: string,
  originalName: string,
  buffer: Buffer,
  mimeType: string,
): Promise<{ storagePath: string; sizeBytes: number }> {
  if (buffer.byteLength > MAX_UPLOAD_BYTES) throw new Error('El archivo supera el límite de 20 MB.');
  if (!process.env.BLOB_STORE_ID) throw new Error('El almacenamiento Blob privado no está configurado.');
  const ext = path.extname(originalName).replace(/[^a-zA-Z0-9.]/g, '').slice(0, 12);
  const pathname = `${getUserPrivateBlobPrefix(uid)}${crypto.randomUUID()}${ext}`;
  const blob = await put(pathname, buffer, {
    access: 'private',
    contentType: normalizeMimeType(mimeType),
    addRandomSuffix: false,
  });
  return { storagePath: blob.pathname, sizeBytes: buffer.byteLength };
}

function json(response: ServerResponse, status: number, data: unknown) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(data));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function isSafeHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export default async function handler(request: ApiRequest, response: ServerResponse) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return json(response, 405, { error: 'Método no permitido.' });
  }

  const authorization = request.headers.authorization;
  if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) {
    return json(response, 401, { error: 'Sesión no autorizada. Iniciá sesión para continuar.' });
  }

  let uid: string;
  try {
    uid = (await adminAuth.verifyIdToken(authorization.slice('Bearer '.length).trim())).uid;
  } catch {
    return json(response, 401, { error: 'Token de sesión inválido o expirado.' });
  }

  const body = isRecord(request.body) ? request.body : {};
  const userText = typeof body.userText === 'string' ? body.userText.trim() : '';
  const linkUrl = typeof body.linkUrl === 'string' && body.linkUrl.trim() ? body.linkUrl.trim() : undefined;
  const incomingAttachments: RawChatAttachment[] = Array.isArray(body.attachments)
    ? body.attachments.filter((attachment): attachment is RawChatAttachment =>
        isRecord(attachment) &&
        typeof attachment.mimeType === 'string' &&
        typeof attachment.name === 'string' &&
        (typeof attachment.base64Data === 'string' || typeof attachment.storagePath === 'string'),
      )
    : [];

  if (linkUrl && !isSafeHttpUrl(linkUrl)) {
    return json(response, 400, { error: 'La URL ingresada debe usar http/https público válido.' });
  }
  if (!userText && incomingAttachments.length === 0 && !linkUrl) {
    return json(response, 400, { error: 'Escribí un mensaje, pegá un enlace o adjuntá archivos.' });
  }

  const rawContext = isRecord(body.context) ? body.context : {};
  const context: SilvvContextSnapshot = {
    timezone: typeof rawContext.timezone === 'string' ? rawContext.timezone : 'America/Montevideo',
    nowIso: typeof rawContext.nowIso === 'string' ? rawContext.nowIso : new Date().toISOString(),
    activeProjects: asArray(rawContext.activeProjects),
    activeFolders: asArray(rawContext.activeFolders),
    relevantMemories: asArray(rawContext.relevantMemories),
    relevantNotes: asArray(rawContext.relevantNotes),
    relevantMemoryEvents: asArray(rawContext.relevantMemoryEvents),
    knownPeople: asArray(rawContext.knownPeople),
    availableCategories: asArray(rawContext.availableCategories),
    pendingTasks: asArray(rawContext.pendingTasks),
    upcomingEvents: asArray(rawContext.upcomingEvents),
    recentHistory: asArray(rawContext.recentHistory),
  };

  try {
    const storedAttachments: Array<{
      name: string;
      mimeType: string;
      fileKind: 'image' | 'pdf' | 'document' | 'audio' | 'other';
      storagePath: string;
      sizeBytes: number;
    }> = [];
    const chatAttachments: ChatAttachment[] = [];

    for (const attachment of incomingAttachments) {
      const mimeType = normalizeMimeType(attachment.mimeType);
      const buffer = attachment.storagePath
        ? await readPrivateUploadBuffer(uid, attachment.storagePath)
        : Buffer.from(attachment.base64Data || '', 'base64');
      if (buffer.byteLength > MAX_UPLOAD_BYTES) throw new Error('El archivo supera el límite de 20 MB.');
      const stored = attachment.storagePath
        ? { storagePath: attachment.storagePath, sizeBytes: buffer.byteLength }
        : await savePrivateUploadBuffer(uid, attachment.name, buffer, mimeType);

      storedAttachments.push({
        name: attachment.name.slice(0, 200),
        mimeType: mimeType.slice(0, 120),
        fileKind: detectFileKind(mimeType),
        storagePath: stored.storagePath,
        sizeBytes: stored.sizeBytes,
      });
      chatAttachments.push({
        mimeType,
        originalName: attachment.name,
        base64Data: buffer.toString('base64'),
      });
    }

    const analysis = await analyzeUniversalInput({
      userText,
      linkUrl,
      attachments: chatAttachments,
      context,
    });
    let memoryEmbeddings: Array<number[] | null> = analysis.memoriesToSave.map(() => null);
    let fileEmbedding: number[] | null = null;
    let memoryEventEmbeddings: Array<number[] | null> = analysis.proposedMemoryEvents.map(() => null);
    let noteEmbedding: number[] | null = null;

    const needsEmbeddings =
      analysis.memoriesToSave.length > 0 ||
      incomingAttachments.length > 0 ||
      analysis.proposedMemoryEvents.length > 0 ||
      analysis.proposedNoteAction?.action === 'create';

    if (needsEmbeddings) {
      type EmbeddingResults = [Array<number[] | null>, number[] | null, Array<number[] | null>, number[] | null];
      const emptyResults: EmbeddingResults = [
        analysis.memoriesToSave.map(() => null),
        null,
        analysis.proposedMemoryEvents.map(() => null),
        null,
      ];
      const embeddingTask: Promise<EmbeddingResults> = Promise.all([
        Promise.all(analysis.memoriesToSave.map((memory) =>
          memory.content ? generateEmbeddingVector(`${memory.title || ''} ${memory.content}`) : Promise.resolve(null),
        )),
          chatAttachments.length > 0
          ? generateEmbeddingVector(
              [
                chatAttachments.map((attachment) => attachment.originalName).join(' '),
                analysis.extractedSummary,
                analysis.extractedText,
                analysis.detectedCategory,
              ]
                .filter(Boolean)
                .join('\n'),
            )
          : Promise.resolve(null),
        Promise.all(analysis.proposedMemoryEvents.map((event) =>
          generateEmbeddingVector(`${event.title} ${event.description} ${(event.people || []).join(' ')}`),
        )),
        analysis.proposedNoteAction?.action === 'create'
          ? generateEmbeddingVector(`${analysis.proposedNoteAction.title} ${analysis.proposedNoteAction.content}`)
          : Promise.resolve(null),
      ]);
      const [memoryResults, fileResult, eventResults, noteResult] = await Promise.race([
        embeddingTask,
        new Promise<EmbeddingResults>((resolve) => setTimeout(() => resolve(emptyResults), 2800)),
      ]);
      memoryEmbeddings = memoryResults;
      fileEmbedding = fileResult;
      memoryEventEmbeddings = eventResults;
      noteEmbedding = noteResult;
    }

    return json(response, 200, {
      analysis,
      storedAttachments,
      memoryEmbeddings,
      fileEmbedding,
      memoryEventEmbeddings,
      noteEmbedding,
    });
  } catch (error) {
    const status = getGeminiHttpStatus(error);
    const message = formatGeminiError(error);
    console.error('[SILVV MEMORY /api/ai/chat] Gemini request failed', { status });
    return json(response, status, { error: message });
  }
}
