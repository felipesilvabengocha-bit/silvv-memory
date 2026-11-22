import type { IncomingMessage, ServerResponse } from 'node:http';
import { adminAuth } from '../../src/lib/firebase-admin.ts';
import {
  analyzeUniversalInput,
  formatGeminiError,
  generateEmbeddingVector,
  getGeminiHttpStatus,
  type SilvvContextSnapshot,
} from '../../src/lib/gemini.ts';

type ApiRequest = IncomingMessage & { body?: unknown };
type RawChatAttachment = { mimeType: string; name: string; base64Data: string };
type ChatAttachment = { mimeType: string; originalName: string; base64Data: string };

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

  try {
    await adminAuth.verifyIdToken(authorization.slice('Bearer '.length).trim());
  } catch {
    return json(response, 401, { error: 'Token de sesión inválido o expirado.' });
  }

  const body = isRecord(request.body) ? request.body : {};
  const userText = typeof body.userText === 'string' ? body.userText.trim() : '';
  const linkUrl = typeof body.linkUrl === 'string' && body.linkUrl.trim() ? body.linkUrl.trim() : undefined;
  const incomingAttachments: ChatAttachment[] = Array.isArray(body.attachments)
    ? body.attachments.filter((attachment): attachment is RawChatAttachment =>
        isRecord(attachment) &&
        typeof attachment.base64Data === 'string' &&
        typeof attachment.mimeType === 'string' &&
        typeof attachment.name === 'string',
      ).map((attachment) => ({
        mimeType: attachment.mimeType,
        originalName: attachment.name,
        base64Data: attachment.base64Data,
      }))
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
    availableCategories: asArray(rawContext.availableCategories),
    pendingTasks: asArray(rawContext.pendingTasks),
    upcomingEvents: asArray(rawContext.upcomingEvents),
    recentHistory: asArray(rawContext.recentHistory),
  };

  try {
    const analysis = await analyzeUniversalInput({
      userText,
      linkUrl,
      attachments: incomingAttachments,
      context,
    });

    const storedAttachments: Array<{
      name: string;
      mimeType: string;
      fileKind: 'image' | 'pdf' | 'document' | 'audio' | 'other';
      storagePath: string;
      sizeBytes: number;
    }> = [];
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
        incomingAttachments.length > 0
          ? generateEmbeddingVector([
              incomingAttachments.map((attachment) => attachment.originalName).join(' '),
              analysis.extractedSummary,
              analysis.extractedText,
              analysis.detectedCategory,
            ].filter(Boolean).join('\n'))
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
