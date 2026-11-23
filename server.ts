import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { del, get, put } from '@vercel/blob';
import express, { type NextFunction, type Request, type Response } from 'express';
import { requireAuth, type AuthRequest } from './src/middleware/auth.ts';
import {
  analyzeAgentDocument,
  analyzeUniversalInput,
  generateDashboardBriefing,
  generateEmbeddingVector,
  generateNoteOrganization,
  generatePeriodSummary,
  queryKnowledgeBrain,
  runCustomAgentChat,
} from './src/lib/gemini.ts';
import {
  askAboutPersonalInsight,
  correctPersonalInsight,
  getPersonalInsights,
  refreshPersonalInsights,
  updatePersonalInsight,
} from './src/lib/personal-insights.ts';

const PORT = Number(process.env.PORT || 3000);
const IS_VERCEL = Boolean(process.env.VERCEL);
const WRITABLE_ROOT = IS_VERCEL ? os.tmpdir() : process.cwd();
const UPLOADS_ROOT = path.resolve(WRITABLE_ROOT, 'uploads');
const SCHEDULER_STATE_PATH = path.resolve(WRITABLE_ROOT, '.silvv-scheduler-state.json');
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const MAX_DIRECT_UPLOAD_BYTES = 4 * 1024 * 1024;

interface ScheduledSourceItem {
  sourceType: string;
  sourceId: number;
  title: string;
  date: string;
  content: string;
}

interface PendingGeneratedSummary {
  periodKind: 'daily' | 'weekly' | 'monthly';
  periodKey: string;
  periodStart: string;
  periodEnd: string;
  title: string;
  narrative: string;
  sections: Record<string, string>;
  usedSources: Array<{
    sourceType: string;
    sourceId: number;
    title: string;
    excerpt: string;
    sourceDate: string;
  }>;
  generatedAt: string;
}

interface UserSchedulerSnapshot {
  uid: string;
  userName: string;
  timezone: string;
  sources: ScheduledSourceItem[];
  generatedKeys: string[];
  pendingSummaries: PendingGeneratedSummary[];
  lastSyncedAt: string;
}

type SchedulerStateFile = Record<string, UserSchedulerSnapshot>;
let schedulerInFlight = false;

function getZonedParts(date: Date, timeZone: string): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number; // 0=Sun..6=Sat
} {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
      hour12: false,
    });
    const parts = fmt.formatToParts(date);
    const get = (t: string) => parts.find((p) => p.type === t)?.value || '';
    const weekdayMap: Record<string, number> = {
      Sun: 0,
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
    };
    const h = Number(get('hour')) % 24;
    return {
      year: Number(get('year')),
      month: Number(get('month')),
      day: Number(get('day')),
      hour: h,
      minute: Number(get('minute')),
      weekday: weekdayMap[get('weekday')] ?? 0,
    };
  } catch {
    return {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      hour: date.getUTCHours(),
      minute: date.getUTCMinutes(),
      weekday: date.getUTCDay(),
    };
  }
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function getIsoWeekKey(year: number, month: number, day: number): string {
  const d = new Date(Date.UTC(year, month - 1, day));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${pad2(weekNo)}`;
}

async function readSchedulerState(): Promise<SchedulerStateFile> {
  try {
    const raw = await fs.readFile(SCHEDULER_STATE_PATH, 'utf8');
    const parsed = JSON.parse(raw) as SchedulerStateFile;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function writeSchedulerState(state: SchedulerStateFile): Promise<void> {
  await fs.writeFile(SCHEDULER_STATE_PATH, JSON.stringify(state, null, 2), 'utf8').catch(() => {});
}

async function runScheduledSummaryCycle(targetUid?: string): Promise<void> {
  if (schedulerInFlight) return;
  schedulerInFlight = true;
  try {
    const state = await readSchedulerState();
    const uids = targetUid ? (state[targetUid] ? [targetUid] : []) : Object.keys(state);
    if (uids.length === 0) return;

    let dirty = false;
    const now = new Date();

    for (const uid of uids) {
      const snap = state[uid];
      if (!snap || snap.sources.length === 0) continue;
      const tz = snap.timezone || 'America/Montevideo';
      const zp = getZonedParts(now, tz);

      // Yesterday's date string in user timezone (catch-up when day closed)
      const yesterdayRef = new Date(Date.UTC(zp.year, zp.month - 1, zp.day - 1, 12, 0, 0));
      const yYear = yesterdayRef.getUTCFullYear();
      const yMonth = yesterdayRef.getUTCMonth() + 1;
      const yDay = yesterdayRef.getUTCDate();
      const yesterdayKey = `${yYear}-${pad2(yMonth)}-${pad2(yDay)}`;
      const todayKey = `${zp.year}-${pad2(zp.month)}-${pad2(zp.day)}`;

      const candidates: Array<{
        kind: 'daily' | 'weekly' | 'monthly';
        key: string;
        start: string;
        end: string;
      }> = [];

      // Catch-up completed yesterday daily summary if missing
      const ySources = snap.sources.filter((s) => (s.date || '').slice(0, 10) === yesterdayKey);
      if (ySources.length > 0 && !snap.generatedKeys.includes(`daily:${yesterdayKey}`)) {
        candidates.push({
          kind: 'daily',
          key: yesterdayKey,
          start: `${yesterdayKey}T00:00:00`,
          end: `${yesterdayKey}T23:59:59`,
        });
      }

      // End-of-day automatic daily summary after 23:45 local time
      const tSources = snap.sources.filter((s) => (s.date || '').slice(0, 10) === todayKey);
      if (zp.hour === 23 && zp.minute >= 45 && tSources.length > 0 && !snap.generatedKeys.includes(`daily:${todayKey}`)) {
        candidates.push({
          kind: 'daily',
          key: todayKey,
          start: `${todayKey}T00:00:00`,
          end: `${todayKey}T23:59:59`,
        });
      }

      // Previous ISO week catch-up
      const lastWeekRef = new Date(Date.UTC(zp.year, zp.month - 1, zp.day - 7, 12, 0, 0));
      const prevWeekKey = getIsoWeekKey(
        lastWeekRef.getUTCFullYear(),
        lastWeekRef.getUTCMonth() + 1,
        lastWeekRef.getUTCDate(),
      );
      if (!snap.generatedKeys.includes(`weekly:${prevWeekKey}`)) {
        const wStart = new Date(Date.UTC(zp.year, zp.month - 1, zp.day - ((zp.weekday + 6) % 7) - 7));
        const wEnd = new Date(wStart.getTime() + 6 * 86400000);
        const ws = wStart.toISOString().slice(0, 10);
        const we = wEnd.toISOString().slice(0, 10);
        const wSources = snap.sources.filter((s) => {
          const d = (s.date || '').slice(0, 10);
          return d >= ws && d <= we;
        });
        if (wSources.length > 0) {
          candidates.push({
            kind: 'weekly',
            key: prevWeekKey,
            start: `${ws}T00:00:00`,
            end: `${we}T23:59:59`,
          });
        }
      }

      // Previous month catch-up
      const prevMonthDate = new Date(Date.UTC(zp.year, zp.month - 2, 1));
      const prevMonthKey = `${prevMonthDate.getUTCFullYear()}-${pad2(prevMonthDate.getUTCMonth() + 1)}`;
      if (!snap.generatedKeys.includes(`monthly:${prevMonthKey}`)) {
        const mEndDate = new Date(Date.UTC(zp.year, zp.month - 1, 0));
        const ms = `${prevMonthKey}-01`;
        const me = `${prevMonthKey}-${pad2(mEndDate.getUTCDate())}`;
        const mSources = snap.sources.filter((s) => {
          const d = (s.date || '').slice(0, 10);
          return d >= ms && d <= me;
        });
        if (mSources.length > 0) {
          candidates.push({
            kind: 'monthly',
            key: prevMonthKey,
            start: `${ms}T00:00:00`,
            end: `${me}T23:59:59`,
          });
        }
      }

      for (const c of candidates.slice(0, 2)) {
        const startDay = c.start.slice(0, 10);
        const endDay = c.end.slice(0, 10);
        const periodSources = snap.sources.filter((s) => {
          const d = (s.date || '').slice(0, 10);
          return d >= startDay && d <= endDay;
        });
        if (periodSources.length === 0) continue;

        try {
          const generated = await generatePeriodSummary({
            periodKind: c.kind,
            periodKey: c.key,
            periodStart: c.start,
            periodEnd: c.end,
            timezone: tz,
            userName: snap.userName || 'Usuario',
            sources: periodSources,
          });
          snap.generatedKeys.push(`${c.kind}:${c.key}`);
          snap.pendingSummaries.push({
            periodKind: c.kind,
            periodKey: c.key,
            periodStart: c.start,
            periodEnd: c.end,
            title: generated.title,
            narrative: generated.narrative,
            sections: generated.sections,
            usedSources: generated.usedSources,
            generatedAt: new Date().toISOString(),
          });
          dirty = true;
          console.log(`[SILVV MEMORY scheduler] Generated ${c.kind}:${c.key} for user`);
        } catch (err) {
          console.warn(
            `[SILVV MEMORY scheduler] Skipped ${c.kind}:${c.key}:`,
            err instanceof Error ? err.message : err,
          );
        }
      }
    }

    if (dirty) {
      await writeSchedulerState(state);
    }
  } finally {
    schedulerInFlight = false;
  }
}

function isSafeHttpUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    if (host === 'localhost' || host === '::1' || host.endsWith('.local')) return false;
    if (net.isIP(host)) {
      if (
        host.startsWith('127.') ||
        host.startsWith('10.') ||
        host.startsWith('192.168.') ||
        host.startsWith('169.254.') ||
        /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host)
      ) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

function detectFileKind(mimeType: string): 'image' | 'pdf' | 'document' | 'audio' | 'other' {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (
    mimeType.startsWith('text/') ||
    mimeType.includes('document') ||
    mimeType.includes('word') ||
    mimeType.includes('json')
  ) {
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
  const segments = storagePath.split('/');
  return (
    storagePath.startsWith(getUserPrivateBlobPrefix(uid)) &&
    !storagePath.includes('\\') &&
    segments.every((segment) => segment && segment !== '.' && segment !== '..')
  );
}

function normalizeMimeType(mimeType: string): string {
  return /^[a-z\d!#$&^_.+-]+\/[a-z\d!#$&^_.+-]+$/i.test(mimeType)
    ? mimeType
    : 'application/octet-stream';
}

async function savePrivateUploadBuffer(
  uid: string,
  originalName: string,
  buffer: Buffer,
  mimeType: string,
): Promise<{ storagePath: string; sizeBytes: number }> {
  if (buffer.byteLength > MAX_UPLOAD_BYTES) {
    throw new Error('El archivo supera el límite de 20 MB.');
  }

  const safeUid = sanitizeUidForPath(uid);
  const ext = path.extname(originalName).replace(/[^a-zA-Z0-9.]/g, '').slice(0, 12);
  const storedFileName = `${crypto.randomUUID()}${ext}`;
  const blobPath = `${getUserPrivateBlobPrefix(uid)}${storedFileName}`;
  const contentType = normalizeMimeType(mimeType);

  if (process.env.BLOB_STORE_ID) {
    const blob = await put(blobPath, buffer, {
      access: 'private',
      contentType,
      addRandomSuffix: false,
    });
    return { storagePath: blob.pathname, sizeBytes: buffer.byteLength };
  }

  if (IS_VERCEL) {
    throw new Error('El almacenamiento Blob privado no está configurado en este entorno.');
  }

  const userDir = path.resolve(UPLOADS_ROOT, safeUid);
  if (!userDir.startsWith(UPLOADS_ROOT + path.sep)) {
    throw new Error('Ruta de almacenamiento inválida.');
  }
  await fs.mkdir(userDir, { recursive: true });
  const fullPath = path.resolve(userDir, storedFileName);
  if (!fullPath.startsWith(userDir + path.sep)) {
    throw new Error('Ruta de archivo fuera del directorio permitido.');
  }
  await fs.writeFile(fullPath, buffer);
  return {
    storagePath: path.join(safeUid, storedFileName),
    sizeBytes: buffer.byteLength,
  };
}

async function savePrivateUpload(
  uid: string,
  originalName: string,
  base64Data: string,
  mimeType: string,
): Promise<{ storagePath: string; sizeBytes: number }> {
  return savePrivateUploadBuffer(uid, originalName, Buffer.from(base64Data, 'base64'), mimeType);
}

async function readPrivateUploadBuffer(uid: string, storagePath: string): Promise<Buffer> {
  if (isUserPrivateBlobPath(uid, storagePath)) {
    const blob = await get(storagePath, { access: 'private' });
    if (!blob?.stream) throw new Error('El archivo adjunto ya no está disponible.');
    const chunks: Buffer[] = [];
    for await (const chunk of Readable.from(blob.stream as AsyncIterable<Uint8Array>)) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  return fs.readFile(resolveUserStoragePath(uid, storagePath));
}

function resolveUserStoragePath(uid: string, storagePath: string): string {
  const safeUid = sanitizeUidForPath(uid);
  const userDir = path.resolve(UPLOADS_ROOT, safeUid);
  const resolved = path.resolve(UPLOADS_ROOT, storagePath);
  if (!resolved.startsWith(userDir + path.sep)) {
    throw new Error('Acceso denegado a la ruta de almacenamiento.');
  }
  return resolved;
}

function extractReadableErrorMessage(err: unknown, fallback: string): string {
  if (!(err instanceof Error)) return fallback;
  const raw = err.message?.trim();
  if (!raw) return fallback;
  const lower = raw.toLowerCase();
  if (lower.includes('503') || lower.includes('unavailable') || lower.includes('high demand')) {
    return 'Los servidores de Gemini están con alta demanda temporalmente (503). Intentá nuevamente en unos segundos.';
  }
  if (lower.includes('429') || lower.includes('resource_exhausted')) {
    return 'Se alcanzó el límite temporal de solicitudes de Gemini (429). Esperá unos segundos o revisá tu cuota en Settings > Secrets.';
  }
  if (lower.includes('api_key_invalid') || lower.includes('permission_denied') || lower.includes('403')) {
    return 'Error de permisos o clave inválida en la API de Gemini. Revisá tu clave en Settings > Secrets.';
  }
  const jsonStart = raw.indexOf('{');
  if (jsonStart !== -1) {
    try {
      const parsed = JSON.parse(raw.slice(jsonStart)) as { error?: { message?: string }; message?: string };
      return parsed.error?.message || parsed.message || fallback;
    } catch {
      return raw;
    }
  }
  return raw;
}

function sendServerError(res: Response, err: unknown, fallback: string) {
  console.error('[SILVV MEMORY server error]', err);
  const message = extractReadableErrorMessage(err, fallback);
  const rawLower = err instanceof Error ? err.message.toLowerCase() : '';
  const status =
    rawLower.includes('503') || rawLower.includes('unavailable')
      ? 503
      : rawLower.includes('429') || rawLower.includes('resource_exhausted')
      ? 429
      : 500;
  res.status(status).json({ error: message || fallback });
}

const app = express();
app.use(express.json({ limit: '45mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'silvv-memory', timestamp: new Date().toISOString() });
  });

  app.get('/api/insights', requireAuth, async (req: AuthRequest, res) => {
    try {
      res.json(await getPersonalInsights(req.user!.uid));
    } catch (err) {
      sendServerError(res, err, 'No se pudieron cargar tus Insights personales.');
    }
  });

  app.post('/api/insights/refresh', requireAuth, async (req: AuthRequest, res) => {
    try {
      const deep = req.body?.deep;
      if (typeof deep !== 'undefined' && typeof deep !== 'boolean') {
        return res.status(400).json({ error: 'El modo de análisis no es válido.' });
      }
      res.json(await refreshPersonalInsights(req.user!.uid, deep === true));
    } catch (err) {
      sendServerError(res, err, 'No se pudo actualizar el análisis de Insights.');
    }
  });

  app.post('/api/insights/:insightId/question', requireAuth, async (req: AuthRequest, res) => {
    try {
      const insightId = String(req.params.insightId || '');
      const question = typeof req.body?.question === 'string' ? req.body.question : '';
      if (!/^[a-f0-9]{24}$/.test(insightId)) {
        return res.status(400).json({ error: 'El insight solicitado no es válido.' });
      }
      if (!question.trim() || question.length > 1000) {
        return res.status(400).json({ error: 'La pregunta debe tener entre 1 y 1000 caracteres.' });
      }
      res.json(await askAboutPersonalInsight(req.user!.uid, insightId, question));
    } catch (err) {
      sendServerError(res, err, 'No se pudo responder sobre este insight.');
    }
  });

  app.post('/api/insights/:insightId/correction', requireAuth, async (req: AuthRequest, res) => {
    try {
      const insightId = String(req.params.insightId || '');
      const correction = typeof req.body?.correction === 'string' ? req.body.correction : '';
      if (!/^[a-f0-9]{24}$/.test(insightId)) {
        return res.status(400).json({ error: 'El insight solicitado no es válido.' });
      }
      if (!correction.trim() || correction.length > 1000) {
        return res.status(400).json({ error: 'La corrección debe tener entre 1 y 1000 caracteres.' });
      }
      res.json(await correctPersonalInsight(req.user!.uid, insightId, correction));
    } catch (err) {
      sendServerError(res, err, 'No se pudo guardar la corrección.');
    }
  });

  app.patch('/api/insights/:insightId', requireAuth, async (req: AuthRequest, res) => {
    try {
      const insightId = String(req.params.insightId || '');
      if (!/^[a-f0-9]{24}$/.test(insightId)) {
        return res.status(400).json({ error: 'El insight solicitado no es válido.' });
      }
      const patch: { isStarred?: boolean; dismissed?: boolean } = {};
      if (typeof req.body?.isStarred === 'boolean') patch.isStarred = req.body.isStarred;
      if (typeof req.body?.dismissed === 'boolean') patch.dismissed = req.body.dismissed;
      if (Object.keys(patch).length === 0) {
        return res.status(400).json({ error: 'No hay cambios válidos para guardar.' });
      }
      res.json(await updatePersonalInsight(req.user!.uid, insightId, patch));
    } catch (err) {
      sendServerError(res, err, 'No se pudo actualizar el insight.');
    }
  });

  // =========================================================================
  // SERVER-SIDE GEMINI AI & MULTIMODAL PROCESSING ROUTES
  // =========================================================================

  app.post('/api/ai/embed', requireAuth, async (req: AuthRequest, res) => {
    try {
      const text = typeof req.body?.text === 'string' ? req.body.text : '';
      const embedding = await generateEmbeddingVector(text);
      res.json({ embedding });
    } catch (err) {
      sendServerError(res, err, 'Error al generar embedding.');
    }
  });

  app.post('/api/ai/briefing', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { userName, timezone, nowIso, upcomingEvents, pendingTasks, activeProjects, recentMemories } =
        req.body ?? {};
      const briefing = await generateDashboardBriefing({
        userName: typeof userName === 'string' && userName ? userName : 'Usuario',
        timezone: typeof timezone === 'string' && timezone ? timezone : 'America/Montevideo',
        nowIso: typeof nowIso === 'string' && nowIso ? nowIso : new Date().toISOString(),
        upcomingEvents: Array.isArray(upcomingEvents) ? upcomingEvents : [],
        pendingTasks: Array.isArray(pendingTasks) ? pendingTasks : [],
        activeProjects: Array.isArray(activeProjects) ? activeProjects : [],
        recentMemories: Array.isArray(recentMemories) ? recentMemories : [],
      });
      res.json(briefing);
    } catch (err) {
      sendServerError(res, err, 'No se pudo generar el resumen inteligente.');
    }
  });

  app.post('/api/ai/summary', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { periodKind, periodKey, periodStart, periodEnd, timezone, userName, sources } = req.body ?? {};
      if (periodKind !== 'daily' && periodKind !== 'weekly' && periodKind !== 'monthly') {
        return res.status(400).json({ error: 'Tipo de resumen inválido (daily, weekly, monthly).' });
      }
      if (typeof periodKey !== 'string' || !periodKey) {
        return res.status(400).json({ error: 'periodKey requerido.' });
      }
      const result = await generatePeriodSummary({
        periodKind,
        periodKey,
        periodStart: typeof periodStart === 'string' ? periodStart : '',
        periodEnd: typeof periodEnd === 'string' ? periodEnd : '',
        timezone: typeof timezone === 'string' && timezone ? timezone : 'America/Montevideo',
        userName: typeof userName === 'string' && userName ? userName : 'Usuario',
        sources: Array.isArray(sources) ? sources : [],
      });
      res.json(result);
    } catch (err) {
      sendServerError(res, err, 'Error al generar el resumen del período.');
    }
  });

  // Server-side scheduled summaries sync & retrieval (independent of open browser)
  app.post('/api/summaries/scheduler-sync', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.user!.uid;
      const { userName, timezone, sources, existingSummaryKeys } = req.body ?? {};
      const state = await readSchedulerState();
      const prev = state[uid];
      const mergedKeys = new Set<string>([
        ...(prev?.generatedKeys || []),
        ...(Array.isArray(existingSummaryKeys) ? existingSummaryKeys.filter((k) => typeof k === 'string') : []),
      ]);
      state[uid] = {
        uid,
        userName: typeof userName === 'string' && userName ? userName : prev?.userName || 'Usuario',
        timezone: typeof timezone === 'string' && timezone ? timezone : prev?.timezone || 'America/Montevideo',
        sources: Array.isArray(sources) ? sources.slice(0, 120) : prev?.sources || [],
        generatedKeys: Array.from(mergedKeys).slice(-120),
        pendingSummaries: prev?.pendingSummaries || [],
        lastSyncedAt: new Date().toISOString(),
      };
      await writeSchedulerState(state);
      void runScheduledSummaryCycle(uid);
      res.json({ ok: true, pendingCount: state[uid].pendingSummaries.length });
    } catch (err) {
      sendServerError(res, err, 'Error al sincronizar planificador de resúmenes.');
    }
  });

  app.get('/api/summaries/pending-scheduled', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.user!.uid;
      const state = await readSchedulerState();
      const pending = state[uid]?.pendingSummaries || [];
      res.json({ pending });
    } catch (err) {
      sendServerError(res, err, 'Error al consultar resúmenes programados.');
    }
  });

  app.post('/api/summaries/ack-scheduled', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.user!.uid;
      const ackKeys: string[] = Array.isArray(req.body?.keys) ? req.body.keys : [];
      const state = await readSchedulerState();
      if (state[uid]) {
        const keySet = new Set(ackKeys);
        state[uid].pendingSummaries = state[uid].pendingSummaries.filter(
          (p) => !keySet.has(`${p.periodKind}:${p.periodKey}`),
        );
        await writeSchedulerState(state);
      }
      res.json({ ok: true });
    } catch (err) {
      sendServerError(res, err, 'Error al confirmar resúmenes programados.');
    }
  });

  app.post('/api/ai/note-organization', requireAuth, async (req: AuthRequest, res) => {
    try {
      const rawContent = typeof req.body?.content === 'string' ? req.body.content : '';
      const content = rawContent.trim();
      if (!content) return res.status(400).json({ error: 'Escribí contenido para organizar la nota.' });
      if (content.length > 65000) return res.status(413).json({ error: 'La nota supera el límite permitido.' });

      const organization = await generateNoteOrganization(content);
      res.json(organization);
    } catch (err) {
      sendServerError(res, err, 'No se pudo organizar la nota automáticamente.');
    }
  });

  app.post('/api/ai/chat', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.user!.uid;
      const { userText: rawText, linkUrl: rawLinkUrl, attachments: rawAtts, context } = req.body ?? {};
      const userText = typeof rawText === 'string' ? rawText.trim() : '';
      const linkUrl = typeof rawLinkUrl === 'string' && rawLinkUrl.trim() ? rawLinkUrl.trim() : undefined;

      if (linkUrl && !isSafeHttpUrl(linkUrl)) {
        return res.status(400).json({ error: 'La URL ingresada debe usar http/https público válido.' });
      }

      const incomingAtts: Array<{
        name: string;
        mimeType: string;
        base64Data?: string;
        storagePath?: string;
      }> = [];
      if (Array.isArray(rawAtts)) {
        for (const attachment of rawAtts) {
          if (
            attachment &&
            typeof attachment.name === 'string' &&
            typeof attachment.mimeType === 'string' &&
            (typeof attachment.base64Data === 'string' || typeof attachment.storagePath === 'string')
          ) {
            incomingAtts.push(attachment);
          }
        }
      }

      if (!userText && incomingAtts.length === 0 && !linkUrl) {
        return res.status(400).json({ error: 'Escribí un mensaje, pegá un enlace o adjuntá archivos.' });
      }

      const storedAttachments: Array<{
        name: string;
        mimeType: string;
        fileKind: 'image' | 'pdf' | 'document' | 'audio' | 'other';
        storagePath: string;
        sizeBytes: number;
      }> = [];
      const geminiAttachments: Array<{ mimeType: string; originalName: string; base64Data: string }> = [];

      for (const att of incomingAtts) {
        const buffer = att.storagePath
          ? await readPrivateUploadBuffer(uid, att.storagePath)
          : Buffer.from(att.base64Data || '', 'base64');
        if (buffer.byteLength > MAX_UPLOAD_BYTES) {
          throw new Error('El archivo supera el límite de 20 MB.');
        }
        const stored = att.storagePath
          ? { storagePath: att.storagePath, sizeBytes: buffer.byteLength }
          : await savePrivateUploadBuffer(uid, att.name, buffer, att.mimeType);
        const mimeType = normalizeMimeType(att.mimeType);
        storedAttachments.push({
          name: att.name.slice(0, 200),
          mimeType: mimeType.slice(0, 120),
          fileKind: detectFileKind(mimeType),
          storagePath: stored.storagePath,
          sizeBytes: stored.sizeBytes,
        });
        geminiAttachments.push({
          mimeType,
          originalName: att.name,
          base64Data: buffer.toString('base64'),
        });
      }

      const t0 = Date.now();
      const analysis = await analyzeUniversalInput({
        userText,
        linkUrl,
        attachments: geminiAttachments,
        context: {
          timezone: context?.timezone || 'America/Montevideo',
          nowIso: context?.nowIso || new Date().toISOString(),
          activeProjects: Array.isArray(context?.activeProjects) ? context.activeProjects : [],
          activeFolders: Array.isArray(context?.activeFolders) ? context.activeFolders : [],
          relevantMemories: Array.isArray(context?.relevantMemories) ? context.relevantMemories : [],
          relevantNotes: Array.isArray(context?.relevantNotes) ? context.relevantNotes : [],
          relevantMemoryEvents: Array.isArray(context?.relevantMemoryEvents) ? context.relevantMemoryEvents : [],
          knownPeople: Array.isArray(context?.knownPeople) ? context.knownPeople : [],
          availableCategories: Array.isArray(context?.availableCategories) ? context.availableCategories : [],
          pendingTasks: Array.isArray(context?.pendingTasks) ? context.pendingTasks : [],
          upcomingEvents: Array.isArray(context?.upcomingEvents) ? context.upcomingEvents : [],
          recentHistory: Array.isArray(context?.recentHistory) ? context.recentHistory : [],
        },
      });

      const needsEmbeddings =
        analysis.memoriesToSave.length > 0 ||
        storedAttachments.length > 0 ||
        analysis.proposedMemoryEvents.length > 0 ||
        analysis.proposedNoteAction?.action === 'create';

      let memoryEmbeddings: Array<number[] | null> = analysis.memoriesToSave.map(() => null);
      let fileEmbedding: number[] | null = null;
      let memoryEventEmbeddings: Array<number[] | null> = analysis.proposedMemoryEvents.map(() => null);
      let noteEmbedding: number[] | null = null;

      if (needsEmbeddings) {
        const embeddingTask = Promise.all([
          Promise.all(
            analysis.memoriesToSave.map((mem) =>
              mem.content ? generateEmbeddingVector(`${mem.title || ''} ${mem.content}`) : Promise.resolve(null),
            ),
          ),
          storedAttachments.length > 0
            ? generateEmbeddingVector(
                [
                  storedAttachments.map((a) => a.name).join(' '),
                  analysis.extractedSummary,
                  analysis.extractedText,
                  analysis.detectedCategory,
                ]
                  .filter(Boolean)
                  .join('\n'),
              )
            : Promise.resolve(null),
          Promise.all(
            analysis.proposedMemoryEvents.map((ev) =>
              generateEmbeddingVector(`${ev.title} ${ev.description} ${(ev.people || []).join(' ')}`),
            ),
          ),
          analysis.proposedNoteAction?.action === 'create'
            ? generateEmbeddingVector(`${analysis.proposedNoteAction.title} ${analysis.proposedNoteAction.content}`)
            : Promise.resolve(null),
        ]);

        const embResult = await Promise.race([
          embeddingTask,
          new Promise<[Array<number[] | null>, number[] | null, Array<number[] | null>, number[] | null]>((resolve) =>
            setTimeout(
              () =>
                resolve([
                  analysis.memoriesToSave.map(() => null),
                  null,
                  analysis.proposedMemoryEvents.map(() => null),
                  null,
                ]),
              2800,
            ),
          ),
        ]);
        memoryEmbeddings = embResult[0];
        fileEmbedding = embResult[1];
        memoryEventEmbeddings = embResult[2];
        noteEmbedding = embResult[3];
      }

      console.log(`[SILVV MEMORY /api/ai/chat] completed in ${Date.now() - t0}ms`);

      res.json({
        analysis,
        storedAttachments,
        memoryEmbeddings,
        fileEmbedding,
        memoryEventEmbeddings,
        noteEmbedding,
      });
    } catch (err) {
      sendServerError(res, err, 'Error al procesar el mensaje con Gemini.');
    }
  });

  app.post('/api/ai/knowledge', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { question, deepMode, timezone, sources, history } = req.body ?? {};
      if (typeof question !== 'string' || !question.trim()) {
        return res.status(400).json({ error: 'Escribí una pregunta para investigar tu memoria.' });
      }
      const result = await queryKnowledgeBrain({
        question: question.trim(),
        deepMode: Boolean(deepMode),
        timezone: typeof timezone === 'string' && timezone ? timezone : 'America/Montevideo',
        sources: Array.isArray(sources) ? sources : [],
        history: Array.isArray(history) ? history : [],
      });
      res.json(result);
    } catch (err) {
      sendServerError(res, err, 'Error en el Chat de Conocimiento.');
    }
  });

  app.post('/api/ai/agent-doc', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.user!.uid;
      const { name, mimeType, base64Data } = req.body ?? {};
      if (typeof name !== 'string' || typeof mimeType !== 'string' || typeof base64Data !== 'string') {
        return res.status(400).json({ error: 'Archivo inválido.' });
      }

      const stored = await savePrivateUpload(uid, name, base64Data, mimeType);
      const analyzed = await analyzeAgentDocument({ fileName: name, mimeType, base64Data });
      const embedding = await generateEmbeddingVector(
        `${name}\n${analyzed.aiSummary}\n${analyzed.extractedText}`,
      );

      res.json({
        storagePath: stored.storagePath,
        sizeBytes: stored.sizeBytes,
        extractedText: analyzed.extractedText,
        aiSummary: analyzed.aiSummary,
        embedding,
      });
    } catch (err) {
      sendServerError(res, err, 'Error al analizar documento del agente.');
    }
  });

  app.post('/api/ai/agent-chat', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { agent, question, sources, agentMemories, history } = req.body ?? {};
      if (!agent || typeof question !== 'string' || !question.trim()) {
        return res.status(400).json({ error: 'Solicitud inválida para conversar con el agente.' });
      }

      const reply = await runCustomAgentChat({
        agent,
        question: question.trim(),
        sources: Array.isArray(sources) ? sources : [],
        agentMemories: Array.isArray(agentMemories) ? agentMemories : [],
        history: Array.isArray(history) ? history : [],
      });

      const newAgentMemoryEmbedding =
        reply.newAgentMemory && agent.memoryEnabled
          ? await generateEmbeddingVector(reply.newAgentMemory)
          : null;

      res.json({
        ...reply,
        newAgentMemoryEmbedding,
      });
    } catch (err) {
      sendServerError(res, err, 'Error al conversar con el agente.');
    }
  });

  // =========================================================================
  // PRIVATE FILE VAULT (BINARY STORAGE OUTSIDE 1MB FIRESTORE DOCS)
  // =========================================================================

  app.post(
    '/api/files/upload',
    requireAuth,
    express.raw({ type: 'application/octet-stream', limit: '4mb' }),
    async (req: AuthRequest, res) => {
      try {
        const name = typeof req.query.name === 'string' ? req.query.name.slice(0, 200) : '';
        const mimeType = typeof req.query.mimeType === 'string' ? req.query.mimeType : 'application/octet-stream';
        if (!name || !Buffer.isBuffer(req.body) || req.body.byteLength === 0) {
          return res.status(400).json({ error: 'Archivo inválido.' });
        }
        if (req.body.byteLength > MAX_DIRECT_UPLOAD_BYTES) {
          return res.status(413).json({ error: 'El archivo supera el límite de carga directa.' });
        }

        const stored = await savePrivateUploadBuffer(req.user!.uid, name, req.body, mimeType);
        res.json(stored);
      } catch (err) {
        sendServerError(res, err, 'No se pudo subir el adjunto.');
      }
    },
  );

  app.get('/api/files/download', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.user!.uid;
      const storagePath = typeof req.query.storagePath === 'string' ? req.query.storagePath : '';
      const mimeType = typeof req.query.mimeType === 'string' ? req.query.mimeType : 'application/octet-stream';
      const displayName = typeof req.query.displayName === 'string' ? req.query.displayName : 'archivo';

      if (!storagePath) return res.status(400).json({ error: 'Ruta de archivo faltante.' });

      if (isUserPrivateBlobPath(uid, storagePath)) {
        const blob = await get(storagePath, { access: 'private' });
        if (!blob?.stream) return res.status(404).json({ error: 'El archivo no está disponible.' });
        res.setHeader('Content-Type', blob.blob.contentType || normalizeMimeType(mimeType));
        res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(displayName)}"`);
        res.setHeader('Cache-Control', 'private, no-store');
        await pipeline(Readable.from(blob.stream as AsyncIterable<Uint8Array>), res);
        return;
      }

      const resolved = resolveUserStoragePath(uid, storagePath);
      const data = await fs.readFile(resolved);
      res.setHeader('Content-Type', normalizeMimeType(mimeType));
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(displayName)}"`);
      res.setHeader('Cache-Control', 'private, no-store');
      res.send(data);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === 'ENOENT') {
        return res.status(404).json({ error: 'El archivo no está disponible en el almacenamiento temporal del servidor.' });
      }
      sendServerError(res, err, 'No se pudo descargar el archivo.');
    }
  });

  app.delete('/api/files/blob', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.user!.uid;
      const storagePath = typeof req.body?.storagePath === 'string' ? req.body.storagePath : '';
      if (storagePath) {
        if (isUserPrivateBlobPath(uid, storagePath)) {
          await del(storagePath);
        } else {
          const resolved = resolveUserStoragePath(uid, storagePath);
          await fs.unlink(resolved).catch(() => {});
        }
      }
      res.json({ ok: true });
    } catch (err) {
      sendServerError(res, err, 'No se pudo eliminar el binario.');
    }
  });

  // =========================================================================
  // REAL GOOGLE CALENDAR API PROXY (USES IN-MEMORY OAUTH ACCESS TOKEN)
  // =========================================================================

  app.post('/api/google-calendar/sync', requireAuth, async (req: AuthRequest, res) => {
    try {
      const googleToken = req.header('X-Google-Access-Token');
      if (!googleToken) {
        return res.status(401).json({
          error: 'Necesitás autorizar el acceso a Google Calendar primero.',
        });
      }

      const timeMin = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const gRes = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events?singleEvents=true&orderBy=startTime&maxResults=40&timeMin=${encodeURIComponent(timeMin)}`,
        {
          headers: { Authorization: `Bearer ${googleToken}` },
        },
      );

      if (!gRes.ok) {
        const errBody = await gRes.json().catch(() => ({}));
        const msg = errBody?.error?.message || 'Token de Google Calendar vencido o sin permisos.';
        return res.status(400).json({ error: msg });
      }

      const data = (await gRes.json()) as {
        items?: Array<{
          id: string;
          summary?: string;
          description?: string;
          location?: string;
          start?: { dateTime?: string; date?: string; timeZone?: string };
          end?: { dateTime?: string; date?: string };
        }>;
      };

      res.json({
        items: data.items || [],
        accountEmail: req.user?.email || null,
      });
    } catch (err) {
      sendServerError(res, err, 'Error al sincronizar con Google Calendar.');
    }
  });

  app.post('/api/google-calendar/events', requireAuth, async (req: AuthRequest, res) => {
    try {
      const googleToken = req.header('X-Google-Access-Token');
      if (!googleToken) {
        return res.status(401).json({ error: 'Falta autorización de Google Calendar.' });
      }
      const { title, description, location, startIso, endIso, allDay, timezone } = req.body ?? {};
      const tz = typeof timezone === 'string' && timezone ? timezone : 'America/Montevideo';
      const gRes = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${googleToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          summary: String(title || 'Evento').slice(0, 180),
          description: typeof description === 'string' && description ? description : undefined,
          location: typeof location === 'string' && location ? location : undefined,
          start: allDay
            ? { date: String(startIso).slice(0, 10) }
            : { dateTime: String(startIso), timeZone: tz },
          end: allDay
            ? { date: String(endIso).slice(0, 10) }
            : { dateTime: String(endIso), timeZone: tz },
        }),
      });
      if (!gRes.ok) {
        const gErr = await gRes.json().catch(() => ({}));
        return res.status(400).json({
          error: gErr?.error?.message || 'Google Calendar rechazó la creación del evento.',
        });
      }
      const createdGoogle = (await gRes.json()) as { id?: string };
      res.status(201).json({ externalEventId: createdGoogle.id || null });
    } catch (err) {
      sendServerError(res, err, 'Error al crear evento en Google Calendar.');
    }
  });

  app.patch('/api/google-calendar/events/:externalId', requireAuth, async (req: AuthRequest, res) => {
    try {
      const googleToken = req.header('X-Google-Access-Token');
      if (!googleToken) {
        return res.status(401).json({ error: 'Falta autorización de Google Calendar.' });
      }
      const externalId = req.params.externalId;
      const { title, description, location, startIso, endIso, timezone } = req.body ?? {};
      const tz = typeof timezone === 'string' && timezone ? timezone : 'America/Montevideo';

      const gRes = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(externalId)}`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${googleToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            summary: title,
            description: description || undefined,
            location: location || undefined,
            start: { dateTime: startIso, timeZone: tz },
            end: { dateTime: endIso, timeZone: tz },
          }),
        },
      );
      if (!gRes.ok) {
        const gErr = await gRes.json().catch(() => ({}));
        return res.status(400).json({
          error: gErr?.error?.message || 'No se pudo actualizar el evento en Google Calendar.',
        });
      }
      res.json({ ok: true });
    } catch (err) {
      sendServerError(res, err, 'Error al actualizar evento en Google Calendar.');
    }
  });

  app.delete('/api/google-calendar/events/:externalId', requireAuth, async (req: AuthRequest, res) => {
    try {
      const googleToken = req.header('X-Google-Access-Token');
      if (googleToken) {
        await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(req.params.externalId)}`,
          {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${googleToken}` },
          },
        ).catch(() => {});
      }
      res.json({ ok: true });
    } catch (err) {
      sendServerError(res, err, 'Error al eliminar evento de Google Calendar.');
    }
  });

  // Error handler for API routes (prevents uncaught Express errors in serverless runtime)
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    sendServerError(res, err, 'Error interno del servidor.');
  });

  async function startLocalServer() {
    if (process.env.NODE_ENV !== 'production') {
      const { createServer: createViteServer } = await import('vite');
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: 'spa',
      });
      app.use(vite.middlewares);
    } else {
      const distDir = path.resolve(process.cwd(), 'dist');
      app.use(express.static(distDir));
      app.get('*', (_req, res) => {
        res.sendFile(path.resolve(distDir, 'index.html'));
      });
    }

    app.listen(PORT, '0.0.0.0', () => {
      console.log(`SILVV MEMORY server listening on http://0.0.0.0:${PORT}`);
      setInterval(() => {
        void runScheduledSummaryCycle();
      }, 15 * 60 * 1000);
    });
  }

  if (!IS_VERCEL) {
    startLocalServer().catch((err) => {
      console.error('Failed to start SILVV MEMORY server:', err);
      process.exit(1);
    });
  }

  export { app };
  export default app;
