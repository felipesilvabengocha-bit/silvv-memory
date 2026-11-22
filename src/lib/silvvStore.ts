import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { auth, db, getGoogleAccessToken, handleFirestoreError, OperationType } from './firebase';
import {
  DEFAULT_MEMORY_EVENT_CATEGORIES,
  type ActionLogItem,
  type AgentConversation,
  type AgentItem,
  type AgentKnowledgeSource,
  type AgentMemory,
  type AgentMessage,
  type AgentPermissionMode,
  type CalendarEventItem,
  type ConversationItem,
  type DashboardData,
  type EventRelationItem,
  type FileItem,
  type FolderItem,
  type GoogleCalendarIntegration,
  type KnowledgeCitation,
  type KnowledgeConversation,
  type KnowledgeMessage,
  type MemoryDetailResponse,
  type MemoryEventItem,
  type MemoryItem,
  type MessageAttachment,
  type MessageItem,
  type NoteAttachment,
  type NoteFolderItem,
  type NoteItem,
  type PersonEntityItem,
  type ProjectItem,
  type ProjectObjective,
  type SearchHit,
  type SummaryRecordItem,
  type SummarySourceItem,
  type TaskItem,
  type UserPreferences,
  type UserProfile,
} from './api';

let lastNumericId = 0;
function nextNumericId(): number {
  const candidate = Date.now() * 100;
  lastNumericId = Math.max(candidate, lastNumericId + 1);
  return lastNumericId;
}

function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefined(item)) as unknown as T;
  }
  if (value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) {
        out[k] = stripUndefined(v);
      }
    }
    return out as T;
  }
  return value;
}

function withRaceTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'carpeta'
  ).slice(0, 100);
}

function normalizeName(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function tsToIso(val: unknown): string {
  if (!val) return new Date().toISOString();
  if (typeof val === 'string') return val;
  if (typeof val === 'object' && val !== null && 'toDate' in val) {
    const d = (val as { toDate: () => Date }).toDate();
    return d.toISOString();
  }
  if (val instanceof Date) return val.toISOString();
  return new Date().toISOString();
}

function parseDateSafe(iso: string | null | undefined): string | null {
  if (!iso || !iso.trim()) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function cosineSimilarity(a: number[] | null | undefined, b: number[] | null | undefined): number {
  if (!a || !b || a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function getZonedDateParts(date: Date, timeZone: string): { year: number; month: number; day: number; weekday: number } {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
    });
    const parts = fmt.formatToParts(date);
    const get = (t: string) => parts.find((p) => p.type === t)?.value || '';
    const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return {
      year: Number(get('year')),
      month: Number(get('month')),
      day: Number(get('day')),
      weekday: map[get('weekday')] ?? 0,
    };
  } catch {
    return {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
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

function getPeriodBounds(kind: 'daily' | 'weekly' | 'monthly', tz: string, requestedKey?: string): {
  periodKey: string;
  startDay: string;
  endDay: string;
} {
  const now = new Date();
  const zp = getZonedDateParts(now, tz);

  if (kind === 'daily') {
    const key =
      requestedKey && /^\d{4}-\d{2}-\d{2}$/.test(requestedKey)
        ? requestedKey
        : `${zp.year}-${pad2(zp.month)}-${pad2(zp.day)}`;
    return { periodKey: key, startDay: key, endDay: key };
  }

  if (kind === 'weekly') {
    if (requestedKey && /^\d{4}-W\d{2}$/.test(requestedKey)) {
      const [yStr, wStr] = requestedKey.split('-W');
      const y = Number(yStr);
      const w = Number(wStr);
      const jan4 = new Date(Date.UTC(y, 0, 4));
      const jan4Day = jan4.getUTCDay() || 7;
      const monday = new Date(jan4.getTime() + ((w - 1) * 7 - (jan4Day - 1)) * 86400000);
      const sunday = new Date(monday.getTime() + 6 * 86400000);
      return {
        periodKey: requestedKey,
        startDay: monday.toISOString().slice(0, 10),
        endDay: sunday.toISOString().slice(0, 10),
      };
    }
    const offsetToMon = (zp.weekday + 6) % 7;
    const mon = new Date(Date.UTC(zp.year, zp.month - 1, zp.day - offsetToMon));
    const sun = new Date(mon.getTime() + 6 * 86400000);
    return {
      periodKey: getIsoWeekKey(zp.year, zp.month, zp.day),
      startDay: mon.toISOString().slice(0, 10),
      endDay: sun.toISOString().slice(0, 10),
    };
  }

  const key =
    requestedKey && /^\d{4}-\d{2}$/.test(requestedKey)
      ? requestedKey
      : `${zp.year}-${pad2(zp.month)}`;
  const [mYear, mMonth] = key.split('-').map(Number);
  const lastDay = new Date(Date.UTC(mYear, mMonth, 0)).getUTCDate();
  return {
    periodKey: key,
    startDay: `${key}-01`,
    endDay: `${key}-${pad2(lastDay)}`,
  };
}

function requireCurrentUser() {
  const user = auth.currentUser;
  if (!user) throw new Error('No hay sesión activa.');
  return user;
}

async function callServerEndpoint<T>(
  path: string,
  method: string,
  body?: unknown,
  includeGoogleToken = false,
): Promise<T> {
  const user = requireCurrentUser();
  const token = await user.getIdToken();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
  if (includeGoogleToken) {
    const gToken = getGoogleAccessToken();
    if (gToken) headers['X-Google-Access-Token'] = gToken;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 35000);
  try {
    const response = await fetch(path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const isJson = response.headers.get('content-type')?.includes('application/json');
    const data = isJson ? await response.json().catch(() => null) : null;
    if (!response.ok) {
      const textFallback = !isJson ? await response.text().catch(() => '') : '';
      throw new Error(
        data?.error ||
          (textFallback && textFallback.length < 240 ? textFallback : '') ||
          `Error del servidor (HTTP ${response.status})`,
      );
    }
    return data as T;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('La solicitud tardó demasiado en responder. Intentá nuevamente.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function listSubcollection<T>(uid: string, sub: string): Promise<Array<T & { id: number }>> {
  const colPath = `users/${uid}/${sub}`;
  try {
    const q = query(collection(db, 'users', uid, sub), where('userUid', '==', uid));
    const snap = await getDocs(q);
    return snap.docs.map((d) => {
      const raw = d.data() as Record<string, unknown>;
      return {
        ...raw,
        createdAt: tsToIso(raw.createdAt),
        updatedAt: tsToIso(raw.updatedAt),
      } as unknown as T & { id: number };
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, colPath);
  }
}

async function getSubdoc<T>(uid: string, sub: string, docId: string): Promise<T | null> {
  const docPath = `users/${uid}/${sub}/${docId}`;
  try {
    const snap = await getDoc(doc(db, 'users', uid, sub, docId));
    if (!snap.exists()) return null;
    const raw = snap.data() as Record<string, unknown>;
    return {
      ...raw,
      createdAt: tsToIso(raw.createdAt),
      updatedAt: tsToIso(raw.updatedAt),
    } as unknown as T;
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, docPath);
  }
}

async function createSubdoc(uid: string, sub: string, docId: string, data: Record<string, unknown>) {
  const docPath = `users/${uid}/${sub}/${docId}`;
  try {
    await setDoc(doc(db, 'users', uid, sub, docId), {
      ...stripUndefined(data),
      userUid: uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, docPath);
  }
}

async function updateSubdoc(uid: string, sub: string, docId: string, patch: Record<string, unknown>) {
  const docPath = `users/${uid}/${sub}/${docId}`;
  try {
    await updateDoc(doc(db, 'users', uid, sub, docId), {
      ...stripUndefined(patch),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, docPath);
  }
}

async function deleteSubdoc(uid: string, sub: string, docId: string) {
  const docPath = `users/${uid}/${sub}/${docId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, sub, docId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, docPath);
  }
}

type StoredFile = FileItem & {
  storagePath: string;
  embedding?: number[] | null;
  deletedAt?: string | null;
};

type StoredMemory = MemoryItem & {
  entities?: string[];
  expiresAt?: string | null;
  embedding?: number[] | null;
  deletedAt?: string | null;
};

type StoredFolder = FolderItem & { deletedAt?: string | null };
type StoredProject = ProjectItem & { folderId?: number | null; deletedAt?: string | null };
type StoredConversation = ConversationItem & { deletedAt?: string | null };
type StoredMessage = MessageItem & { deletedAt?: string | null };
type StoredTask = TaskItem & { sourceMessageId?: number | null; sourceFileId?: number | null; deletedAt?: string | null };
type StoredEvent = CalendarEventItem & {
  sourceMessageId?: number | null;
  sourceFileId?: number | null;
  deletedAt?: string | null;
  createdAt?: string;
};
type StoredNoteFolder = NoteFolderItem & { deletedAt?: string | null };
type StoredNote = NoteItem & { embedding?: number[] | null; deletedAt?: string | null };
type StoredMemoryEvent = MemoryEventItem & { embedding?: number[] | null; deletedAt?: string | null };
type StoredSummaryRecord = SummaryRecordItem & { deletedAt?: string | null };
type StoredAgent = AgentItem & { deletedAt?: string | null };
type StoredAgentSource = AgentKnowledgeSource & {
  storagePath?: string | null;
  embedding?: number[] | null;
  deletedAt?: string | null;
};
type StoredAgentMemory = AgentMemory & { agentId: number };
type StoredKnowledgeConv = KnowledgeConversation & { deletedAt?: string | null };

const bootstrapDone = new Map<string, Promise<void>>();

async function ensureBootstrapped(): Promise<string> {
  const fbUser = requireCurrentUser();
  const uid = fbUser.uid;
  const existing = bootstrapDone.get(uid);
  if (existing) {
    await existing;
    return uid;
  }

  const run = (async () => {
    const userPath = `users/${uid}`;
    let userSnap;
    try {
      userSnap = await getDoc(doc(db, 'users', uid));
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, userPath);
    }
    if (!userSnap.exists()) {
      try {
        await setDoc(doc(db, 'users', uid), {
          uid,
          email: fbUser.email || `${uid}@silvv.local`,
          fullName: fbUser.displayName ? fbUser.displayName.slice(0, 120) : null,
          avatarUrl: fbUser.photoURL ? fbUser.photoURL.slice(0, 1000) : null,
          language: 'es',
          timezone: 'America/Montevideo',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, userPath);
      }
    }

    const pref = await getSubdoc<UserPreferences>(uid, 'preferences', 'default');
    if (!pref) {
      await createSubdoc(uid, 'preferences', 'default', {
        theme: 'dark',
        accentColor: '#7C3AED',
        uiDensity: 'comfortable',
        autonomyLevel: 'balanced',
        autoCreateCalendarEvents: false,
        autoClassifyThreshold: 0.8,
        proactiveNotificationsEnabled: true,
        quietHoursStart: null,
        quietHoursEnd: null,
        disabledMemoryCategories: [],
        customEventCategories: DEFAULT_MEMORY_EVENT_CATEGORIES,
      });
    }

    const existingFolders = await listSubcollection<StoredFolder>(uid, 'folders');
    if (!existingFolders.some((f) => f.isSystem && !f.deletedAt)) {
      const inboxId = nextNumericId();
      await createSubdoc(uid, 'folders', String(inboxId), {
        id: inboxId,
        parentId: null,
        name: 'Bandeja de entrada',
        slug: 'bandeja-de-entrada',
        category: 'General',
        description: 'Archivos sin clasificar o pendientes de confirmación',
        isSystem: true,
        autoCreated: true,
        deletedAt: null,
      });
    }
  })();

  bootstrapDone.set(uid, run);
  try {
    await run;
  } catch (err) {
    bootstrapDone.delete(uid);
    throw err;
  }
  return uid;
}

async function getMe(uid: string) {
  let rawUser: Record<string, unknown> | null = null;
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    rawUser = snap.exists() ? (snap.data() as Record<string, unknown>) : null;
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `users/${uid}`);
  }
  const prefs = await getSubdoc<UserPreferences>(uid, 'preferences', 'default');
  const gcal = await getSubdoc<GoogleCalendarIntegration>(uid, 'integrations', 'google_calendar');

  const user: UserProfile = {
    id: 1,
    uid,
    email: String(rawUser?.email || auth.currentUser?.email || ''),
    fullName: (rawUser?.fullName as string | null) ?? null,
    avatarUrl: (rawUser?.avatarUrl as string | null) ?? null,
    language: String(rawUser?.language || 'es'),
    timezone: String(rawUser?.timezone || 'America/Montevideo'),
  };

  const preferences: UserPreferences = prefs
    ? {
        ...prefs,
        customEventCategories:
          Array.isArray(prefs.customEventCategories) && prefs.customEventCategories.length > 0
            ? prefs.customEventCategories
            : DEFAULT_MEMORY_EVENT_CATEGORIES,
      }
    : {
        userUid: uid,
        theme: 'dark',
        accentColor: '#7C3AED',
        uiDensity: 'comfortable',
        autonomyLevel: 'balanced',
        autoCreateCalendarEvents: false,
        autoClassifyThreshold: 0.8,
        proactiveNotificationsEnabled: true,
        quietHoursStart: null,
        quietHoursEnd: null,
        disabledMemoryCategories: [],
        customEventCategories: DEFAULT_MEMORY_EVENT_CATEGORIES,
      };

  return { user, preferences, googleCalendarIntegration: gcal };
}

async function patchMe(uid: string, body: Record<string, unknown>) {
  const {
    fullName,
    language,
    timezone,
    theme,
    accentColor,
    uiDensity,
    autonomyLevel,
    autoCreateCalendarEvents,
    autoClassifyThreshold,
    proactiveNotificationsEnabled,
    quietHoursStart,
    quietHoursEnd,
    disabledMemoryCategories,
    customEventCategories,
  } = body;

  const userPatch: Record<string, unknown> = {};
  if (typeof fullName === 'string') userPatch.fullName = fullName.slice(0, 120);
  if (typeof language === 'string' && language.trim()) userPatch.language = language.slice(0, 20);
  if (typeof timezone === 'string' && timezone.trim()) userPatch.timezone = timezone.slice(0, 64);

  if (Object.keys(userPatch).length > 0) {
    try {
      await updateDoc(doc(db, 'users', uid), { ...userPatch, updatedAt: serverTimestamp() });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${uid}`);
    }
  }

  const prefPatch: Record<string, unknown> = {};
  if (theme === 'dark' || theme === 'light' || theme === 'system') prefPatch.theme = theme;
  if (typeof accentColor === 'string' && accentColor.trim()) prefPatch.accentColor = accentColor.slice(0, 24);
  if (uiDensity === 'comfortable' || uiDensity === 'compact') prefPatch.uiDensity = uiDensity;
  if (autonomyLevel === 'manual' || autonomyLevel === 'balanced' || autonomyLevel === 'proactive') {
    prefPatch.autonomyLevel = autonomyLevel;
  }
  if (typeof autoCreateCalendarEvents === 'boolean') {
    prefPatch.autoCreateCalendarEvents = autoCreateCalendarEvents;
  }
  if (typeof autoClassifyThreshold === 'number') {
    prefPatch.autoClassifyThreshold = Math.min(1, Math.max(0.3, autoClassifyThreshold));
  }
  if (typeof proactiveNotificationsEnabled === 'boolean') {
    prefPatch.proactiveNotificationsEnabled = proactiveNotificationsEnabled;
  }
  if (typeof quietHoursStart === 'string') prefPatch.quietHoursStart = quietHoursStart.slice(0, 16);
  if (typeof quietHoursEnd === 'string') prefPatch.quietHoursEnd = quietHoursEnd.slice(0, 16);
  if (Array.isArray(disabledMemoryCategories)) {
    prefPatch.disabledMemoryCategories = disabledMemoryCategories.map(String).slice(0, 30);
  }
  if (Array.isArray(customEventCategories)) {
    prefPatch.customEventCategories = customEventCategories
      .map((c) => String(c).trim())
      .filter(Boolean)
      .slice(0, 40);
  }

  if (Object.keys(prefPatch).length > 0) {
    await updateSubdoc(uid, 'preferences', 'default', prefPatch);
  }

  return getMe(uid);
}

async function getDashboard(uid: string): Promise<DashboardData> {
  const nowIso = new Date().toISOString();
  const [
    eventsAll,
    tasksAll,
    projectsAll,
    memsAll,
    filesAll,
    foldersAll,
    convsAll,
    agentsAll,
    actionsAll,
    notesAll,
    noteFoldersAll,
    memEventsAll,
    dailyAll,
    weeklyAll,
  ] = await Promise.all([
    listSubcollection<StoredEvent>(uid, 'calendarEvents'),
    listSubcollection<StoredTask>(uid, 'tasks'),
    listSubcollection<StoredProject>(uid, 'projects'),
    listSubcollection<StoredMemory>(uid, 'memories'),
    listSubcollection<StoredFile>(uid, 'files'),
    listSubcollection<StoredFolder>(uid, 'folders'),
    listSubcollection<StoredConversation>(uid, 'conversations'),
    listSubcollection<StoredAgent>(uid, 'agents'),
    listSubcollection<ActionLogItem>(uid, 'actionsLog'),
    listSubcollection<StoredNote>(uid, 'notes'),
    listSubcollection<StoredNoteFolder>(uid, 'noteFolders'),
    listSubcollection<StoredMemoryEvent>(uid, 'memoryEvents'),
    listSubcollection<StoredSummaryRecord>(uid, 'dailySummaries'),
    listSubcollection<StoredSummaryRecord>(uid, 'weeklySummaries'),
  ]);

  const upcomingEvents = eventsAll
    .filter((e) => !e.deletedAt && e.endAt >= nowIso)
    .sort((a, b) => a.startAt.localeCompare(b.startAt))
    .slice(0, 8);

  const pendingTasks = tasksAll
    .filter((t) => !t.deletedAt && t.status === 'pending')
    .sort((a, b) => {
      if (a.dueAt && b.dueAt) return a.dueAt.localeCompare(b.dueAt);
      if (a.dueAt) return -1;
      if (b.dueAt) return 1;
      return b.createdAt.localeCompare(a.createdAt);
    })
    .slice(0, 12);

  const activeProjects = projectsAll
    .filter((p) => !p.deletedAt)
    .sort((a, b) => {
      if (a.isPriority !== b.isPriority) return a.isPriority ? -1 : 1;
      return b.lastActivityAt.localeCompare(a.lastActivityAt);
    })
    .slice(0, 8);

  const recentMemories = memsAll
    .filter((m) => !m.deletedAt)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 12)
    .map(({ embedding: _e, ...rest }) => rest);

  const recentFiles = filesAll
    .filter((f) => !f.deletedAt)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 10)
    .map(({ embedding: _e, ...rest }) => rest);

  const folders = foldersAll
    .filter((f) => !f.deletedAt)
    .sort((a, b) => a.name.localeCompare(b.name));

  const recentConversations = convsAll
    .filter((c) => !c.deletedAt && !c.isArchived)
    .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt))
    .slice(0, 6);

  const createdAgents = agentsAll
    .filter((a) => !a.deletedAt && !a.isArchived)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 6);

  const recentNotes = notesAll
    .filter((n) => !n.deletedAt && !n.isArchived)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 6)
    .map(({ embedding: _e, ...rest }) => rest);

  const recentNoteFolders = noteFoldersAll
    .filter((nf) => !nf.deletedAt)
    .sort((a, b) => a.name.localeCompare(b.name));

  const recentMemoryEvents = memEventsAll
    .filter((me) => !me.deletedAt)
    .sort((a, b) => (b.eventDate || b.createdAt).localeCompare(a.eventDate || a.createdAt))
    .slice(0, 8)
    .map(({ embedding: _e, ...rest }) => rest);

  const latestDailySummary =
    dailyAll
      .filter((s) => !s.deletedAt)
      .sort((a, b) => b.periodKey.localeCompare(a.periodKey))[0] || null;

  const latestWeeklySummary =
    weeklyAll
      .filter((s) => !s.deletedAt)
      .sort((a, b) => b.periodKey.localeCompare(a.periodKey))[0] || null;

  const recentActions = actionsAll
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 15);

  return {
    upcomingEvents,
    pendingTasks,
    activeProjects,
    recentMemories,
    recentFiles,
    folders,
    recentConversations,
    createdAgents,
    recentNotes,
    recentNoteFolders,
    recentMemoryEvents,
    latestDailySummary,
    latestWeeklySummary,
    unreadNotifications: [],
    recentActions,
  };
}

interface GeminiChatAnalysis {
  reply: string;
  classifications: string[];
  detectedCategory: string;
  classificationConfidence: number;
  suggestedParentFolderName: string;
  suggestedFolderName: string;
  extractedSummary: string;
  extractedText: string;
  memoriesToSave: Array<{
    layer: 'episodic' | 'semantic' | 'project' | 'temporal';
    originKind: string;
    category: string;
    title: string;
    content: string;
    tags: string[];
    importance: number;
    confidence: number;
    entities: string[];
    expiresAtIso: string;
  }>;
  proposedTasks: Array<{
    title: string;
    description: string;
    kind: 'task' | 'deadline' | 'reminder';
    priority: 'low' | 'medium' | 'high' | 'urgent';
    dueAtIso: string;
    projectName: string;
  }>;
  proposedEvents: Array<{
    title: string;
    description: string;
    category: string;
    location: string;
    startAtIso: string;
    endAtIso: string;
    allDay: boolean;
    ambiguousReason: string;
  }>;
  proposedMemoryEvents: Array<{
    title: string;
    description: string;
    eventDateIso: string;
    datePrecision: 'exact' | 'day' | 'approximate' | 'unknown';
    dateLabel: string;
    category: string;
    people: string[];
    projectName: string;
    tags: string[];
    importance: number;
  }>;
  proposedNoteAction: {
    action: 'none' | 'create' | 'propose_edit';
    targetNoteId: number | null;
    folderCategory: 'Estudios' | 'Vida diaria';
    folderName: string;
    title: string;
    content: string;
    tags: string[];
    isQuick: boolean;
    reason: string;
  } | null;
  proposedProject: {
    shouldCreate: boolean;
    name: string;
    description: string;
    category: string;
    targetDate: string;
    objectives: string[];
  } | null;
}

async function processChatTurn(params: {
  uid: string;
  convId: number;
  projectId: number | null;
  userMsgId: number;
  userText: string;
  linkUrl?: string;
  rawAttachments: Array<{ name: string; mimeType: string; base64Data: string }>;
}) {
  const { uid, convId, projectId, userMsgId, userText, linkUrl, rawAttachments } = params;
  const nowIso = new Date().toISOString();

  const [
    { user, preferences },
    allProjects,
    allFolders,
    allMemories,
    allTasks,
    allEvents,
    convMsgs,
    allNotes,
    allNoteFolders,
    allMemoryEvents,
    allPeople,
  ] = await Promise.all([
    getMe(uid),
    listSubcollection<StoredProject>(uid, 'projects'),
    listSubcollection<StoredFolder>(uid, 'folders'),
    listSubcollection<StoredMemory>(uid, 'memories'),
    listSubcollection<StoredTask>(uid, 'tasks'),
    listSubcollection<StoredEvent>(uid, 'calendarEvents'),
    listSubcollection<StoredMessage>(uid, 'messages'),
    listSubcollection<StoredNote>(uid, 'notes'),
    listSubcollection<StoredNoteFolder>(uid, 'noteFolders'),
    listSubcollection<StoredMemoryEvent>(uid, 'memoryEvents'),
    listSubcollection<PersonEntityItem>(uid, 'peopleEntities'),
  ]);

  const activeProjects = allProjects.filter((p) => !p.deletedAt);
  const activeFolders = allFolders.filter((f) => !f.deletedAt);
  const activeMemories = allMemories.filter((m) => !m.deletedAt && m.isActive);
  const activeNotes = allNotes.filter((n) => !n.deletedAt && !n.isArchived);
  const activeNoteFolders = allNoteFolders.filter((nf) => !nf.deletedAt);
  const activeMemoryEvents = allMemoryEvents.filter((me) => !me.deletedAt);
  const pendingTasksList = allTasks.filter((t) => !t.deletedAt && t.status === 'pending');
  const upcomingEventsList = allEvents.filter((e) => !e.deletedAt && e.endAt >= nowIso);

  const history = convMsgs
    .filter((m) => !m.deletedAt && m.conversationId === convId && m.id !== userMsgId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(-12)
    .map((m) => ({ role: m.role, content: m.content }));

  const autonomyLevel = preferences.autonomyLevel || 'balanced';
  const threshold = preferences.autoClassifyThreshold ?? 0.8;
  const disabledCats = new Set((preferences.disabledMemoryCategories || []).map((c) => c.toLowerCase()));
  const availableCategories =
    preferences.customEventCategories && preferences.customEventCategories.length > 0
      ? preferences.customEventCategories
      : DEFAULT_MEMORY_EVENT_CATEGORIES;

  let queryEmbedding: number[] | null = null;
  const hasEmbeddedData =
    activeMemories.some((m) => Array.isArray(m.embedding) && m.embedding.length > 0) ||
    activeNotes.some((n) => Array.isArray(n.embedding) && n.embedding.length > 0) ||
    activeMemoryEvents.some((e) => Array.isArray(e.embedding) && e.embedding.length > 0);

  if (userText && hasEmbeddedData) {
    const embRes = await withRaceTimeout(
      callServerEndpoint<{ embedding: number[] | null }>('/api/ai/embed', 'POST', {
        text: userText,
      }).catch(() => ({ embedding: null })),
      2000,
      { embedding: null },
    );
    queryEmbedding = embRes.embedding;
  }

  const queryKeywords = userText
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length >= 3);

  const scoreKeywords = (hay: string) => {
    const lower = hay.toLowerCase();
    let score = 0;
    for (const k of queryKeywords) {
      if (lower.includes(k)) score += 0.35;
    }
    return score;
  };

  const rankedMemories = activeMemories
    .filter((m) => !disabledCats.has(m.category.toLowerCase()))
    .map((m) => {
      const sim = queryEmbedding ? cosineSimilarity(queryEmbedding, m.embedding) : 0;
      const kw = scoreKeywords(`${m.title || ''} ${m.content} ${m.category}`);
      return { m, score: sim * 2 + kw + m.importance * 0.15 };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 12)
    .map(({ m }) => ({
      layer: m.memoryLayer,
      originKind: m.originKind,
      category: m.category,
      content: m.content,
      createdAt: m.createdAt,
    }));

  const rankedNotes = activeNotes
    .map((n) => {
      const sim = queryEmbedding ? cosineSimilarity(queryEmbedding, n.embedding) : 0;
      const kw = scoreKeywords(`${n.title} ${n.content} ${(n.tags || []).join(' ')}`);
      return { n, score: sim * 2 + kw + (n.isPinned ? 0.1 : 0) };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map(({ n }) => ({
      id: n.id,
      title: n.title,
      content: n.content.slice(0, 1500),
      tags: n.tags || [],
      folderName: activeNoteFolders.find((f) => f.id === n.folderId)?.name || null,
      updatedAt: n.updatedAt,
    }));

  const rankedMemoryEvents = activeMemoryEvents
    .map((me) => {
      const sim = queryEmbedding ? cosineSimilarity(queryEmbedding, me.embedding) : 0;
      const kw = scoreKeywords(`${me.title} ${me.description} ${me.people.join(' ')} ${me.category}`);
      return { me, score: sim * 2 + kw + me.importance * 0.1 };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map(({ me }) => ({
      id: me.id,
      title: me.title,
      description: me.description.slice(0, 600),
      eventDate: me.eventDate,
      dateLabel: me.dateLabel,
      category: me.category,
      people: me.people || [],
    }));

  const aiRes = await callServerEndpoint<{
    analysis: GeminiChatAnalysis;
    storedAttachments: Array<{
      name: string;
      mimeType: string;
      fileKind: 'image' | 'pdf' | 'document' | 'audio' | 'other';
      storagePath: string;
      sizeBytes: number;
    }>;
    memoryEmbeddings: Array<number[] | null>;
    fileEmbedding: number[] | null;
    memoryEventEmbeddings: Array<number[] | null>;
    noteEmbedding: number[] | null;
  }>('/api/ai/chat', 'POST', {
    userText,
    linkUrl,
    attachments: rawAttachments,
    context: {
      timezone: user.timezone || 'America/Montevideo',
      nowIso,
      activeProjects: activeProjects.slice(0, 20).map((p) => ({
        id: p.id,
        name: p.name,
        category: p.category,
        status: p.status,
      })),
      activeFolders: activeFolders.slice(0, 50).map((f) => ({
        id: f.id,
        parentId: f.parentId,
        name: f.name,
        category: f.category,
      })),
      relevantMemories: rankedMemories,
      relevantNotes: rankedNotes,
      relevantMemoryEvents: rankedMemoryEvents,
      availableCategories,
      pendingTasks: pendingTasksList.slice(0, 15).map((t) => ({
        id: t.id,
        title: t.title,
        dueAt: t.dueAt,
        priority: t.priority,
      })),
      upcomingEvents: upcomingEventsList.slice(0, 12).map((e) => ({
        id: e.id,
        title: e.title,
        startAt: e.startAt,
        endAt: e.endAt,
      })),
      recentHistory: history,
    },
  });

  const {
    analysis,
    storedAttachments,
    memoryEmbeddings,
    fileEmbedding,
    memoryEventEmbeddings,
    noteEmbedding,
  } = aiRes;
  const inboxFolder = activeFolders.find((f) => f.isSystem);
  let assignedFolderId: number | null = inboxFolder?.id ?? null;
  let fileStatus: 'analyzed' | 'organized' | 'pending_confirmation' = 'analyzed';

  const writePromises: Array<Promise<unknown>> = [];

  if (storedAttachments.length > 0) {
    const parentName = analysis.suggestedParentFolderName?.trim();
    const targetName = (analysis.suggestedFolderName || analysis.detectedCategory || 'General').trim();

    if (analysis.classificationConfidence >= threshold && autonomyLevel !== 'manual') {
      let parentId: number | null = null;
      if (parentName && parentName.toLowerCase() !== targetName.toLowerCase()) {
        const existingParent = activeFolders.find(
          (f) => f.name.toLowerCase() === parentName.toLowerCase() && !f.parentId,
        );
        if (existingParent) {
          parentId = existingParent.id;
        } else {
          parentId = nextNumericId();
          writePromises.push(
            createSubdoc(uid, 'folders', String(parentId), {
              id: parentId,
              parentId: null,
              name: parentName.slice(0, 80),
              slug: slugify(parentName),
              category: analysis.detectedCategory.slice(0, 64),
              description: null,
              isSystem: false,
              autoCreated: true,
              deletedAt: null,
            }),
          );
        }
      }

      const existingTarget = activeFolders.find(
        (f) => f.name.toLowerCase() === targetName.toLowerCase() && (parentId ? f.parentId === parentId : true),
      );
      if (existingTarget) {
        assignedFolderId = existingTarget.id;
      } else {
        assignedFolderId = nextNumericId();
        writePromises.push(
          createSubdoc(uid, 'folders', String(assignedFolderId), {
            id: assignedFolderId,
            parentId,
            name: targetName.slice(0, 80),
            slug: slugify(targetName),
            category: analysis.detectedCategory.slice(0, 64),
            description: null,
            isSystem: false,
            autoCreated: true,
            deletedAt: null,
          }),
        );
      }
      fileStatus = 'organized';
    } else {
      fileStatus = 'pending_confirmation';
    }
  }

  const uploadedFileIds: number[] = [];
  const msgAttachments: MessageAttachment[] = [];

  for (const att of storedAttachments) {
    const fileId = nextNumericId();
    uploadedFileIds.push(fileId);
    writePromises.push(
      createSubdoc(uid, 'files', String(fileId), {
        id: fileId,
        folderId: assignedFolderId,
        projectId,
        storagePath: att.storagePath.slice(0, 512),
        originalName: att.name.slice(0, 200),
        displayName: att.name.slice(0, 200),
        mimeType: att.mimeType.slice(0, 120),
        sizeBytes: att.sizeBytes,
        fileKind: att.fileKind,
        extractedText: analysis.extractedText ? analysis.extractedText.slice(0, 65000) : null,
        aiSummary: analysis.extractedSummary ? analysis.extractedSummary.slice(0, 16000) : null,
        detectedCategory: analysis.detectedCategory.slice(0, 64),
        classificationConfidence: analysis.classificationConfidence,
        processingStatus: fileStatus,
        errorMessage: null,
        embedding: fileEmbedding ? fileEmbedding.slice(0, 4096) : null,
        deletedAt: null,
      }),
    );

    msgAttachments.push({
      id: nextNumericId(),
      fileId,
      attachmentType: att.fileKind,
      externalUrl: null,
      fileName: att.name,
      mimeType: att.mimeType,
      aiSummary: analysis.extractedSummary || null,
      detectedCategory: analysis.detectedCategory || null,
    });
  }

  if (linkUrl) {
    msgAttachments.push({
      id: nextNumericId(),
      fileId: null,
      attachmentType: 'link',
      externalUrl: linkUrl,
      fileName: null,
      mimeType: null,
      aiSummary: null,
      detectedCategory: null,
    });
  }

  // Save multi-layer memories
  const savedMemories: NonNullable<MessageItem['metadata']['savedMemories']> = [];
  for (let i = 0; i < analysis.memoriesToSave.length; i++) {
    const mem = analysis.memoriesToSave[i];
    if (!mem.content || disabledCats.has((mem.category || '').toLowerCase())) continue;

    const isDuplicate = activeMemories.some(
      (existing) => existing.content.trim().toLowerCase() === mem.content.trim().toLowerCase(),
    );
    if (isDuplicate) continue;

    const layer = ['episodic', 'semantic', 'project', 'temporal'].includes(mem.layer)
      ? mem.layer
      : 'semantic';
    const originKind = [
      'fact',
      'preference',
      'opinion',
      'idea',
      'decision',
      'commitment',
      'academic',
      'professional',
      'temporal',
    ].includes(mem.originKind)
      ? mem.originKind
      : 'fact';

    const memId = nextNumericId();
    const cleanContent = mem.content.trim().slice(0, 16000);
    const cleanCategory = (mem.category || analysis.detectedCategory || 'General').slice(0, 64);
    const cleanTitle = mem.title ? mem.title.slice(0, 200) : null;
    const emb = memoryEmbeddings[i] ?? null;

    writePromises.push(
      createSubdoc(uid, 'memories', String(memId), {
        id: memId,
        memoryLayer: layer,
        originKind,
        category: cleanCategory,
        title: cleanTitle,
        content: cleanContent,
        tags: Array.isArray(mem.tags) ? mem.tags.map(String).slice(0, 16) : [],
        entities: Array.isArray(mem.entities) ? mem.entities.map(String).slice(0, 20) : [],
        importance: Math.min(5, Math.max(1, Math.round(mem.importance || 3))),
        confidence: Math.min(1, Math.max(0.1, mem.confidence || 0.85)),
        isActive: true,
        projectId,
        folderId: assignedFolderId,
        sourceType:
          storedAttachments.length > 0
            ? storedAttachments[0].fileKind
            : linkUrl
            ? 'link'
            : 'message',
        sourceConversationId: convId,
        sourceMessageId: userMsgId,
        sourceFileId: uploadedFileIds[0] ?? null,
        expiresAt: parseDateSafe(mem.expiresAtIso),
        embedding: emb ? emb.slice(0, 4096) : null,
        deletedAt: null,
      }),
    );

    savedMemories.push({
      id: memId,
      title: cleanTitle,
      content: cleanContent,
      category: cleanCategory,
      layer,
      originKind,
    });
  }

  const executedOrPendingActions: NonNullable<MessageItem['metadata']['actions']> = [];
  const createdNotes: NonNullable<MessageItem['metadata']['createdNotes']> = [];
  const createdMemoryEvents: NonNullable<MessageItem['metadata']['createdMemoryEvents']> = [];

  // Process Note Action (Create automatically, Propose Edit with explicit confirmation)
  if (analysis.proposedNoteAction) {
    const na = analysis.proposedNoteAction;
    if (na.action === 'create' && (na.title || na.content)) {
      const noteTitle = (na.title || 'Nota sin título').trim().slice(0, 200);
      const noteContent = (na.content || userText || '').trim().slice(0, 65000);
      const duplicateNote = activeNotes.find(
        (n) =>
          n.title.trim().toLowerCase() === noteTitle.toLowerCase() &&
          n.content.trim().toLowerCase() === noteContent.toLowerCase(),
      );
      if (!duplicateNote) {
        const folderCategory = na.folderCategory === 'Estudios' ? 'Estudios' : 'Vida diaria';
        let targetNoteFolderId =
          activeNoteFolders.find(
            (folder) => folder.parentId == null && normalizeName(folder.name) === normalizeName(folderCategory),
          )?.id ?? null;

        if (targetNoteFolderId === null) {
          targetNoteFolderId = nextNumericId();
          writePromises.push(
            createSubdoc(uid, 'noteFolders', String(targetNoteFolderId), {
              id: targetNoteFolderId,
              parentId: null,
              name: folderCategory,
              color: folderCategory === 'Estudios' ? '#8B5CF6' : '#3B82F6',
              deletedAt: null,
            }),
          );
        }

        const rawSubfolderName = (na.folderName || '').trim();
        const subfolderName = rawSubfolderName.split(/[\\/]/).pop()?.trim().slice(0, 48) || '';
        if (subfolderName && normalizeName(subfolderName) !== normalizeName(folderCategory)) {
          const existingSubfolder = activeNoteFolders.find(
            (folder) =>
              folder.parentId === targetNoteFolderId &&
              normalizeName(folder.name) === normalizeName(subfolderName),
          );
          if (existingSubfolder) {
            targetNoteFolderId = existingSubfolder.id;
          } else {
            const subfolderId = nextNumericId();
            writePromises.push(
              createSubdoc(uid, 'noteFolders', String(subfolderId), {
                id: subfolderId,
                parentId: targetNoteFolderId,
                name: subfolderName,
                color: folderCategory === 'Estudios' ? '#8B5CF6' : '#3B82F6',
                deletedAt: null,
              }),
            );
            targetNoteFolderId = subfolderId;
          }
        }
        const noteId = nextNumericId();
        writePromises.push(
          createSubdoc(uid, 'notes', String(noteId), {
            id: noteId,
            folderId: targetNoteFolderId,
            projectId,
            title: noteTitle,
            content: noteContent,
            tags: Array.isArray(na.tags) ? na.tags.map(String).slice(0, 20) : [],
            isQuick: Boolean(na.isQuick),
            isPinned: false,
            isArchived: false,
            attachments: [],
            sourceConversationId: convId,
            sourceMessageId: userMsgId,
            embedding: noteEmbedding ? noteEmbedding.slice(0, 4096) : null,
            deletedAt: null,
          }),
        );
        createdNotes.push({ id: noteId, title: noteTitle, isQuick: Boolean(na.isQuick) });
      }
    } else if (na.action === 'propose_edit' && na.targetNoteId) {
      const target = activeNotes.find((n) => n.id === na.targetNoteId);
      if (target) {
        const logId = nextNumericId();
        writePromises.push(
          createSubdoc(uid, 'actionsLog', String(logId), {
            id: logId,
            toolName: 'update_note',
            status: 'requested',
            inputPayload: {
              targetNoteId: target.id,
              title: (na.title || target.title).slice(0, 200),
              content: (na.content || target.content).slice(0, 65000),
              tags: Array.isArray(na.tags) && na.tags.length > 0 ? na.tags : target.tags,
              reason: na.reason || 'Actualización solicitada en conversación',
            },
            outputPayload: {},
            errorMessage: null,
            requiresConfirmation: true,
            confirmedByUser: false,
          }),
        );
        executedOrPendingActions.push({
          actionLogId: logId,
          toolName: 'update_note',
          status: 'requested',
          summary: `Confirmar actualización de nota: ${target.title}`,
          payload: {
            targetNoteId: target.id,
            title: na.title || target.title,
            content: na.content || target.content,
          },
        });
      }
    }
  }

  // Process Agenda Memoria Events automatically (NO confirmation interruption!)
  const personCache = new Map<string, PersonEntityItem>();
  for (const p of allPeople) {
    personCache.set(p.normalizedName, p);
  }

  for (let i = 0; i < (analysis.proposedMemoryEvents || []).length; i++) {
    const mev = analysis.proposedMemoryEvents[i];
    if (!mev.title || !mev.description) continue;
    const cleanTitle = mev.title.trim().slice(0, 200);
    const cleanDesc = mev.description.trim().slice(0, 16000);
    const evDate = parseDateSafe(mev.eventDateIso);
    const datePrecision = ['exact', 'day', 'approximate', 'unknown'].includes(mev.datePrecision)
      ? mev.datePrecision
      : evDate
      ? 'day'
      : 'unknown';

    // Deduplicate against existing memory events on same title & date
    const isDupEvent = activeMemoryEvents.some(
      (ex) =>
        ex.title.trim().toLowerCase() === cleanTitle.toLowerCase() &&
        ((evDate && ex.eventDate && ex.eventDate.slice(0, 10) === evDate.slice(0, 10)) ||
          ex.description.trim().toLowerCase() === cleanDesc.toLowerCase()),
    );
    if (isDupEvent) continue;

    const matchedProj = mev.projectName
      ? activeProjects.find((p) => p.name.toLowerCase() === mev.projectName.toLowerCase())
      : undefined;
    const peopleList = Array.isArray(mev.people)
      ? Array.from(new Set(mev.people.map((x) => String(x).trim()).filter(Boolean))).slice(0, 30)
      : [];

    const mevId = nextNumericId();
    const emb = memoryEventEmbeddings?.[i] ?? null;

    writePromises.push(
      createSubdoc(uid, 'memoryEvents', String(mevId), {
        id: mevId,
        title: cleanTitle,
        description: cleanDesc,
        eventDate: evDate,
        datePrecision,
        dateLabel: mev.dateLabel ? mev.dateLabel.slice(0, 120) : evDate ? evDate.slice(0, 10) : 'Sin fecha precisa',
        category: (mev.category || 'Vida personal').slice(0, 64),
        people: peopleList,
        projectId: matchedProj?.id ?? projectId,
        sourceConversationId: convId,
        sourceMessageId: userMsgId,
        sourceMessageText: userText.slice(0, 4000) || null,
        relatedFileIds: uploadedFileIds.slice(0, 30),
        relatedNoteIds: createdNotes.map((cn) => cn.id).slice(0, 30),
        tags: Array.isArray(mev.tags) ? mev.tags.map(String).slice(0, 20) : [],
        importance: Math.min(5, Math.max(1, Math.round(mev.importance || 3))),
        embedding: emb ? emb.slice(0, 4096) : null,
        deletedAt: null,
      }),
    );

    createdMemoryEvents.push({
      id: mevId,
      title: cleanTitle,
      category: (mev.category || 'Vida personal').slice(0, 64),
      dateLabel: mev.dateLabel || (evDate ? evDate.slice(0, 10) : null),
      people: peopleList,
    });

    // Upsert tracked people + eventRelations
    for (const pName of peopleList) {
      const norm = normalizeName(pName);
      if (!norm) continue;
      let person = personCache.get(norm);
      if (!person) {
        const pId = nextNumericId();
        person = {
          id: pId,
          name: pName.slice(0, 120),
          normalizedName: norm.slice(0, 120),
          relationship: null,
          notes: null,
          mentionCount: 1,
          lastMentionedAt: evDate || nowIso,
          createdAt: nowIso,
        };
        personCache.set(norm, person);
        writePromises.push(
          createSubdoc(uid, 'peopleEntities', String(pId), {
            id: pId,
            name: person.name,
            normalizedName: person.normalizedName,
            relationship: null,
            notes: null,
            mentionCount: 1,
            lastMentionedAt: person.lastMentionedAt,
          }),
        );
      } else {
        person.mentionCount += 1;
        writePromises.push(
          updateSubdoc(uid, 'peopleEntities', String(person.id), {
            mentionCount: person.mentionCount,
            lastMentionedAt: evDate || nowIso,
          }),
        );
      }

      const relId = nextNumericId();
      writePromises.push(
        createSubdoc(uid, 'eventRelations', String(relId), {
          id: relId,
          sourceEventId: mevId,
          targetType: 'person',
          targetId: person.id,
          targetLabel: person.name.slice(0, 200),
          relationKind: 'involves_person',
        }),
      );

      // Link to most recent prior memory event involving the same person
      const prevPersonEvent = activeMemoryEvents.find((oldEv) =>
        oldEv.people.some((op) => normalizeName(op) === norm),
      );
      if (prevPersonEvent) {
        const relEvId = nextNumericId();
        writePromises.push(
          createSubdoc(uid, 'eventRelations', String(relEvId), {
            id: relEvId,
            sourceEventId: mevId,
            targetType: 'memory_event',
            targetId: prevPersonEvent.id,
            targetLabel: prevPersonEvent.title.slice(0, 200),
            relationKind: `same_person:${person.name}`.slice(0, 64),
          }),
        );
      }
    }

    if (matchedProj) {
      const relProjId = nextNumericId();
      writePromises.push(
        createSubdoc(uid, 'eventRelations', String(relProjId), {
          id: relProjId,
          sourceEventId: mevId,
          targetType: 'project',
          targetId: matchedProj.id,
          targetLabel: matchedProj.name.slice(0, 200),
          relationKind: 'belongs_to_project',
        }),
      );
    }
  }

  // Process Tasks
  for (const task of analysis.proposedTasks) {
    if (!task.title) continue;
    if (autonomyLevel !== 'manual') {
      const matchedProject = task.projectName
        ? activeProjects.find((p) => p.name.toLowerCase() === task.projectName.toLowerCase())
        : undefined;
      const taskId = nextNumericId();
      writePromises.push(
        createSubdoc(uid, 'tasks', String(taskId), {
          id: taskId,
          projectId: matchedProject?.id ?? projectId,
          title: task.title.slice(0, 180),
          description: task.description ? task.description.slice(0, 2000) : null,
          kind: ['task', 'deadline', 'reminder'].includes(task.kind) ? task.kind : 'task',
          status: 'pending',
          priority: ['low', 'medium', 'high', 'urgent'].includes(task.priority) ? task.priority : 'medium',
          dueAt: parseDateSafe(task.dueAtIso),
          completedAt: null,
          sourceMessageId: userMsgId,
          sourceFileId: uploadedFileIds[0] ?? null,
          deletedAt: null,
        }),
      );

      const logId = nextNumericId();
      writePromises.push(
        createSubdoc(uid, 'actionsLog', String(logId), {
          id: logId,
          toolName: 'create_task',
          status: 'executed',
          inputPayload: task as unknown as Record<string, unknown>,
          outputPayload: { taskId },
          errorMessage: null,
          requiresConfirmation: false,
          confirmedByUser: false,
        }),
      );

      executedOrPendingActions.push({
        actionLogId: logId,
        toolName: 'create_task',
        status: 'executed',
        summary: `Tarea creada: ${task.title.slice(0, 180)}`,
        payload: { taskId, ...task },
      });
    } else {
      const logId = nextNumericId();
      writePromises.push(
        createSubdoc(uid, 'actionsLog', String(logId), {
          id: logId,
          toolName: 'create_task',
          status: 'requested',
          inputPayload: { ...task, sourceMessageId: userMsgId, sourceFileId: uploadedFileIds[0] ?? null },
          outputPayload: {},
          errorMessage: null,
          requiresConfirmation: true,
          confirmedByUser: false,
        }),
      );

      executedOrPendingActions.push({
        actionLogId: logId,
        toolName: 'create_task',
        status: 'requested',
        summary: `Crear tarea: ${task.title}`,
        payload: task as unknown as Record<string, unknown>,
      });
    }
  }

  // Process Agenda Real future events (filter out past anecdotes that belong in Agenda Memoria)
  const isPurePastAnecdote =
    (analysis.classifications.includes('acontecimiento_pasado') ||
      analysis.classifications.includes('acontecimiento_presente')) &&
    !analysis.classifications.includes('compromiso_futuro');

  for (const ev of isPurePastAnecdote ? [] : analysis.proposedEvents) {
    const startIso = parseDateSafe(ev.startAtIso);
    if (!ev.title || !startIso) continue;
    const startMs = new Date(startIso).getTime();
    // Do not auto-add past events to Agenda Real unless unambiguously future
    if (startMs < Date.now() - 2 * 3600000) continue;

    const endIso = parseDateSafe(ev.endAtIso) || new Date(startMs + 3600000).toISOString();
    const endMs = new Date(endIso).getTime();

    const duplicateEvent = upcomingEventsList.find(
      (existing) =>
        existing.title.toLowerCase() === ev.title.toLowerCase() &&
        Math.abs(new Date(existing.startAt).getTime() - startMs) < 15 * 60 * 1000,
    );
    if (duplicateEvent) continue;

    const overlapping = upcomingEventsList.find(
      (existing) => startMs < new Date(existing.endAt).getTime() && endMs > new Date(existing.startAt).getTime(),
    );
    const isAmbiguous = Boolean(ev.ambiguousReason && ev.ambiguousReason.trim());
    const autoCreateEvent =
      (autonomyLevel === 'proactive' ||
        (autonomyLevel === 'balanced' && Boolean(preferences.autoCreateCalendarEvents))) &&
      !overlapping &&
      !isAmbiguous;

    if (autoCreateEvent) {
      const eventId = nextNumericId();
      writePromises.push(
        createSubdoc(uid, 'calendarEvents', String(eventId), {
          id: eventId,
          projectId,
          externalProvider: 'local',
          externalEventId: null,
          syncStatus: 'local_only',
          title: ev.title.slice(0, 180),
          description: ev.description ? ev.description.slice(0, 2000) : null,
          category: (ev.category || analysis.detectedCategory || 'Agenda').slice(0, 64),
          location: ev.location ? ev.location.slice(0, 240) : null,
          startAt: startIso,
          endAt: endIso,
          allDay: Boolean(ev.allDay),
          timezone: user.timezone || 'America/Montevideo',
          sourceMessageId: userMsgId,
          sourceFileId: uploadedFileIds[0] ?? null,
          linkedMemoryEventId: null,
          deletedAt: null,
        }),
      );

      const logId = nextNumericId();
      writePromises.push(
        createSubdoc(uid, 'actionsLog', String(logId), {
          id: logId,
          toolName: 'create_event',
          status: 'executed',
          inputPayload: ev as unknown as Record<string, unknown>,
          outputPayload: { eventId },
          errorMessage: null,
          requiresConfirmation: false,
          confirmedByUser: false,
        }),
      );

      executedOrPendingActions.push({
        actionLogId: logId,
        toolName: 'create_event',
        status: 'executed',
        summary: `Evento agendado: ${ev.title.slice(0, 180)}`,
        payload: { eventId, ...ev },
      });
    } else {
      const logId = nextNumericId();
      writePromises.push(
        createSubdoc(uid, 'actionsLog', String(logId), {
          id: logId,
          toolName: 'create_event',
          status: 'requested',
          inputPayload: {
            ...ev,
            startAtIso: startIso,
            endAtIso: endIso,
            conflictWith: overlapping ? overlapping.title : null,
            sourceMessageId: userMsgId,
            sourceFileId: uploadedFileIds[0] ?? null,
          },
          outputPayload: {},
          errorMessage: null,
          requiresConfirmation: true,
          confirmedByUser: false,
        }),
      );

      executedOrPendingActions.push({
        actionLogId: logId,
        toolName: 'create_event',
        status: 'requested',
        summary: overlapping
          ? `Conflicto con "${overlapping.title}" — confirmar: ${ev.title}`
          : isAmbiguous
          ? `Confirmar fecha/hora (${ev.ambiguousReason}): ${ev.title}`
          : `Agendar evento: ${ev.title}`,
        payload: {
          ...ev,
          startAtIso: startIso,
          endAtIso: endIso,
          conflictWith: overlapping ? overlapping.title : null,
        },
      });
    }
  }

  // Process Project Proposal
  if (analysis.proposedProject?.shouldCreate && analysis.proposedProject.name) {
    const proj = analysis.proposedProject;
    const alreadyExists = activeProjects.some((p) => p.name.toLowerCase() === proj.name.toLowerCase());
    if (!alreadyExists) {
      if (autonomyLevel === 'proactive') {
        const projId = nextNumericId();
        const objectives = (proj.objectives || []).slice(0, 50).map((t, idx) => ({
          id: `${projId}-${idx}`,
          title: String(t),
          done: false,
        }));
        writePromises.push(
          createSubdoc(uid, 'projects', String(projId), {
            id: projId,
            folderId: null,
            name: proj.name.slice(0, 120),
            description: proj.description ? proj.description.slice(0, 2000) : null,
            category: (proj.category || analysis.detectedCategory || 'General').slice(0, 64),
            objectives,
            status: 'active',
            progressPercent: 0,
            targetDate: proj.targetDate ? proj.targetDate.slice(0, 64) : null,
            isPriority: false,
            autoCreated: true,
            lastActivityAt: nowIso,
            deletedAt: null,
          }),
        );

        const logId = nextNumericId();
        writePromises.push(
          createSubdoc(uid, 'actionsLog', String(logId), {
            id: logId,
            toolName: 'create_project',
            status: 'executed',
            inputPayload: proj as unknown as Record<string, unknown>,
            outputPayload: { projectId: projId },
            errorMessage: null,
            requiresConfirmation: false,
            confirmedByUser: false,
          }),
        );

        executedOrPendingActions.push({
          actionLogId: logId,
          toolName: 'create_project',
          status: 'executed',
          summary: `Proyecto creado: ${proj.name.slice(0, 120)}`,
          payload: { projectId: projId, ...proj },
        });
      } else {
        const logId = nextNumericId();
        writePromises.push(
          createSubdoc(uid, 'actionsLog', String(logId), {
            id: logId,
            toolName: 'create_project',
            status: 'requested',
            inputPayload: proj as unknown as Record<string, unknown>,
            outputPayload: {},
            errorMessage: null,
            requiresConfirmation: true,
            confirmedByUser: false,
          }),
        );

        executedOrPendingActions.push({
          actionLogId: logId,
          toolName: 'create_project',
          status: 'requested',
          summary: `Crear proyecto: ${proj.name}`,
          payload: proj as unknown as Record<string, unknown>,
        });
      }
    }
  }

  const hasPending =
    executedOrPendingActions.some((a) => a.status === 'requested') || fileStatus === 'pending_confirmation';
  const finalMsgStatus = hasPending
    ? 'pending_confirmation'
    : uploadedFileIds.length > 0 && fileStatus === 'organized'
    ? 'organized'
    : 'analyzed';

  const assistantMsgId = nextNumericId();
  const assistantMetadata: MessageItem['metadata'] = {
    classifications: analysis.classifications,
    detectedCategory: analysis.detectedCategory,
    classificationConfidence: analysis.classificationConfidence,
    suggestedFolderName: analysis.suggestedFolderName,
    savedMemories,
    createdNotes,
    createdMemoryEvents,
    actions: executedOrPendingActions,
  };
  const replyContent = (analysis.reply || 'Procesado.').slice(0, 65000);

  writePromises.push(
    updateSubdoc(uid, 'messages', String(userMsgId), {
      processingStatus: finalMsgStatus,
      attachments: msgAttachments.slice(0, 20),
    }),
    createSubdoc(uid, 'messages', String(assistantMsgId), {
      id: assistantMsgId,
      conversationId: convId,
      role: 'assistant',
      content: replyContent,
      processingStatus: finalMsgStatus,
      errorMessage: null,
      editedAt: null,
      metadata: { ...assistantMetadata, uploadedFileIds },
      attachments: [],
      deletedAt: null,
    }),
    updateSubdoc(uid, 'conversations', String(convId), {
      lastMessageAt: new Date().toISOString(),
    }),
  );

  await Promise.all(writePromises);

  const assistantMsg: MessageItem = {
    id: assistantMsgId,
    conversationId: convId,
    role: 'assistant',
    content: replyContent,
    processingStatus: finalMsgStatus,
    errorMessage: null,
    editedAt: null,
    metadata: assistantMetadata,
    attachments: [],
    createdAt: new Date().toISOString(),
  };

  return {
    finalMsgStatus,
    assistantMsg,
    savedMemories,
    actions: executedOrPendingActions,
  };
}

function summaryCollectionName(kind: 'daily' | 'weekly' | 'monthly'): string {
  return kind === 'daily' ? 'dailySummaries' : kind === 'weekly' ? 'weeklySummaries' : 'monthlySummaries';
}

async function persistGeneratedSummary(params: {
  uid: string;
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
  generatedMode: 'auto' | 'manual';
  existingId?: number;
}): Promise<SummaryRecordItem> {
  const { uid, periodKind, periodKey, periodStart, periodEnd, title, narrative, sections, usedSources, generatedMode } = params;
  const col = summaryCollectionName(periodKind);
  const nowIso = new Date().toISOString();
  const sumId = params.existingId || nextNumericId();

  if (params.existingId) {
    await updateSubdoc(uid, col, String(sumId), {
      title: title.slice(0, 200),
      narrative: narrative.slice(0, 65000),
      sections,
      generatedMode,
      deletedAt: null,
    });
  } else {
    await createSubdoc(uid, col, String(sumId), {
      id: sumId,
      periodKind,
      periodKey,
      periodStart,
      periodEnd,
      title: title.slice(0, 200),
      narrative: narrative.slice(0, 65000),
      sections,
      generatedMode,
      savedNoteId: null,
      deletedAt: null,
    });
  }

  // Save traceable sources
  const srcWrites = usedSources.slice(0, 30).map((s) => {
    const srcId = nextNumericId();
    return createSubdoc(uid, 'summarySources', String(srcId), {
      id: srcId,
      summaryKind: periodKind,
      summaryId: sumId,
      sourceType: String(s.sourceType || 'memory').slice(0, 32),
      sourceId: Number(s.sourceId || 0),
      title: String(s.title || 'Fuente').slice(0, 200),
      excerpt: String(s.excerpt || s.title || 'Sin extracto').slice(0, 1000),
      sourceDate: s.sourceDate ? String(s.sourceDate).slice(0, 64) : null,
    });
  });
  await Promise.all(srcWrites);

  return {
    id: sumId,
    periodKind,
    periodKey,
    periodStart,
    periodEnd,
    title: title.slice(0, 200),
    narrative: narrative.slice(0, 65000),
    sections,
    generatedMode,
    savedNoteId: null,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

async function gatherSourcesForWindow(uid: string, startDay: string, endDay: string) {
  const [mems, notes, memEvents, files, msgs, tasks, events, projects] = await Promise.all([
    listSubcollection<StoredMemory>(uid, 'memories'),
    listSubcollection<StoredNote>(uid, 'notes'),
    listSubcollection<StoredMemoryEvent>(uid, 'memoryEvents'),
    listSubcollection<StoredFile>(uid, 'files'),
    listSubcollection<StoredMessage>(uid, 'messages'),
    listSubcollection<StoredTask>(uid, 'tasks'),
    listSubcollection<StoredEvent>(uid, 'calendarEvents'),
    listSubcollection<StoredProject>(uid, 'projects'),
  ]);

  const inRange = (iso: string | null | undefined) => {
    if (!iso) return false;
    const d = iso.slice(0, 10);
    return d >= startDay && d <= endDay;
  };

  const sources: Array<{ sourceType: string; sourceId: number; title: string; date: string; content: string }> = [];

  for (const me of memEvents.filter((x) => !x.deletedAt && (inRange(x.eventDate) || inRange(x.createdAt)))) {
    sources.push({
      sourceType: 'memory_event',
      sourceId: me.id,
      title: `Agenda Memoria: ${me.title}`,
      date: me.eventDate || me.createdAt,
      content: `${me.category} · Personas: ${(me.people || []).join(', ') || 'ninguna'} · ${me.description}`,
    });
  }
  for (const n of notes.filter((x) => !x.deletedAt && !x.isArchived && (inRange(x.updatedAt) || inRange(x.createdAt)))) {
    sources.push({
      sourceType: 'note',
      sourceId: n.id,
      title: `Nota: ${n.title}`,
      date: n.updatedAt || n.createdAt,
      content: n.content.slice(0, 1200),
    });
  }
  for (const m of mems.filter((x) => !x.deletedAt && x.isActive && inRange(x.createdAt))) {
    sources.push({
      sourceType: 'memory',
      sourceId: m.id,
      title: m.title || `${m.memoryLayer} (${m.category})`,
      date: m.createdAt,
      content: m.content,
    });
  }
  for (const f of files.filter((x) => !x.deletedAt && inRange(x.createdAt))) {
    sources.push({
      sourceType: 'file',
      sourceId: f.id,
      title: `Archivo: ${f.displayName}`,
      date: f.createdAt,
      content: f.aiSummary || f.extractedText?.slice(0, 800) || f.mimeType,
    });
  }
  for (const t of tasks.filter((x) => !x.deletedAt && (inRange(x.createdAt) || inRange(x.dueAt) || inRange(x.completedAt)))) {
    sources.push({
      sourceType: 'task',
      sourceId: t.id,
      title: `Tarea (${t.status}): ${t.title}`,
      date: t.completedAt || t.dueAt || t.createdAt,
      content: t.description || t.title,
    });
  }
  for (const ev of events.filter((x) => !x.deletedAt && inRange(x.startAt))) {
    sources.push({
      sourceType: 'calendar_event',
      sourceId: ev.id,
      title: `Agenda Real: ${ev.title}`,
      date: ev.startAt,
      content: `${ev.startAt} · ${ev.location || ''} · ${ev.description || ''}`.trim(),
    });
  }
  for (const p of projects.filter((x) => !x.deletedAt && inRange(x.lastActivityAt))) {
    sources.push({
      sourceType: 'project',
      sourceId: p.id,
      title: `Proyecto: ${p.name} (${p.progressPercent}%)`,
      date: p.lastActivityAt,
      content: p.description || p.objectives.map((o) => o.title).join('; ') || p.status,
    });
  }
  for (const msg of msgs
    .filter((x) => !x.deletedAt && x.role === 'user' && inRange(x.createdAt))
    .slice(0, 35)) {
    sources.push({
      sourceType: 'message',
      sourceId: msg.id,
      title: `Conversación #${msg.conversationId}`,
      date: msg.createdAt,
      content: msg.content.slice(0, 800),
    });
  }

  return sources;
}

export async function dispatchSilvvRequest<T>(rawPath: string, options: RequestInit = {}): Promise<T> {
  const uid = await ensureBootstrapped();
  const method = (options.method || 'GET').toUpperCase();
  const url = new URL(rawPath, 'https://silvv.local');
  const pathname = url.pathname;
  const body: Record<string, unknown> = options.body ? JSON.parse(String(options.body)) : {};

  // ---- ME & EXPORT ----
  if (pathname === '/api/me') {
    if (method === 'GET') return (await getMe(uid)) as T;
    if (method === 'PATCH') return (await patchMe(uid, body)) as T;
  }

  if (pathname === '/api/export' && method === 'GET') {
    const [me, flds, projs, convs, fls, mems, tsks, evts, agts, nfs, nts, mevs, ppl, dSum, wSum, mSum] =
      await Promise.all([
        getMe(uid),
        listSubcollection<StoredFolder>(uid, 'folders'),
        listSubcollection<StoredProject>(uid, 'projects'),
        listSubcollection<StoredConversation>(uid, 'conversations'),
        listSubcollection<StoredFile>(uid, 'files'),
        listSubcollection<StoredMemory>(uid, 'memories'),
        listSubcollection<StoredTask>(uid, 'tasks'),
        listSubcollection<StoredEvent>(uid, 'calendarEvents'),
        listSubcollection<StoredAgent>(uid, 'agents'),
        listSubcollection<StoredNoteFolder>(uid, 'noteFolders'),
        listSubcollection<StoredNote>(uid, 'notes'),
        listSubcollection<StoredMemoryEvent>(uid, 'memoryEvents'),
        listSubcollection<PersonEntityItem>(uid, 'peopleEntities'),
        listSubcollection<StoredSummaryRecord>(uid, 'dailySummaries'),
        listSubcollection<StoredSummaryRecord>(uid, 'weeklySummaries'),
        listSubcollection<StoredSummaryRecord>(uid, 'monthlySummaries'),
      ]);
    return {
      app: 'SILVV MEMORY',
      exportedAt: new Date().toISOString(),
      user: me.user,
      preferences: me.preferences,
      folders: flds.filter((x) => !x.deletedAt),
      projects: projs.filter((x) => !x.deletedAt),
      conversations: convs.filter((x) => !x.deletedAt),
      files: fls.filter((x) => !x.deletedAt).map(({ embedding: _e, ...rest }) => rest),
      memories: mems.filter((x) => !x.deletedAt).map(({ embedding: _e, ...rest }) => rest),
      tasks: tsks.filter((x) => !x.deletedAt),
      calendarEvents: evts.filter((x) => !x.deletedAt),
      noteFolders: nfs.filter((x) => !x.deletedAt),
      notes: nts.filter((x) => !x.deletedAt).map(({ embedding: _e, ...rest }) => rest),
      memoryEvents: mevs.filter((x) => !x.deletedAt).map(({ embedding: _e, ...rest }) => rest),
      peopleEntities: ppl,
      dailySummaries: dSum.filter((x) => !x.deletedAt),
      weeklySummaries: wSum.filter((x) => !x.deletedAt),
      monthlySummaries: mSum.filter((x) => !x.deletedAt),
      agents: agts.filter((x) => !x.deletedAt),
    } as T;
  }

  // ---- DASHBOARD & BRIEFING ----
  if (pathname === '/api/dashboard' && method === 'GET') {
    return (await getDashboard(uid)) as T;
  }

  if (pathname === '/api/ai/note-organization' && method === 'POST') {
    return (await callServerEndpoint('/api/ai/note-organization', 'POST', body)) as T;
  }

  if (pathname === '/api/dashboard/briefing' && method === 'POST') {
    const [{ user }, dash] = await Promise.all([getMe(uid), getDashboard(uid)]);
    if (
      dash.upcomingEvents.length === 0 &&
      dash.pendingTasks.length === 0 &&
      dash.activeProjects.length === 0 &&
      dash.recentMemories.length === 0 &&
      dash.recentNotes.length === 0 &&
      dash.recentMemoryEvents.length === 0
    ) {
      return {
        headline: 'Tu espacio en SILVV MEMORY está listo',
        summary:
          'Todavía no registraste eventos, tareas, notas, vivencias ni recuerdos. Todo lo que ves aquí es real y se actualiza con tu actividad.',
        nextFocus: 'Abrí el Chat general o creá una nota rápida para empezar.',
      } as T;
    }
    return await callServerEndpoint<T>('/api/ai/briefing', 'POST', {
      userName: user.fullName || 'Usuario',
      timezone: user.timezone || 'America/Montevideo',
      nowIso: new Date().toISOString(),
      upcomingEvents: dash.upcomingEvents.slice(0, 6).map((e) => ({ title: e.title, startAt: e.startAt })),
      pendingTasks: dash.pendingTasks.slice(0, 8).map((t) => ({
        title: t.title,
        priority: t.priority,
        dueAt: t.dueAt,
      })),
      activeProjects: dash.activeProjects.slice(0, 6).map((p) => ({
        name: p.name,
        progressPercent: p.progressPercent,
        status: p.status,
      })),
      recentMemories: dash.recentMemories.slice(0, 6).map((m) => ({
        content: m.content,
        category: m.category,
      })),
    });
  }

  // ---- SEARCH (HYBRID SEMANTIC + KEYWORD ACROSS ALL ENTITIES INCLUDING NOTES & MEMORY EVENTS) ----
  if (pathname === '/api/search' && method === 'GET') {
    const q = (url.searchParams.get('q') || '').trim();
    const layerFilter = url.searchParams.get('layer') || 'all';
    const [mems, fls, projs, tsks, evts, msgs, notes, memEvts] = await Promise.all([
      listSubcollection<StoredMemory>(uid, 'memories'),
      listSubcollection<StoredFile>(uid, 'files'),
      listSubcollection<StoredProject>(uid, 'projects'),
      listSubcollection<StoredTask>(uid, 'tasks'),
      listSubcollection<StoredEvent>(uid, 'calendarEvents'),
      listSubcollection<StoredMessage>(uid, 'messages'),
      listSubcollection<StoredNote>(uid, 'notes'),
      listSubcollection<StoredMemoryEvent>(uid, 'memoryEvents'),
    ]);

    const queryLower = q.toLowerCase();
    let queryEmbedding: number[] | null = null;
    if (q.length >= 3) {
      const embRes = await callServerEndpoint<{ embedding: number[] | null }>('/api/ai/embed', 'POST', {
        text: q,
      }).catch(() => ({ embedding: null }));
      queryEmbedding = embRes.embedding;
    }

    const memoryHits: SearchHit[] = mems
      .filter((m) => !m.deletedAt && (layerFilter === 'all' || m.memoryLayer === layerFilter))
      .map((m) => {
        const textMatch =
          !q ||
          m.content.toLowerCase().includes(queryLower) ||
          (m.title || '').toLowerCase().includes(queryLower) ||
          m.category.toLowerCase().includes(queryLower) ||
          (m.tags || []).some((t) => t.toLowerCase().includes(queryLower));
        const sim = queryEmbedding ? cosineSimilarity(queryEmbedding, m.embedding) : 0;
        const score = (textMatch ? 1 : 0) + sim * 1.8;
        return {
          type: 'memory' as const,
          id: m.id,
          title: m.title || m.category,
          subtitle: `${m.memoryLayer} · ${m.originKind} · ${m.category}`,
          snippet: m.content,
          score,
          createdAt: m.createdAt,
        };
      })
      .filter((r) => (q ? r.score > 0.45 : true));

    const noteHits: SearchHit[] = notes
      .filter((n) => !n.deletedAt)
      .map((n) => {
        const textMatch =
          !q ||
          n.title.toLowerCase().includes(queryLower) ||
          n.content.toLowerCase().includes(queryLower) ||
          (n.tags || []).some((t) => t.toLowerCase().includes(queryLower));
        const sim = queryEmbedding ? cosineSimilarity(queryEmbedding, n.embedding) : 0;
        const score = (textMatch ? 1.15 : 0) + sim * 1.85;
        return {
          type: 'note' as const,
          id: n.id,
          title: n.title,
          subtitle: `Nota${n.isArchived ? ' archivada' : ''}${n.tags?.length ? ` · ${n.tags.join(', ')}` : ''}`,
          snippet: n.content.slice(0, 220),
          score,
          createdAt: n.updatedAt || n.createdAt,
        };
      })
      .filter((r) => (q ? r.score > 0.45 : true));

    const memEventHits: SearchHit[] = memEvts
      .filter((me) => !me.deletedAt)
      .map((me) => {
        const textMatch =
          !q ||
          me.title.toLowerCase().includes(queryLower) ||
          me.description.toLowerCase().includes(queryLower) ||
          me.category.toLowerCase().includes(queryLower) ||
          me.people.some((p) => p.toLowerCase().includes(queryLower));
        const sim = queryEmbedding ? cosineSimilarity(queryEmbedding, me.embedding) : 0;
        const score = (textMatch ? 1.15 : 0) + sim * 1.8;
        return {
          type: 'memory_event' as const,
          id: me.id,
          title: me.title,
          subtitle: `Agenda Memoria · ${me.category}${me.dateLabel ? ` · ${me.dateLabel}` : ''}`,
          snippet: me.description,
          score,
          createdAt: me.eventDate || me.createdAt,
        };
      })
      .filter((r) => (q ? r.score > 0.45 : true));

    const fileHits: SearchHit[] = fls
      .filter((f) => !f.deletedAt)
      .map((f) => {
        const textMatch =
          !q ||
          f.displayName.toLowerCase().includes(queryLower) ||
          (f.aiSummary || '').toLowerCase().includes(queryLower) ||
          (f.extractedText || '').toLowerCase().includes(queryLower);
        const sim = queryEmbedding ? cosineSimilarity(queryEmbedding, f.embedding) : 0;
        const score = (textMatch ? 1 : 0) + sim * 1.8;
        return {
          type: 'file' as const,
          id: f.id,
          title: f.displayName,
          subtitle: `${f.fileKind} · ${f.detectedCategory || 'Sin categoría'}`,
          snippet: f.aiSummary || f.extractedText || f.mimeType,
          score,
          createdAt: f.createdAt,
        };
      })
      .filter((r) => (q ? r.score > 0.45 : true));

    const messageHits: SearchHit[] = q
      ? msgs
          .filter((m) => !m.deletedAt && m.content.toLowerCase().includes(queryLower))
          .slice(0, 40)
          .map((m) => ({
            type: 'message' as const,
            id: m.id,
            title: `Conversación #${m.conversationId}`,
            subtitle: `Mensaje (${m.role === 'user' ? 'Vos' : 'SILVV MEMORY'})`,
            snippet: m.content,
            score: 0.95,
            createdAt: m.createdAt,
          }))
      : [];

    const projectHits: SearchHit[] = projs
      .filter(
        (p) =>
          !p.deletedAt &&
          (!q ||
            p.name.toLowerCase().includes(queryLower) ||
            (p.description || '').toLowerCase().includes(queryLower)),
      )
      .map((p) => ({
        type: 'project' as const,
        id: p.id,
        title: p.name,
        subtitle: `Proyecto · ${p.status} · ${p.progressPercent}%`,
        snippet: p.description || 'Sin descripción',
        score: 1.2,
        createdAt: p.createdAt,
      }));

    const taskHits: SearchHit[] = tsks
      .filter((t) => !t.deletedAt && (!q || t.title.toLowerCase().includes(queryLower)))
      .map((t) => ({
        type: 'task' as const,
        id: t.id,
        title: t.title,
        subtitle: `Tarea · ${t.status} · ${t.priority}`,
        snippet: t.description || '',
        score: 1.1,
        createdAt: t.createdAt,
      }));

    const eventHits: SearchHit[] = evts
      .filter((e) => !e.deletedAt && (!q || e.title.toLowerCase().includes(queryLower)))
      .map((e) => ({
        type: 'event' as const,
        id: e.id,
        title: e.title,
        subtitle: `Agenda Real · ${e.startAt}`,
        snippet: e.location || e.description || '',
        score: 1.1,
        createdAt: e.createdAt || e.startAt,
      }));

    const results = [
      ...noteHits,
      ...memEventHits,
      ...memoryHits,
      ...fileHits,
      ...projectHits,
      ...taskHits,
      ...eventHits,
      ...messageHits,
    ]
      .sort((a, b) => b.score - a.score)
      .slice(0, 50);

    return { query: q, results } as T;
  }

  // ---- NOTE FOLDERS & NOTES ----
  if (pathname === '/api/note-folders') {
    if (method === 'GET') {
      const rows = (await listSubcollection<StoredNoteFolder>(uid, 'noteFolders'))
        .filter((f) => !f.deletedAt)
        .sort((a, b) => a.name.localeCompare(b.name));
      return rows as T;
    }
    if (method === 'POST') {
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!name) throw new Error('El nombre de la carpeta es obligatorio.');
      const id = nextNumericId();
      const item: StoredNoteFolder = {
        id,
        parentId: typeof body.parentId === 'number' ? body.parentId : null,
        name: name.slice(0, 80),
        color: typeof body.color === 'string' ? body.color.slice(0, 24) : '#7C3AED',
        deletedAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await createSubdoc(uid, 'noteFolders', String(id), { ...item });
      return item as T;
    }
  }

  const noteFolderMatch = pathname.match(/^\/api\/note-folders\/(\d+)$/);
  if (noteFolderMatch) {
    const id = Number(noteFolderMatch[1]);
    if (method === 'PATCH') {
      const patch: Record<string, unknown> = {};
      if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim().slice(0, 80);
      if (typeof body.color === 'string') patch.color = body.color.slice(0, 24);
      if (body.parentId !== undefined) patch.parentId = typeof body.parentId === 'number' ? body.parentId : null;
      await updateSubdoc(uid, 'noteFolders', String(id), patch);
      const updated = await getSubdoc<StoredNoteFolder>(uid, 'noteFolders', String(id));
      if (!updated) throw new Error('Carpeta de notas no encontrada.');
      return updated as T;
    }
    if (method === 'DELETE') {
      await updateSubdoc(uid, 'noteFolders', String(id), { deletedAt: new Date().toISOString() });
      return { ok: true, id } as T;
    }
  }

  if (pathname === '/api/notes') {
    if (method === 'GET') {
      const q = (url.searchParams.get('q') || '').trim();
      const all = (await listSubcollection<StoredNote>(uid, 'notes')).filter((n) => !n.deletedAt);

      if (q.length >= 2) {
        const lower = q.toLowerCase();
        let qEmb: number[] | null = null;
        if (all.some((n) => Array.isArray(n.embedding) && n.embedding.length > 0)) {
          const embRes = await withRaceTimeout(
            callServerEndpoint<{ embedding: number[] | null }>('/api/ai/embed', 'POST', { text: q }).catch(() => ({
              embedding: null,
            })),
            2000,
            { embedding: null },
          );
          qEmb = embRes.embedding;
        }
        const scored = all
          .map((n) => {
            const hay = `${n.title} ${n.content} ${(n.tags || []).join(' ')}`.toLowerCase();
            const kw = hay.includes(lower) ? 1.5 : 0;
            const sim = qEmb ? cosineSimilarity(qEmb, n.embedding) : 0;
            return { note: n, score: kw + sim * 1.8 };
          })
          .filter((x) => x.score > 0.42)
          .sort((a, b) => b.score - a.score)
          .map(({ note: { embedding: _e, ...rest } }) => rest);
        return scored as T;
      }

      const sorted = all
        .sort((a, b) => {
          if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
          return (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt);
        })
        .map(({ embedding: _e, ...rest }) => rest);
      return sorted as T;
    }

    if (method === 'POST') {
      const rawTitle = typeof body.title === 'string' ? body.title.trim() : '';
      const rawContent = typeof body.content === 'string' ? body.content : '';
      const isQuick = Boolean(body.isQuick);
      const title = (rawTitle || (rawContent.trim().split('\n')[0] || 'Nota rápida')).slice(0, 200);
      const content = rawContent.slice(0, 65000);

      const embRes = content.trim()
        ? await withRaceTimeout(
            callServerEndpoint<{ embedding: number[] | null }>('/api/ai/embed', 'POST', {
              text: `${title}\n${content}`,
            }).catch(() => ({ embedding: null })),
            1800,
            { embedding: null },
          )
        : { embedding: null };

      const id = nextNumericId();
      const nowIso = new Date().toISOString();
      const item: StoredNote = {
        id,
        folderId: typeof body.folderId === 'number' ? body.folderId : null,
        projectId: typeof body.projectId === 'number' ? body.projectId : null,
        title,
        content,
        tags: Array.isArray(body.tags) ? body.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 20) : [],
        isQuick,
        isPinned: Boolean(body.isPinned),
        isArchived: false,
        attachments: Array.isArray(body.attachments) ? (body.attachments as NoteAttachment[]).slice(0, 20) : [],
        sourceConversationId: typeof body.sourceConversationId === 'number' ? body.sourceConversationId : null,
        sourceMessageId: typeof body.sourceMessageId === 'number' ? body.sourceMessageId : null,
        embedding: embRes.embedding ? embRes.embedding.slice(0, 4096) : null,
        deletedAt: null,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      await createSubdoc(uid, 'notes', String(id), { ...item });
      const { embedding: _e, ...clean } = item;
      return clean as T;
    }
  }

  const noteUploadMatch = pathname.match(/^\/api\/notes\/(\d+)\/attachments$/);
  if (noteUploadMatch && method === 'POST') {
    const id = Number(noteUploadMatch[1]);
    const existing = await getSubdoc<StoredNote>(uid, 'notes', String(id));
    if (!existing || existing.deletedAt) throw new Error('Nota no encontrada.');
    const name = String(body.name || 'adjunto');
    const mimeType = String(body.mimeType || 'application/octet-stream');
    const base64Data = String(body.base64Data || '');
    if (!base64Data) throw new Error('Archivo vacío.');

    const saved = await callServerEndpoint<{
      storagePath: string;
      sizeBytes: number;
      extractedText: string;
      aiSummary: string;
    }>('/api/ai/agent-doc', 'POST', { name, mimeType, base64Data });

    const kind: NoteAttachment['fileKind'] = mimeType.startsWith('image/')
      ? 'image'
      : mimeType === 'application/pdf'
      ? 'pdf'
      : mimeType.startsWith('audio/')
      ? 'audio'
      : mimeType.startsWith('text/') || mimeType.includes('document')
      ? 'document'
      : 'other';

    const newAtt: NoteAttachment = {
      id: nextNumericId(),
      fileId: null,
      fileName: name.slice(0, 200),
      mimeType: mimeType.slice(0, 120),
      fileKind: kind,
      sizeBytes: saved.sizeBytes,
      storagePath: saved.storagePath,
    };
    const nextAttachments = [...(existing.attachments || []), newAtt].slice(0, 20);
    await updateSubdoc(uid, 'notes', String(id), { attachments: nextAttachments });
    return { attachment: newAtt, attachments: nextAttachments } as T;
  }

  const noteIdMatch = pathname.match(/^\/api\/notes\/(\d+)$/);
  if (noteIdMatch) {
    const id = Number(noteIdMatch[1]);
    if (method === 'PATCH') {
      const existing = await getSubdoc<StoredNote>(uid, 'notes', String(id));
      if (!existing || existing.deletedAt) throw new Error('Nota no encontrada.');
      const patch: Record<string, unknown> = {};
      if (typeof body.title === 'string' && body.title.trim()) patch.title = body.title.trim().slice(0, 200);
      if (typeof body.content === 'string') patch.content = body.content.slice(0, 65000);
      if (body.folderId !== undefined) patch.folderId = typeof body.folderId === 'number' ? body.folderId : null;
      if (body.projectId !== undefined) patch.projectId = typeof body.projectId === 'number' ? body.projectId : null;
      if (Array.isArray(body.tags)) {
        patch.tags = body.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 20);
      }
      if (typeof body.isPinned === 'boolean') patch.isPinned = body.isPinned;
      if (typeof body.isArchived === 'boolean') patch.isArchived = body.isArchived;
      if (typeof body.isQuick === 'boolean') patch.isQuick = body.isQuick;
      if (Array.isArray(body.attachments)) patch.attachments = body.attachments.slice(0, 20);

      if (body.recomputeEmbedding && (patch.title || patch.content !== undefined)) {
        const embRes = await withRaceTimeout(
          callServerEndpoint<{ embedding: number[] | null }>('/api/ai/embed', 'POST', {
            text: `${(patch.title as string) || existing.title}\n${(patch.content as string) ?? existing.content}`,
          }).catch(() => ({ embedding: null })),
          1800,
          { embedding: null },
        );
        if (embRes.embedding) patch.embedding = embRes.embedding.slice(0, 4096);
      }

      await updateSubdoc(uid, 'notes', String(id), patch);
      const updated = await getSubdoc<StoredNote>(uid, 'notes', String(id));
      if (!updated) throw new Error('Nota no encontrada.');
      const { embedding: _e, ...clean } = updated;
      return clean as T;
    }
    if (method === 'DELETE') {
      await updateSubdoc(uid, 'notes', String(id), { deletedAt: new Date().toISOString() });
      return { ok: true, id } as T;
    }
  }

  // ---- AGENDA MEMORIA (MEMORY EVENTS, PEOPLE, RELATIONS) ----
  if (pathname === '/api/memory-events') {
    if (method === 'GET') {
      const q = (url.searchParams.get('q') || '').trim().toLowerCase();
      const rows = (await listSubcollection<StoredMemoryEvent>(uid, 'memoryEvents'))
        .filter((e) => !e.deletedAt)
        .filter(
          (e) =>
            !q ||
            e.title.toLowerCase().includes(q) ||
            e.description.toLowerCase().includes(q) ||
            e.category.toLowerCase().includes(q) ||
            e.people.some((p) => p.toLowerCase().includes(q)),
        )
        .sort((a, b) => (b.eventDate || b.createdAt).localeCompare(a.eventDate || a.createdAt))
        .map(({ embedding: _e, ...rest }) => rest);
      return rows as T;
    }

    if (method === 'POST') {
      const title = typeof body.title === 'string' ? body.title.trim() : '';
      const description = typeof body.description === 'string' ? body.description.trim() : '';
      if (!title || !description) throw new Error('Título y descripción son obligatorios.');
      const eventDate = parseDateSafe(typeof body.eventDate === 'string' ? body.eventDate : null);
      const datePrecision = ['exact', 'day', 'approximate', 'unknown'].includes(String(body.datePrecision))
        ? (body.datePrecision as MemoryEventItem['datePrecision'])
        : eventDate
        ? 'day'
        : 'unknown';
      const people = Array.isArray(body.people)
        ? Array.from(new Set(body.people.map((x) => String(x).trim()).filter(Boolean))).slice(0, 30)
        : [];

      const embRes = await withRaceTimeout(
        callServerEndpoint<{ embedding: number[] | null }>('/api/ai/embed', 'POST', {
          text: `${title}\n${description}\n${people.join(' ')}`,
        }).catch(() => ({ embedding: null })),
        1800,
        { embedding: null },
      );

      const id = nextNumericId();
      const nowIso = new Date().toISOString();
      const item: StoredMemoryEvent = {
        id,
        title: title.slice(0, 200),
        description: description.slice(0, 16000),
        eventDate,
        datePrecision,
        dateLabel:
          typeof body.dateLabel === 'string' && body.dateLabel.trim()
            ? body.dateLabel.trim().slice(0, 120)
            : eventDate
            ? eventDate.slice(0, 10)
            : 'Sin fecha precisa',
        category:
          typeof body.category === 'string' && body.category.trim()
            ? body.category.trim().slice(0, 64)
            : 'Vida personal',
        people,
        projectId: typeof body.projectId === 'number' ? body.projectId : null,
        sourceConversationId: null,
        sourceMessageId: null,
        sourceMessageText:
          typeof body.sourceMessageText === 'string' ? body.sourceMessageText.slice(0, 4000) : null,
        relatedFileIds: Array.isArray(body.relatedFileIds) ? body.relatedFileIds.map(Number).slice(0, 30) : [],
        relatedNoteIds: Array.isArray(body.relatedNoteIds) ? body.relatedNoteIds.map(Number).slice(0, 30) : [],
        tags: Array.isArray(body.tags) ? body.tags.map(String).slice(0, 20) : [],
        importance: typeof body.importance === 'number' ? Math.min(5, Math.max(1, body.importance)) : 3,
        embedding: embRes.embedding ? embRes.embedding.slice(0, 4096) : null,
        deletedAt: null,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      await createSubdoc(uid, 'memoryEvents', String(id), { ...item });

      // If created from a finished Real Agenda calendarEvent, link them
      if (typeof body.linkedCalendarEventId === 'number') {
        await updateSubdoc(uid, 'calendarEvents', String(body.linkedCalendarEventId), {
          linkedMemoryEventId: id,
        }).catch(() => {});
      }

      // Sync people entities
      const allPeople = await listSubcollection<PersonEntityItem>(uid, 'peopleEntities');
      for (const pName of people) {
        const norm = normalizeName(pName);
        if (!norm) continue;
        const found = allPeople.find((p) => p.normalizedName === norm);
        let personId: number;
        if (found) {
          personId = found.id;
          await updateSubdoc(uid, 'peopleEntities', String(found.id), {
            mentionCount: found.mentionCount + 1,
            lastMentionedAt: eventDate || nowIso,
          });
        } else {
          personId = nextNumericId();
          await createSubdoc(uid, 'peopleEntities', String(personId), {
            id: personId,
            name: pName.slice(0, 120),
            normalizedName: norm.slice(0, 120),
            relationship: null,
            notes: null,
            mentionCount: 1,
            lastMentionedAt: eventDate || nowIso,
          });
        }
        const relId = nextNumericId();
        await createSubdoc(uid, 'eventRelations', String(relId), {
          id: relId,
          sourceEventId: id,
          targetType: 'person',
          targetId: personId,
          targetLabel: pName.slice(0, 200),
          relationKind: 'involves_person',
        });
      }

      const { embedding: _e, ...clean } = item;
      return clean as T;
    }
  }

  const memEvMatch = pathname.match(/^\/api\/memory-events\/(\d+)$/);
  if (memEvMatch) {
    const id = Number(memEvMatch[1]);
    if (method === 'PATCH') {
      const patch: Record<string, unknown> = {};
      if (typeof body.title === 'string' && body.title.trim()) patch.title = body.title.trim().slice(0, 200);
      if (typeof body.description === 'string' && body.description.trim()) {
        patch.description = body.description.trim().slice(0, 16000);
      }
      if (body.eventDate !== undefined) {
        patch.eventDate = parseDateSafe(typeof body.eventDate === 'string' ? body.eventDate : null);
      }
      if (['exact', 'day', 'approximate', 'unknown'].includes(String(body.datePrecision))) {
        patch.datePrecision = body.datePrecision;
      }
      if (typeof body.dateLabel === 'string') patch.dateLabel = body.dateLabel.slice(0, 120) || null;
      if (typeof body.category === 'string' && body.category.trim()) patch.category = body.category.trim().slice(0, 64);
      if (Array.isArray(body.people)) {
        patch.people = body.people.map((x) => String(x).trim()).filter(Boolean).slice(0, 30);
      }
      if (Array.isArray(body.tags)) patch.tags = body.tags.map(String).slice(0, 20);
      if (typeof body.importance === 'number') patch.importance = Math.min(5, Math.max(1, body.importance));
      if (body.projectId !== undefined) patch.projectId = typeof body.projectId === 'number' ? body.projectId : null;

      await updateSubdoc(uid, 'memoryEvents', String(id), patch);
      const updated = await getSubdoc<StoredMemoryEvent>(uid, 'memoryEvents', String(id));
      if (!updated) throw new Error('Evento de memoria no encontrado.');
      const { embedding: _e, ...clean } = updated;
      return clean as T;
    }
    if (method === 'DELETE') {
      await updateSubdoc(uid, 'memoryEvents', String(id), { deletedAt: new Date().toISOString() });
      return { ok: true, id } as T;
    }
  }

  if (pathname === '/api/people' && method === 'GET') {
    const rows = (await listSubcollection<PersonEntityItem>(uid, 'peopleEntities')).sort(
      (a, b) => b.mentionCount - a.mentionCount,
    );
    return rows as T;
  }

  if (pathname === '/api/event-relations' && method === 'GET') {
    const eventIdParam = url.searchParams.get('eventId');
    const rows = await listSubcollection<EventRelationItem>(uid, 'eventRelations');
    return (eventIdParam ? rows.filter((r) => r.sourceEventId === Number(eventIdParam)) : rows) as T;
  }

  // ---- SUMMARIES (DAILY / WEEKLY / MONTHLY + AUTO CATCH-UP & SERVER SCHEDULER SYNC) ----
  if (pathname === '/api/summaries' && method === 'GET') {
    const [daily, weekly, monthly] = await Promise.all([
      listSubcollection<StoredSummaryRecord>(uid, 'dailySummaries'),
      listSubcollection<StoredSummaryRecord>(uid, 'weeklySummaries'),
      listSubcollection<StoredSummaryRecord>(uid, 'monthlySummaries'),
    ]);
    return {
      daily: daily.filter((s) => !s.deletedAt).sort((a, b) => b.periodKey.localeCompare(a.periodKey)),
      weekly: weekly.filter((s) => !s.deletedAt).sort((a, b) => b.periodKey.localeCompare(a.periodKey)),
      monthly: monthly.filter((s) => !s.deletedAt).sort((a, b) => b.periodKey.localeCompare(a.periodKey)),
    } as T;
  }

  if (pathname === '/api/summaries/sync-auto' && method === 'POST') {
    const [{ user }, daily, weekly, monthly] = await Promise.all([
      getMe(uid),
      listSubcollection<StoredSummaryRecord>(uid, 'dailySummaries'),
      listSubcollection<StoredSummaryRecord>(uid, 'weeklySummaries'),
      listSubcollection<StoredSummaryRecord>(uid, 'monthlySummaries'),
    ]);
    const tz = user.timezone || 'America/Montevideo';

    // 1. Collect any summaries already generated by the server-side cron scheduler while app was closed
    const pendingRes = await callServerEndpoint<{
      pending: Array<{
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
      }>;
    }>('/api/summaries/pending-scheduled', 'GET').catch(() => ({ pending: [] }));

    const importedKeys: string[] = [];
    for (const p of pendingRes.pending || []) {
      const existingList = p.periodKind === 'daily' ? daily : p.periodKind === 'weekly' ? weekly : monthly;
      const already = existingList.find((x) => !x.deletedAt && x.periodKey === p.periodKey);
      if (!already) {
        await persistGeneratedSummary({
          uid,
          periodKind: p.periodKind,
          periodKey: p.periodKey,
          periodStart: p.periodStart,
          periodEnd: p.periodEnd,
          title: p.title,
          narrative: p.narrative,
          sections: p.sections,
          usedSources: p.usedSources,
          generatedMode: 'auto',
        });
      }
      importedKeys.push(`${p.periodKind}:${p.periodKey}`);
    }

    if (importedKeys.length > 0) {
      await callServerEndpoint('/api/summaries/ack-scheduled', 'POST', { keys: importedKeys }).catch(() => {});
    }

    // 2. Sync compact recent window snapshot to server scheduler so server continues generating even when browser is closed
    const zp = getZonedDateParts(new Date(), tz);
    const lookbackStart = new Date(Date.UTC(zp.year, zp.month - 1, zp.day - 32)).toISOString().slice(0, 10);
    const todayEnd = `${zp.year}-${pad2(zp.month)}-${pad2(zp.day)}`;
    const snapshotSources = await gatherSourcesForWindow(uid, lookbackStart, todayEnd);
    const existingKeys = [
      ...daily.filter((s) => !s.deletedAt).map((s) => `daily:${s.periodKey}`),
      ...weekly.filter((s) => !s.deletedAt).map((s) => `weekly:${s.periodKey}`),
      ...monthly.filter((s) => !s.deletedAt).map((s) => `monthly:${s.periodKey}`),
      ...importedKeys,
    ];

    await callServerEndpoint('/api/summaries/scheduler-sync', 'POST', {
      userName: user.fullName || 'Usuario',
      timezone: tz,
      sources: snapshotSources,
      existingSummaryKeys: existingKeys,
    }).catch(() => {});

    return { ok: true, importedCount: importedKeys.length } as T;
  }

  if (pathname === '/api/summaries/generate' && method === 'POST') {
    const periodKind =
      body.periodKind === 'weekly' || body.periodKind === 'monthly' ? body.periodKind : 'daily';
    const forceRegenerate = Boolean(body.forceRegenerate);
    const requestedKey = typeof body.periodKey === 'string' ? body.periodKey.trim() : undefined;

    const { user } = await getMe(uid);
    const tz = user.timezone || 'America/Montevideo';
    const { periodKey, startDay, endDay } = getPeriodBounds(periodKind, tz, requestedKey);
    const col = summaryCollectionName(periodKind);

    const existingList = (await listSubcollection<StoredSummaryRecord>(uid, col)).filter((s) => !s.deletedAt);
    const existing = existingList.find((s) => s.periodKey === periodKey);
    if (existing && !forceRegenerate) {
      return existing as T;
    }

    const sources = await gatherSourcesForWindow(uid, startDay, endDay);
    const aiSummary = await callServerEndpoint<{
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
    }>('/api/ai/summary', 'POST', {
      periodKind,
      periodKey,
      periodStart: `${startDay}T00:00:00`,
      periodEnd: `${endDay}T23:59:59`,
      timezone: tz,
      userName: user.fullName || 'Usuario',
      sources,
    });

    const saved = await persistGeneratedSummary({
      uid,
      periodKind,
      periodKey,
      periodStart: `${startDay}T00:00:00`,
      periodEnd: `${endDay}T23:59:59`,
      title: aiSummary.title,
      narrative: aiSummary.narrative,
      sections: aiSummary.sections,
      usedSources: aiSummary.usedSources,
      generatedMode: 'manual',
      existingId: existing?.id,
    });

    return saved as T;
  }

  const sumSrcMatch = pathname.match(/^\/api\/summaries\/(daily|weekly|monthly)\/(\d+)\/sources$/);
  if (sumSrcMatch && method === 'GET') {
    const kind = sumSrcMatch[1];
    const sumId = Number(sumSrcMatch[2]);
    const rows = (await listSubcollection<SummarySourceItem>(uid, 'summarySources'))
      .filter((s) => s.summaryKind === kind && s.summaryId === sumId)
      .sort((a, b) => a.id - b.id);
    return rows as T;
  }

  const sumSaveNoteMatch = pathname.match(/^\/api\/summaries\/(daily|weekly|monthly)\/(\d+)\/save-note$/);
  if (sumSaveNoteMatch && method === 'POST') {
    const kind = sumSaveNoteMatch[1] as 'daily' | 'weekly' | 'monthly';
    const sumId = Number(sumSaveNoteMatch[2]);
    const col = summaryCollectionName(kind);
    const sum = await getSubdoc<StoredSummaryRecord>(uid, col, String(sumId));
    if (!sum || sum.deletedAt) throw new Error('Resumen no encontrado.');

    const sectionLines = Object.entries(sum.sections || {})
      .map(([k, v]) => `## ${k.replace(/([A-Z])/g, ' $1').trim()}\n${v}`)
      .join('\n\n');
    const noteContent = `${sum.narrative}\n\n${sectionLines}`.slice(0, 65000);
    const noteId = nextNumericId();
    const nowIso = new Date().toISOString();
    await createSubdoc(uid, 'notes', String(noteId), {
      id: noteId,
      folderId: null,
      projectId: null,
      title: sum.title.slice(0, 200),
      content: noteContent,
      tags: ['resumen', kind, sum.periodKey],
      isQuick: false,
      isPinned: false,
      isArchived: false,
      attachments: [],
      sourceConversationId: null,
      sourceMessageId: null,
      embedding: null,
      deletedAt: null,
    });
    await updateSubdoc(uid, col, String(sumId), { savedNoteId: noteId });
    return { ok: true, noteId, updatedAt: nowIso } as T;
  }

  const sumDelMatch = pathname.match(/^\/api\/summaries\/(daily|weekly|monthly)\/(\d+)$/);
  if (sumDelMatch && method === 'DELETE') {
    const kind = sumDelMatch[1] as 'daily' | 'weekly' | 'monthly';
    const sumId = sumDelMatch[2];
    await updateSubdoc(uid, summaryCollectionName(kind), sumId, { deletedAt: new Date().toISOString() });
    return { ok: true } as T;
  }

  // ---- CONVERSATIONS & GENERAL CHAT ----
  if (pathname === '/api/conversations') {
    if (method === 'GET') {
      const includeArchived = url.searchParams.get('archived') === 'true';
      const rows = (await listSubcollection<StoredConversation>(uid, 'conversations'))
        .filter((c) => !c.deletedAt && (includeArchived ? true : !c.isArchived))
        .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
      return rows as T;
    }
    if (method === 'POST') {
      const id = nextNumericId();
      const nowIso = new Date().toISOString();
      const title =
        typeof body.title === 'string' && body.title.trim()
          ? body.title.trim().slice(0, 120)
          : 'Nueva conversación';
      const projectId = typeof body.projectId === 'number' ? body.projectId : null;
      const item: StoredConversation = {
        id,
        projectId,
        title,
        contextSummary: null,
        isArchived: false,
        lastMessageAt: nowIso,
        deletedAt: null,
      };
      await createSubdoc(uid, 'conversations', String(id), { ...item });
      return item as T;
    }
  }

  const convMessagesMatch = pathname.match(/^\/api\/conversations\/(\d+)\/messages$/);
  if (convMessagesMatch && method === 'GET') {
    const convId = Number(convMessagesMatch[1]);
    const conv = await getSubdoc<StoredConversation>(uid, 'conversations', String(convId));
    if (!conv || conv.deletedAt) throw new Error('Conversación no encontrada.');
    const msgs = (await listSubcollection<StoredMessage>(uid, 'messages'))
      .filter((m) => !m.deletedAt && m.conversationId === convId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return { conversation: conv, messages: msgs } as T;
  }

  const convIdMatch = pathname.match(/^\/api\/conversations\/(\d+)$/);
  if (convIdMatch) {
    const id = Number(convIdMatch[1]);
    if (method === 'PATCH') {
      const patch: Record<string, unknown> = {};
      if (typeof body.title === 'string' && body.title.trim()) patch.title = body.title.trim().slice(0, 120);
      if (typeof body.isArchived === 'boolean') patch.isArchived = body.isArchived;
      await updateSubdoc(uid, 'conversations', String(id), patch);
      const updated = await getSubdoc<StoredConversation>(uid, 'conversations', String(id));
      if (!updated) throw new Error('Conversación no encontrada.');
      return updated as T;
    }
    if (method === 'DELETE') {
      await updateSubdoc(uid, 'conversations', String(id), { deletedAt: new Date().toISOString() });
      return { ok: true, id } as T;
    }
  }

  if (pathname === '/api/inbox/send' && method === 'POST') {
    const userText = typeof body.text === 'string' ? body.text.trim() : '';
    const linkUrl = typeof body.linkUrl === 'string' && body.linkUrl.trim() ? body.linkUrl.trim() : undefined;
    const rawProjectId = typeof body.projectId === 'number' ? body.projectId : null;
    const incomingAtts = Array.isArray(body.attachments)
      ? (body.attachments as Array<{ name: string; mimeType: string; base64Data: string }>)
      : [];

    if (!userText && incomingAtts.length === 0 && !linkUrl) {
      throw new Error('Escribí un mensaje, pegá un enlace o adjuntá archivos.');
    }

    let convId = typeof body.conversationId === 'number' ? body.conversationId : null;
    if (convId) {
      const found = await getSubdoc<StoredConversation>(uid, 'conversations', String(convId));
      if (!found || found.deletedAt) convId = null;
    }
    if (!convId) {
      const convs = (await listSubcollection<StoredConversation>(uid, 'conversations'))
        .filter((c) => !c.deletedAt && !c.isArchived)
        .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
      if (convs[0]) {
        convId = convs[0].id;
      } else {
        convId = nextNumericId();
        await createSubdoc(uid, 'conversations', String(convId), {
          id: convId,
          projectId: rawProjectId,
          title: (userText ? userText.slice(0, 48) : 'Conversación general').slice(0, 120),
          contextSummary: null,
          isArchived: false,
          lastMessageAt: new Date().toISOString(),
          deletedAt: null,
        });
      }
    }

    const userMsgId = nextNumericId();
    const userContent = (
      userText ||
      (incomingAtts.length > 0
        ? `Adjuntos (${incomingAtts.length}): ${incomingAtts.map((a) => a.name).join(', ')}`
        : `Enlace: ${linkUrl}`)
    ).slice(0, 65000);

    await createSubdoc(uid, 'messages', String(userMsgId), {
      id: userMsgId,
      conversationId: convId,
      role: 'user',
      content: userContent,
      processingStatus: 'processing',
      errorMessage: null,
      editedAt: null,
      metadata: linkUrl ? { linkUrl } : {},
      attachments: [],
      deletedAt: null,
    });

    try {
      const result = await processChatTurn({
        uid,
        convId,
        projectId: rawProjectId,
        userMsgId,
        userText,
        linkUrl,
        rawAttachments: incomingAtts,
      });

      const userMsg: MessageItem = {
        id: userMsgId,
        conversationId: convId,
        role: 'user',
        content: userContent,
        processingStatus: result.finalMsgStatus,
        errorMessage: null,
        metadata: linkUrl ? { linkUrl } : {},
        attachments: [],
        createdAt: new Date().toISOString(),
      };

      return {
        conversationId: convId,
        userMessage: userMsg,
        assistantMessage: result.assistantMsg,
        savedMemories: result.savedMemories,
        actions: result.actions,
      } as T;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Error al procesar con SILVV MEMORY.';
      await updateSubdoc(uid, 'messages', String(userMsgId), {
        processingStatus: 'error',
        errorMessage: errMsg.slice(0, 1000),
      }).catch(() => {});
      throw err;
    }
  }

  const regenMatch = pathname.match(/^\/api\/messages\/(\d+)\/regenerate$/);
  if (regenMatch && method === 'PATCH') {
    const msgId = Number(regenMatch[1]);
    const newContent = typeof body.content === 'string' ? body.content.trim() : '';
    if (!newContent) throw new Error('El mensaje no puede estar vacío.');

    const targetMsg = await getSubdoc<StoredMessage>(uid, 'messages', String(msgId));
    if (!targetMsg || targetMsg.deletedAt || targetMsg.role !== 'user') {
      throw new Error('Mensaje de usuario no encontrado.');
    }

    await updateSubdoc(uid, 'messages', String(msgId), {
      content: newContent.slice(0, 65000),
      editedAt: new Date().toISOString(),
      processingStatus: 'processing',
    });

    const convMsgs = (await listSubcollection<StoredMessage>(uid, 'messages'))
      .filter((m) => !m.deletedAt && m.conversationId === targetMsg.conversationId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    const idx = convMsgs.findIndex((m) => m.id === msgId);
    if (idx !== -1 && convMsgs[idx + 1]?.role === 'assistant') {
      await updateSubdoc(uid, 'messages', String(convMsgs[idx + 1].id), {
        deletedAt: new Date().toISOString(),
      });
    }

    const result = await processChatTurn({
      uid,
      convId: targetMsg.conversationId,
      projectId: null,
      userMsgId: msgId,
      userText: newContent,
      rawAttachments: [],
    });

    return { assistantMessage: result.assistantMsg } as T;
  }

  const resolveActionMatch = pathname.match(/^\/api\/actions\/(\d+)\/resolve$/);
  if (resolveActionMatch && method === 'POST') {
    const actionId = Number(resolveActionMatch[1]);
    const decision = body.decision === 'reject' ? 'reject' : 'confirm';
    const actionRow = await getSubdoc<ActionLogItem>(uid, 'actionsLog', String(actionId));
    if (!actionRow) throw new Error('Acción no encontrada.');
    if (actionRow.status !== 'requested') throw new Error('Esta acción ya fue resuelta.');

    if (decision === 'reject') {
      await updateSubdoc(uid, 'actionsLog', String(actionId), {
        status: 'rejected',
        confirmedByUser: false,
      });
      return { action: { ...actionRow, status: 'rejected', confirmedByUser: false } } as T;
    }

    const payload = actionRow.inputPayload || {};
    let outputPayload: Record<string, unknown> = {};

    if (actionRow.toolName === 'update_note') {
      const targetNoteId = Number(payload.targetNoteId);
      const existingNote = await getSubdoc<StoredNote>(uid, 'notes', String(targetNoteId));
      if (!existingNote || existingNote.deletedAt) throw new Error('La nota objetivo ya no existe.');
      const nextTitle = typeof payload.title === 'string' && payload.title.trim() ? payload.title.trim().slice(0, 200) : existingNote.title;
      const nextContent = typeof payload.content === 'string' ? payload.content.slice(0, 65000) : existingNote.content;
      const nextTags = Array.isArray(payload.tags) ? payload.tags.map(String).slice(0, 20) : existingNote.tags;
      await updateSubdoc(uid, 'notes', String(targetNoteId), {
        title: nextTitle,
        content: nextContent,
        tags: nextTags,
      });
      outputPayload = { noteId: targetNoteId, title: nextTitle };
    } else if (actionRow.toolName === 'create_task') {
      const taskId = nextNumericId();
      const title = String(payload.title || 'Tarea').slice(0, 180);
      await createSubdoc(uid, 'tasks', String(taskId), {
        id: taskId,
        projectId: null,
        title,
        description: payload.description ? String(payload.description).slice(0, 2000) : null,
        kind: ['task', 'deadline', 'reminder'].includes(String(payload.kind)) ? String(payload.kind) : 'task',
        status: 'pending',
        priority: ['low', 'medium', 'high', 'urgent'].includes(String(payload.priority))
          ? String(payload.priority)
          : 'medium',
        dueAt: parseDateSafe(payload.dueAtIso ? String(payload.dueAtIso) : null),
        completedAt: null,
        sourceMessageId: typeof payload.sourceMessageId === 'number' ? payload.sourceMessageId : null,
        sourceFileId: typeof payload.sourceFileId === 'number' ? payload.sourceFileId : null,
        deletedAt: null,
      });
      outputPayload = { taskId, title };
    } else if (actionRow.toolName === 'create_event' || actionRow.toolName === 'create_calendar_event') {
      const startIso = parseDateSafe(String(payload.startAtIso || '')) || new Date().toISOString();
      const endIso =
        parseDateSafe(String(payload.endAtIso || '')) ||
        new Date(new Date(startIso).getTime() + 3600000).toISOString();
      const eventId = nextNumericId();
      const title = String(payload.title || 'Evento').slice(0, 180);
      await createSubdoc(uid, 'calendarEvents', String(eventId), {
        id: eventId,
        projectId: null,
        externalProvider: 'local',
        externalEventId: null,
        syncStatus: 'local_only',
        title,
        description: payload.description ? String(payload.description).slice(0, 2000) : null,
        category: payload.category ? String(payload.category).slice(0, 64) : 'Agenda',
        location: payload.location ? String(payload.location).slice(0, 240) : null,
        startAt: startIso,
        endAt: endIso,
        allDay: Boolean(payload.allDay),
        timezone: 'America/Montevideo',
        sourceMessageId: typeof payload.sourceMessageId === 'number' ? payload.sourceMessageId : null,
        sourceFileId: typeof payload.sourceFileId === 'number' ? payload.sourceFileId : null,
        linkedMemoryEventId: null,
        deletedAt: null,
      });
      outputPayload = { eventId, title };
    } else if (actionRow.toolName === 'create_project') {
      const projId = nextNumericId();
      const name = String(payload.name || 'Nuevo proyecto').slice(0, 120);
      const objectivesList = Array.isArray(payload.objectives) ? payload.objectives : [];
      await createSubdoc(uid, 'projects', String(projId), {
        id: projId,
        folderId: null,
        name,
        description: payload.description ? String(payload.description).slice(0, 2000) : null,
        category: payload.category ? String(payload.category).slice(0, 64) : 'General',
        objectives: objectivesList.slice(0, 50).map((o, i) => ({
          id: `${projId}-${i}`,
          title: String(o),
          done: false,
        })),
        status: 'active',
        progressPercent: 0,
        targetDate: payload.targetDate ? String(payload.targetDate).slice(0, 64) : null,
        isPriority: false,
        autoCreated: true,
        lastActivityAt: new Date().toISOString(),
        deletedAt: null,
      });
      outputPayload = { projectId: projId, name };
    }

    await updateSubdoc(uid, 'actionsLog', String(actionId), {
      status: 'executed',
      confirmedByUser: true,
      outputPayload,
    });
    return {
      action: { ...actionRow, status: 'executed', confirmedByUser: true, outputPayload },
    } as T;
  }

  // ---- MEMORIES ----
  if (pathname === '/api/memories') {
    if (method === 'GET') {
      const rows = (await listSubcollection<StoredMemory>(uid, 'memories'))
        .filter((m) => !m.deletedAt)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map(({ embedding: _e, ...rest }) => rest);
      return rows as T;
    }
    if (method === 'POST') {
      const content = typeof body.content === 'string' ? body.content.trim() : '';
      if (!content) throw new Error('El contenido del recuerdo es obligatorio.');
      const layer = ['episodic', 'semantic', 'project', 'temporal'].includes(String(body.memoryLayer))
        ? (body.memoryLayer as MemoryItem['memoryLayer'])
        : 'semantic';
      const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim().slice(0, 200) : null;
      const embRes = await callServerEndpoint<{ embedding: number[] | null }>('/api/ai/embed', 'POST', {
        text: `${title || ''} ${content}`,
      }).catch(() => ({ embedding: null }));

      const memId = nextNumericId();
      const item: StoredMemory = {
        id: memId,
        memoryLayer: layer,
        originKind: typeof body.originKind === 'string' ? body.originKind.slice(0, 32) : 'fact',
        category:
          typeof body.category === 'string' && body.category.trim()
            ? body.category.trim().slice(0, 64)
            : 'General',
        title,
        content: content.slice(0, 16000),
        tags: Array.isArray(body.tags) ? body.tags.map(String).slice(0, 16) : [],
        entities: [],
        importance: typeof body.importance === 'number' ? Math.min(5, Math.max(1, body.importance)) : 3,
        confidence: 1,
        isActive: true,
        projectId: typeof body.projectId === 'number' ? body.projectId : null,
        folderId: typeof body.folderId === 'number' ? body.folderId : null,
        sourceType: 'manual',
        sourceConversationId: null,
        sourceMessageId: null,
        sourceFileId: null,
        expiresAt: null,
        embedding: embRes.embedding ? embRes.embedding.slice(0, 4096) : null,
        deletedAt: null,
        createdAt: new Date().toISOString(),
      };
      await createSubdoc(uid, 'memories', String(memId), { ...item });
      return item as T;
    }
  }

  const memDetailMatch = pathname.match(/^\/api\/memories\/(\d+)\/detail$/);
  if (memDetailMatch && method === 'GET') {
    const id = Number(memDetailMatch[1]);
    const mem = await getSubdoc<StoredMemory>(uid, 'memories', String(id));
    if (!mem || mem.deletedAt) throw new Error('Recuerdo no encontrado.');
    const sourceMessage = mem.sourceMessageId
      ? await getSubdoc<StoredMessage>(uid, 'messages', String(mem.sourceMessageId))
      : null;
    const sourceFile = mem.sourceFileId
      ? await getSubdoc<StoredFile>(uid, 'files', String(mem.sourceFileId))
      : null;
    const res: MemoryDetailResponse = {
      memory: mem,
      sourceMessage: sourceMessage
        ? {
            id: sourceMessage.id,
            conversationId: sourceMessage.conversationId,
            content: sourceMessage.content,
            createdAt: sourceMessage.createdAt,
            attachments: sourceMessage.attachments || [],
          }
        : null,
      sourceFile: sourceFile
        ? {
            id: sourceFile.id,
            displayName: sourceFile.displayName,
            mimeType: sourceFile.mimeType,
            fileKind: sourceFile.fileKind,
            aiSummary: sourceFile.aiSummary,
          }
        : null,
      entities: (mem.entities || []).map((name) => ({
        relationType: 'mentions',
        entityName: name,
        entityType: 'topic',
      })),
    };
    return res as T;
  }

  const memIdMatch = pathname.match(/^\/api\/memories\/(\d+)$/);
  if (memIdMatch) {
    const id = Number(memIdMatch[1]);
    if (method === 'PATCH') {
      const patch: Record<string, unknown> = {};
      if (typeof body.content === 'string' && body.content.trim()) patch.content = body.content.trim().slice(0, 16000);
      if (typeof body.title === 'string') patch.title = body.title.trim().slice(0, 200) || null;
      if (typeof body.category === 'string' && body.category.trim()) patch.category = body.category.trim().slice(0, 64);
      if (typeof body.importance === 'number') patch.importance = Math.min(5, Math.max(1, body.importance));
      if (typeof body.isActive === 'boolean') patch.isActive = body.isActive;
      if (Array.isArray(body.tags)) patch.tags = body.tags.map(String).slice(0, 16);
      if (['episodic', 'semantic', 'project', 'temporal'].includes(String(body.memoryLayer))) {
        patch.memoryLayer = body.memoryLayer;
      }
      await updateSubdoc(uid, 'memories', String(id), patch);
      const updated = await getSubdoc<StoredMemory>(uid, 'memories', String(id));
      if (!updated) throw new Error('Recuerdo no encontrado.');
      return updated as T;
    }
    if (method === 'DELETE') {
      await updateSubdoc(uid, 'memories', String(id), { deletedAt: new Date().toISOString() });
      return { ok: true, id } as T;
    }
  }

  // ---- PROJECTS ----
  if (pathname === '/api/projects') {
    if (method === 'GET') {
      const rows = (await listSubcollection<StoredProject>(uid, 'projects'))
        .filter((p) => !p.deletedAt)
        .sort((a, b) => {
          if (a.isPriority !== b.isPriority) return a.isPriority ? -1 : 1;
          return b.lastActivityAt.localeCompare(a.lastActivityAt);
        });
      return rows as T;
    }
    if (method === 'POST') {
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!name) throw new Error('El nombre del proyecto es obligatorio.');
      const id = nextNumericId();
      const nowIso = new Date().toISOString();
      const objectives: ProjectObjective[] = Array.isArray(body.objectives)
        ? body.objectives.slice(0, 50).map((o, idx) =>
            typeof o === 'string'
              ? { id: `${id}-${idx}`, title: o, done: false }
              : { id: String(o.id || `${id}-${idx}`), title: String(o.title || ''), done: Boolean(o.done) },
          )
        : [];
      const item: StoredProject = {
        id,
        folderId: null,
        name: name.slice(0, 120),
        description: typeof body.description === 'string' ? body.description.trim().slice(0, 2000) || null : null,
        category:
          typeof body.category === 'string' && body.category.trim()
            ? body.category.trim().slice(0, 64)
            : 'General',
        objectives,
        status: 'active',
        progressPercent: 0,
        targetDate: typeof body.targetDate === 'string' && body.targetDate.trim() ? body.targetDate.trim() : null,
        isPriority: Boolean(body.isPriority),
        autoCreated: false,
        lastActivityAt: nowIso,
        deletedAt: null,
        createdAt: nowIso,
      };
      await createSubdoc(uid, 'projects', String(id), { ...item });
      return item as T;
    }
  }

  const projectIdMatch = pathname.match(/^\/api\/projects\/(\d+)$/);
  if (projectIdMatch) {
    const id = Number(projectIdMatch[1]);
    if (method === 'PATCH') {
      const patch: Record<string, unknown> = { lastActivityAt: new Date().toISOString() };
      if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim().slice(0, 120);
      if (typeof body.description === 'string') patch.description = body.description.trim().slice(0, 2000);
      if (typeof body.category === 'string' && body.category.trim()) patch.category = body.category.trim().slice(0, 64);
      if (['idea', 'active', 'paused', 'completed', 'archived'].includes(String(body.status))) {
        patch.status = body.status;
      }
      let computedProgress =
        typeof body.progressPercent === 'number'
          ? Math.min(100, Math.max(0, body.progressPercent))
          : undefined;
      if (Array.isArray(body.objectives)) {
        patch.objectives = body.objectives.slice(0, 50);
        if (body.objectives.length > 0 && computedProgress === undefined) {
          const doneCount = body.objectives.filter((o: { done?: boolean }) => Boolean(o.done)).length;
          computedProgress = Math.round((doneCount / body.objectives.length) * 100);
        }
      }
      if (computedProgress !== undefined) patch.progressPercent = computedProgress;
      if (typeof body.targetDate === 'string') patch.targetDate = body.targetDate || null;
      if (typeof body.isPriority === 'boolean') patch.isPriority = body.isPriority;

      await updateSubdoc(uid, 'projects', String(id), patch);
      const updated = await getSubdoc<StoredProject>(uid, 'projects', String(id));
      if (!updated) throw new Error('Proyecto no encontrado.');
      return updated as T;
    }
    if (method === 'DELETE') {
      await updateSubdoc(uid, 'projects', String(id), { deletedAt: new Date().toISOString() });
      return { ok: true, id } as T;
    }
  }

  // ---- FOLDERS ----
  if (pathname === '/api/folders') {
    if (method === 'GET') {
      const rows = (await listSubcollection<StoredFolder>(uid, 'folders'))
        .filter((f) => !f.deletedAt)
        .sort((a, b) => {
          if (a.isSystem !== b.isSystem) return a.isSystem ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
      return rows as T;
    }
    if (method === 'POST') {
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!name) throw new Error('El nombre de la carpeta es obligatorio.');
      const id = nextNumericId();
      const item: StoredFolder = {
        id,
        parentId: typeof body.parentId === 'number' ? body.parentId : null,
        name: name.slice(0, 80),
        slug: slugify(name),
        category: typeof body.category === 'string' ? body.category.trim().slice(0, 64) : null,
        description: typeof body.description === 'string' ? body.description.trim().slice(0, 500) : null,
        isSystem: false,
        autoCreated: false,
        deletedAt: null,
        createdAt: new Date().toISOString(),
      };
      await createSubdoc(uid, 'folders', String(id), { ...item });
      return item as T;
    }
  }

  const folderIdMatch = pathname.match(/^\/api\/folders\/(\d+)$/);
  if (folderIdMatch) {
    const id = Number(folderIdMatch[1]);
    if (method === 'PATCH') {
      const patch: Record<string, unknown> = {};
      if (typeof body.name === 'string' && body.name.trim()) {
        patch.name = body.name.trim().slice(0, 80);
        patch.slug = slugify(body.name);
      }
      if (body.parentId !== undefined) {
        patch.parentId = typeof body.parentId === 'number' ? body.parentId : null;
      }
      await updateSubdoc(uid, 'folders', String(id), patch);
      const updated = await getSubdoc<StoredFolder>(uid, 'folders', String(id));
      if (!updated) throw new Error('Carpeta no encontrada.');
      return updated as T;
    }
    if (method === 'DELETE') {
      const existing = await getSubdoc<StoredFolder>(uid, 'folders', String(id));
      if (!existing || existing.isSystem) throw new Error('Carpeta no encontrada o protegida.');
      await updateSubdoc(uid, 'folders', String(id), { deletedAt: new Date().toISOString() });
      return { ok: true, id } as T;
    }
  }

  // ---- FILES ----
  if (pathname === '/api/files' && method === 'GET') {
    const rows = (await listSubcollection<StoredFile>(uid, 'files'))
      .filter((f) => !f.deletedAt)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(({ embedding: _e, ...rest }) => rest);
    return rows as T;
  }

  const fileIdMatch = pathname.match(/^\/api\/files\/(\d+)$/);
  if (fileIdMatch) {
    const id = Number(fileIdMatch[1]);
    if (method === 'PATCH') {
      const patch: Record<string, unknown> = {};
      if (typeof body.displayName === 'string' && body.displayName.trim()) {
        patch.displayName = body.displayName.trim().slice(0, 200);
      }
      if (body.folderId !== undefined) patch.folderId = typeof body.folderId === 'number' ? body.folderId : null;
      if (body.projectId !== undefined) patch.projectId = typeof body.projectId === 'number' ? body.projectId : null;
      if (typeof body.detectedCategory === 'string') patch.detectedCategory = body.detectedCategory.trim().slice(0, 64);
      if (['analyzed', 'organized', 'pending_confirmation'].includes(String(body.processingStatus))) {
        patch.processingStatus = body.processingStatus;
      }
      await updateSubdoc(uid, 'files', String(id), patch);
      const updated = await getSubdoc<StoredFile>(uid, 'files', String(id));
      if (!updated) throw new Error('Archivo no encontrado.');
      return updated as T;
    }
    if (method === 'DELETE') {
      await updateSubdoc(uid, 'files', String(id), { deletedAt: new Date().toISOString() });
      return { ok: true, id } as T;
    }
  }

  // ---- TASKS ----
  if (pathname === '/api/tasks') {
    if (method === 'GET') {
      const rows = (await listSubcollection<StoredTask>(uid, 'tasks'))
        .filter((t) => !t.deletedAt)
        .sort((a, b) => {
          if (a.status !== b.status) return a.status.localeCompare(b.status);
          if (a.dueAt && b.dueAt) return a.dueAt.localeCompare(b.dueAt);
          if (a.dueAt) return -1;
          if (b.dueAt) return 1;
          return b.createdAt.localeCompare(a.createdAt);
        });
      return rows as T;
    }
    if (method === 'POST') {
      const title = typeof body.title === 'string' ? body.title.trim() : '';
      if (!title) throw new Error('El título de la tarea es obligatorio.');
      const id = nextNumericId();
      const item: StoredTask = {
        id,
        projectId: typeof body.projectId === 'number' ? body.projectId : null,
        title: title.slice(0, 180),
        description: typeof body.description === 'string' ? body.description.trim().slice(0, 2000) || null : null,
        kind: ['task', 'deadline', 'reminder'].includes(String(body.kind))
          ? (body.kind as TaskItem['kind'])
          : 'task',
        status: 'pending',
        priority: ['low', 'medium', 'high', 'urgent'].includes(String(body.priority))
          ? (body.priority as TaskItem['priority'])
          : 'medium',
        dueAt: parseDateSafe(typeof body.dueAt === 'string' ? body.dueAt : null),
        completedAt: null,
        sourceMessageId: null,
        sourceFileId: null,
        deletedAt: null,
        createdAt: new Date().toISOString(),
      };
      await createSubdoc(uid, 'tasks', String(id), { ...item });
      return item as T;
    }
  }

  const taskIdMatch = pathname.match(/^\/api\/tasks\/(\d+)$/);
  if (taskIdMatch) {
    const id = Number(taskIdMatch[1]);
    if (method === 'PATCH') {
      const patch: Record<string, unknown> = {};
      if (typeof body.title === 'string' && body.title.trim()) patch.title = body.title.trim().slice(0, 180);
      if (typeof body.description === 'string') patch.description = body.description.trim().slice(0, 2000);
      if (['pending', 'in_progress', 'done', 'cancelled'].includes(String(body.status))) {
        patch.status = body.status;
        patch.completedAt = body.status === 'done' ? new Date().toISOString() : null;
      }
      if (['low', 'medium', 'high', 'urgent'].includes(String(body.priority))) {
        patch.priority = body.priority;
      }
      if (body.dueAt !== undefined) patch.dueAt = parseDateSafe(typeof body.dueAt === 'string' ? body.dueAt : null);
      if (body.projectId !== undefined) patch.projectId = typeof body.projectId === 'number' ? body.projectId : null;
      await updateSubdoc(uid, 'tasks', String(id), patch);
      const updated = await getSubdoc<StoredTask>(uid, 'tasks', String(id));
      if (!updated) throw new Error('Tarea no encontrada.');
      return updated as T;
    }
    if (method === 'DELETE') {
      await updateSubdoc(uid, 'tasks', String(id), { deletedAt: new Date().toISOString() });
      return { ok: true, id } as T;
    }
  }

  // ---- CALENDAR REAL & GOOGLE CALENDAR ----
  if (pathname === '/api/calendar') {
    if (method === 'GET') {
      const rows = (await listSubcollection<StoredEvent>(uid, 'calendarEvents'))
        .filter((e) => !e.deletedAt)
        .sort((a, b) => a.startAt.localeCompare(b.startAt));
      return rows as T;
    }
    if (method === 'POST') {
      const title = typeof body.title === 'string' ? body.title.trim() : '';
      const startIso = parseDateSafe(typeof body.startAt === 'string' ? body.startAt : null);
      if (!title || !startIso) throw new Error('Título y fecha de inicio válidos son obligatorios.');
      const startMs = new Date(startIso).getTime();
      const endIso =
        parseDateSafe(typeof body.endAt === 'string' ? body.endAt : null) ||
        new Date(startMs + 3600000).toISOString();
      const endMs = new Date(endIso).getTime();

      const existing = (await listSubcollection<StoredEvent>(uid, 'calendarEvents')).filter((e) => !e.deletedAt);
      const conflicts = existing.filter(
        (e) => startMs < new Date(e.endAt).getTime() && endMs > new Date(e.startAt).getTime(),
      );

      let externalProvider = 'local';
      let externalEventId: string | null = null;
      let syncStatus = 'local_only';

      if (body.syncToGoogle && getGoogleAccessToken()) {
        const gRes = await callServerEndpoint<{ externalEventId: string | null }>(
          '/api/google-calendar/events',
          'POST',
          {
            title,
            description: body.description,
            location: body.location,
            startIso,
            endIso,
            allDay: Boolean(body.allDay),
            timezone: 'America/Montevideo',
          },
          true,
        );
        externalProvider = 'google';
        externalEventId = gRes.externalEventId;
        syncStatus = 'synced';
      }

      const id = nextNumericId();
      const created: StoredEvent = {
        id,
        projectId: typeof body.projectId === 'number' ? body.projectId : null,
        externalProvider,
        externalEventId,
        syncStatus,
        title: title.slice(0, 180),
        description: typeof body.description === 'string' ? body.description.trim().slice(0, 2000) || null : null,
        category: typeof body.category === 'string' ? body.category.trim().slice(0, 64) : 'Agenda',
        location: typeof body.location === 'string' ? body.location.trim().slice(0, 240) || null : null,
        startAt: startIso,
        endAt: endIso,
        allDay: Boolean(body.allDay),
        timezone: 'America/Montevideo',
        sourceMessageId: null,
        sourceFileId: null,
        linkedMemoryEventId: null,
        deletedAt: null,
      };
      await createSubdoc(uid, 'calendarEvents', String(id), { ...created });
      return { event: created, conflicts } as T;
    }
  }

  if (pathname === '/api/calendar/google/sync' && method === 'POST') {
    const syncRes = await callServerEndpoint<{
      items: Array<{
        id: string;
        summary?: string;
        description?: string;
        location?: string;
        start?: { dateTime?: string; date?: string; timeZone?: string };
        end?: { dateTime?: string; date?: string };
      }>;
      accountEmail: string | null;
    }>('/api/google-calendar/sync', 'POST', {}, true);

    const existingRows = (await listSubcollection<StoredEvent>(uid, 'calendarEvents')).filter((e) => !e.deletedAt);
    let importedCount = 0;

    for (const item of syncRes.items || []) {
      if (!item.id || !item.summary) continue;
      const startIso = parseDateSafe(item.start?.dateTime || item.start?.date);
      if (!startIso) continue;
      const endIso =
        parseDateSafe(item.end?.dateTime || item.end?.date) ||
        new Date(new Date(startIso).getTime() + 3600000).toISOString();
      const allDay = Boolean(item.start?.date && !item.start?.dateTime);

      const match = existingRows.find(
        (r) => r.externalProvider === 'google' && r.externalEventId === item.id,
      );
      if (match) {
        await updateSubdoc(uid, 'calendarEvents', String(match.id), {
          title: item.summary.slice(0, 180),
          description: item.description ? item.description.slice(0, 2000) : null,
          location: item.location ? item.location.slice(0, 240) : null,
          startAt: startIso,
          endAt: endIso,
          allDay,
          syncStatus: 'synced',
        });
      } else {
        const id = nextNumericId();
        await createSubdoc(uid, 'calendarEvents', String(id), {
          id,
          projectId: null,
          externalProvider: 'google',
          externalEventId: item.id.slice(0, 256),
          syncStatus: 'synced',
          title: item.summary.slice(0, 180),
          description: item.description ? item.description.slice(0, 2000) : null,
          category: 'Google Calendar',
          location: item.location ? item.location.slice(0, 240) : null,
          startAt: startIso,
          endAt: endIso,
          allDay,
          timezone: (item.start?.timeZone || 'America/Montevideo').slice(0, 64),
          sourceMessageId: null,
          sourceFileId: null,
          linkedMemoryEventId: null,
          deletedAt: null,
        });
        importedCount++;
      }
    }

    const existingInt = await getSubdoc<GoogleCalendarIntegration>(uid, 'integrations', 'google_calendar');
    const nowIso = new Date().toISOString();
    if (existingInt) {
      await updateSubdoc(uid, 'integrations', 'google_calendar', {
        status: 'connected',
        accountEmail: syncRes.accountEmail,
        lastSyncedAt: nowIso,
        lastError: null,
      });
    } else {
      await createSubdoc(uid, 'integrations', 'google_calendar', {
        id: 1,
        provider: 'google_calendar',
        status: 'connected',
        accountEmail: syncRes.accountEmail,
        lastSyncedAt: nowIso,
        lastError: null,
      });
    }

    return { ok: true, importedCount, totalFetched: (syncRes.items || []).length } as T;
  }

  const calIdMatch = pathname.match(/^\/api\/calendar\/(\d+)$/);
  if (calIdMatch) {
    const id = Number(calIdMatch[1]);
    const existing = await getSubdoc<StoredEvent>(uid, 'calendarEvents', String(id));
    if (!existing || existing.deletedAt) throw new Error('Evento no encontrado.');

    if (method === 'PATCH') {
      const nextTitle =
        typeof body.title === 'string' && body.title.trim() ? body.title.trim().slice(0, 180) : existing.title;
      const nextDesc =
        typeof body.description === 'string' ? body.description.trim().slice(0, 2000) : existing.description;
      const nextLoc =
        typeof body.location === 'string' ? body.location.trim().slice(0, 240) : existing.location;
      const nextStart = parseDateSafe(typeof body.startAt === 'string' ? body.startAt : null) || existing.startAt;
      const nextEnd = parseDateSafe(typeof body.endAt === 'string' ? body.endAt : null) || existing.endAt;

      if (existing.externalProvider === 'google' && existing.externalEventId && body.syncToGoogle && getGoogleAccessToken()) {
        await callServerEndpoint(
          `/api/google-calendar/events/${encodeURIComponent(existing.externalEventId)}`,
          'PATCH',
          {
            title: nextTitle,
            description: nextDesc,
            location: nextLoc,
            startIso: nextStart,
            endIso: nextEnd,
            timezone: existing.timezone,
          },
          true,
        );
      }

      await updateSubdoc(uid, 'calendarEvents', String(id), {
        title: nextTitle,
        description: nextDesc,
        location: nextLoc,
        startAt: nextStart,
        endAt: nextEnd,
      });
      return {
        ...existing,
        title: nextTitle,
        description: nextDesc,
        location: nextLoc,
        startAt: nextStart,
        endAt: nextEnd,
      } as T;
    }

    if (method === 'DELETE') {
      if (existing.externalProvider === 'google' && existing.externalEventId && getGoogleAccessToken()) {
        await callServerEndpoint(
          `/api/google-calendar/events/${encodeURIComponent(existing.externalEventId)}`,
          'DELETE',
          undefined,
          true,
        ).catch(() => {});
      }
      await updateSubdoc(uid, 'calendarEvents', String(id), { deletedAt: new Date().toISOString() });
      return { ok: true, id } as T;
    }
  }

  // ---- KNOWLEDGE RAG CHAT (MEMORIES + NOTES + MEMORY EVENTS + FILES + PROJECTS + MESSAGES) ----
  if (pathname === '/api/knowledge/conversations') {
    if (method === 'GET') {
      const rows = (await listSubcollection<StoredKnowledgeConv>(uid, 'knowledgeConversations'))
        .filter((c) => !c.deletedAt)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      return rows as T;
    }
    if (method === 'POST') {
      const id = nextNumericId();
      const nowIso = new Date().toISOString();
      const item: StoredKnowledgeConv = {
        id,
        title:
          typeof body.title === 'string' && body.title.trim()
            ? body.title.trim().slice(0, 160)
            : 'Investigación en mi memoria',
        deepMode: Boolean(body.deepMode),
        deletedAt: null,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      await createSubdoc(uid, 'knowledgeConversations', String(id), { ...item });
      return item as T;
    }
  }

  const kcMsgMatch = pathname.match(/^\/api\/knowledge\/conversations\/(\d+)\/messages$/);
  if (kcMsgMatch && method === 'GET') {
    const convId = Number(kcMsgMatch[1]);
    const conv = await getSubdoc<StoredKnowledgeConv>(uid, 'knowledgeConversations', String(convId));
    if (!conv || conv.deletedAt) throw new Error('Conversación de conocimiento no encontrada.');
    const msgs = (await listSubcollection<KnowledgeMessage>(uid, 'knowledgeMessages'))
      .filter((m) => m.conversationId === convId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return { conversation: conv, messages: msgs } as T;
  }

  if (pathname === '/api/knowledge/ask' && method === 'POST') {
    const question = typeof body.question === 'string' ? body.question.trim() : '';
    if (!question) throw new Error('Escribí una pregunta para investigar tu memoria.');
    const deepMode = Boolean(body.deepMode);

    let convId = typeof body.conversationId === 'number' ? body.conversationId : null;
    if (!convId) {
      convId = nextNumericId();
      await createSubdoc(uid, 'knowledgeConversations', String(convId), {
        id: convId,
        title: question.slice(0, 160),
        deepMode,
        deletedAt: null,
      });
    }

    const userMsgId = nextNumericId();
    const userMsg: KnowledgeMessage = {
      id: userMsgId,
      conversationId: convId,
      role: 'user',
      content: question.slice(0, 65000),
      deepMode,
      citations: [],
      metadata: {},
      createdAt: new Date().toISOString(),
    };
    await createSubdoc(uid, 'knowledgeMessages', String(userMsgId), { ...userMsg });

    const [allMems, allFiles, allProjs, allMsgs, allNotes, allMemEvents, prevKMsgs, { user }] = await Promise.all([
      listSubcollection<StoredMemory>(uid, 'memories'),
      listSubcollection<StoredFile>(uid, 'files'),
      listSubcollection<StoredProject>(uid, 'projects'),
      listSubcollection<StoredMessage>(uid, 'messages'),
      listSubcollection<StoredNote>(uid, 'notes'),
      listSubcollection<StoredMemoryEvent>(uid, 'memoryEvents'),
      listSubcollection<KnowledgeMessage>(uid, 'knowledgeMessages'),
      getMe(uid),
    ]);

    const hasEmbeddedKnowledge =
      allMems.some((x) => !x.deletedAt && x.isActive && Array.isArray(x.embedding) && x.embedding.length > 0) ||
      allFiles.some((x) => !x.deletedAt && Array.isArray(x.embedding) && x.embedding.length > 0) ||
      allNotes.some((x) => !x.deletedAt && Array.isArray(x.embedding) && x.embedding.length > 0) ||
      allMemEvents.some((x) => !x.deletedAt && Array.isArray(x.embedding) && x.embedding.length > 0);

    let queryEmbedding: number[] | null = null;
    if (hasEmbeddedKnowledge) {
      const embRes = await withRaceTimeout(
        callServerEndpoint<{ embedding: number[] | null }>('/api/ai/embed', 'POST', {
          text: question,
        }).catch(() => ({ embedding: null })),
        2000,
        { embedding: null },
      );
      queryEmbedding = embRes.embedding;
    }
    const keywords = question
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length >= 3);
    const scoreText = (txt: string) => {
      const lower = txt.toLowerCase();
      let hits = 0;
      for (const k of keywords) if (lower.includes(k)) hits += 0.35;
      return hits;
    };

    const candidateSources: Array<{
      sourceType: KnowledgeCitation['sourceType'];
      sourceId: number;
      title: string;
      category: string;
      date: string;
      content: string;
      score: number;
    }> = [];

    for (const m of allMems.filter((x) => !x.deletedAt && x.isActive)) {
      const sim = queryEmbedding ? cosineSimilarity(queryEmbedding, m.embedding) : 0;
      const kw = scoreText(`${m.title || ''} ${m.content} ${m.category}`);
      candidateSources.push({
        sourceType: 'memory',
        sourceId: m.id,
        title: m.title || `${m.memoryLayer} · ${m.category}`,
        category: `${m.memoryLayer}/${m.originKind}`,
        date: m.createdAt,
        content: m.content,
        score: sim * 2 + kw + m.importance * 0.08,
      });
    }

    for (const n of allNotes.filter((x) => !x.deletedAt)) {
      const sim = queryEmbedding ? cosineSimilarity(queryEmbedding, n.embedding) : 0;
      const kw = scoreText(`${n.title} ${n.content} ${(n.tags || []).join(' ')}`);
      candidateSources.push({
        sourceType: 'note',
        sourceId: n.id,
        title: `Nota: ${n.title}`,
        category: n.tags?.join(', ') || 'Nota',
        date: n.updatedAt || n.createdAt,
        content: n.content.slice(0, 3000),
        score: sim * 2 + kw + 0.14,
      });
    }

    for (const me of allMemEvents.filter((x) => !x.deletedAt)) {
      const sim = queryEmbedding ? cosineSimilarity(queryEmbedding, me.embedding) : 0;
      const kw = scoreText(`${me.title} ${me.description} ${me.people.join(' ')} ${me.category}`);
      candidateSources.push({
        sourceType: 'memory_event',
        sourceId: me.id,
        title: `Agenda Memoria: ${me.title}`,
        category: me.category,
        date: me.eventDate || me.createdAt,
        content: `${me.dateLabel || ''} · Personas: ${me.people.join(', ') || 'ninguna'}\n${me.description}`,
        score: sim * 2 + kw + me.importance * 0.08,
      });
    }

    for (const f of allFiles.filter((x) => !x.deletedAt)) {
      const txt = `${f.displayName} ${f.aiSummary || ''} ${f.extractedText || ''}`.trim();
      const sim = queryEmbedding ? cosineSimilarity(queryEmbedding, f.embedding) : 0;
      const kw = scoreText(txt);
      candidateSources.push({
        sourceType: 'file',
        sourceId: f.id,
        title: f.displayName,
        category: f.detectedCategory || f.fileKind,
        date: f.createdAt,
        content: (f.aiSummary ? `Resumen: ${f.aiSummary}\n` : '') + (f.extractedText || '').slice(0, 2500),
        score: sim * 2 + kw + 0.1,
      });
    }

    for (const p of allProjs.filter((x) => !x.deletedAt)) {
      const txt = `${p.name} ${p.description || ''} ${p.objectives.map((o) => o.title).join('; ')}`;
      candidateSources.push({
        sourceType: 'project',
        sourceId: p.id,
        title: `Proyecto: ${p.name}`,
        category: p.category || 'Proyecto',
        date: p.createdAt,
        content: txt,
        score: scoreText(txt) + 0.15,
      });
    }

    const msgLimit = deepMode ? 120 : 50;
    for (const msg of allMsgs
      .filter((x) => !x.deletedAt)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, msgLimit)) {
      candidateSources.push({
        sourceType: 'message',
        sourceId: msg.id,
        title: `Conversación #${msg.conversationId} (${msg.role})`,
        category: 'Chat',
        date: msg.createdAt,
        content: msg.content.slice(0, 1500),
        score: scoreText(msg.content),
      });
    }

    const topSources = candidateSources
      .sort((a, b) => b.score - a.score)
      .slice(0, deepMode ? 50 : 22)
      .map(({ sourceType, sourceId, title, category, date, content }) => ({
        sourceType,
        sourceId,
        title,
        category,
        date,
        content,
      }));

    const history = prevKMsgs
      .filter((m) => m.conversationId === convId && m.id !== userMsgId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(-12)
      .map((m) => ({ role: m.role, content: m.content }));

    const ragResult = await callServerEndpoint<{
      answer: string;
      insufficientData: boolean;
      citations: Array<{
        sourceType: KnowledgeCitation['sourceType'];
        sourceId: number;
        title: string;
        excerpt: string;
        date: string;
      }>;
    }>('/api/ai/knowledge', 'POST', {
      question,
      deepMode,
      timezone: user.timezone || 'America/Montevideo',
      sources: topSources,
      history,
    });

    const assistantMsgId = nextNumericId();
    const assistantMsg: KnowledgeMessage = {
      id: assistantMsgId,
      conversationId: convId,
      role: 'assistant',
      content: (ragResult.answer || 'No se pudo completar el análisis.').slice(0, 65000),
      deepMode,
      citations: (ragResult.citations || []).slice(0, 30),
      metadata: {
        insufficientData: ragResult.insufficientData,
        inspectedSources: topSources.length,
      },
      createdAt: new Date().toISOString(),
    };
    await createSubdoc(uid, 'knowledgeMessages', String(assistantMsgId), { ...assistantMsg });
    await updateSubdoc(uid, 'knowledgeConversations', String(convId), { deepMode });

    return { conversationId: convId, userMessage: userMsg, assistantMessage: assistantMsg } as T;
  }

  if (pathname === '/api/knowledge/source' && method === 'GET') {
    const type = url.searchParams.get('type') || '';
    const id = url.searchParams.get('id') || '';
    if (!id) throw new Error('ID inválido.');
    const subMap: Record<string, string> = {
      memory: 'memories',
      file: 'files',
      message: 'messages',
      project: 'projects',
      note: 'notes',
      memory_event: 'memoryEvents',
    };
    const sub = subMap[type];
    if (!sub) throw new Error('Tipo de fuente inválido.');
    const item = await getSubdoc(uid, sub, id);
    if (!item) throw new Error('Fuente no encontrada.');
    return { type, item } as T;
  }

  // ---- CUSTOM AGENTS ----
  if (pathname === '/api/agents') {
    if (method === 'GET') {
      const rows = (await listSubcollection<StoredAgent>(uid, 'agents'))
        .filter((a) => !a.deletedAt)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      return rows as T;
    }
    if (method === 'POST') {
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!name) throw new Error('El nombre del agente es obligatorio.');
      const validPerm: AgentPermissionMode = [
        'docs_only',
        'docs_and_agent_memory',
        'docs_and_selected_folders',
        'full_personal_memory',
      ].includes(String(body.permissionMode))
        ? (body.permissionMode as AgentPermissionMode)
        : 'docs_only';
      const id = nextNumericId();
      const nowIso = new Date().toISOString();
      const item: StoredAgent = {
        id,
        name: name.slice(0, 100),
        description: typeof body.description === 'string' ? body.description.trim().slice(0, 1000) || null : null,
        icon: typeof body.icon === 'string' ? body.icon.slice(0, 32) : 'bot',
        instructions: typeof body.instructions === 'string' ? body.instructions.slice(0, 16000) : '',
        personality:
          typeof body.personality === 'string'
            ? body.personality.slice(0, 300)
            : 'Analítico, claro y estructurado',
        objective: typeof body.objective === 'string' ? body.objective.slice(0, 500) || null : null,
        responseStyle:
          typeof body.responseStyle === 'string' ? body.responseStyle.slice(0, 300) : 'Profesional y directo',
        depthLevel: ['concise', 'balanced', 'deep'].includes(String(body.depthLevel))
          ? (body.depthLevel as AgentItem['depthLevel'])
          : 'balanced',
        toolsEnabled: Array.isArray(body.toolsEnabled)
          ? body.toolsEnabled.map(String).slice(0, 20)
          : ['search_agent_knowledge'],
        memoryEnabled: typeof body.memoryEnabled === 'boolean' ? body.memoryEnabled : true,
        permissionMode: validPerm,
        allowedFolderIds: Array.isArray(body.allowedFolderIds)
          ? body.allowedFolderIds.map(Number).filter(Number.isFinite).slice(0, 50)
          : [],
        isArchived: false,
        deletedAt: null,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      await createSubdoc(uid, 'agents', String(id), { ...item });
      return item as T;
    }
  }

  const agDupMatch = pathname.match(/^\/api\/agents\/(\d+)\/duplicate$/);
  if (agDupMatch && method === 'POST') {
    const orig = await getSubdoc<StoredAgent>(uid, 'agents', agDupMatch[1]);
    if (!orig || orig.deletedAt) throw new Error('Agente no encontrado.');
    const id = nextNumericId();
    const nowIso = new Date().toISOString();
    const copy: StoredAgent = {
      ...orig,
      id,
      name: `${orig.name} (Copia)`.slice(0, 100),
      isArchived: false,
      deletedAt: null,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    await createSubdoc(uid, 'agents', String(id), { ...copy });
    return copy as T;
  }

  const agSourcesMatch = pathname.match(/^\/api\/agents\/(\d+)\/sources$/);
  if (agSourcesMatch) {
    const agentId = Number(agSourcesMatch[1]);
    if (method === 'GET') {
      const rows = (await listSubcollection<StoredAgentSource>(uid, 'agentSources'))
        .filter((s) => !s.deletedAt && s.agentId === agentId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map(({ embedding: _e, ...rest }) => rest);
      return rows as T;
    }
    if (method === 'POST') {
      const ag = await getSubdoc<StoredAgent>(uid, 'agents', String(agentId));
      if (!ag || ag.deletedAt) throw new Error('Agente no encontrado.');
      const analyzed = await callServerEndpoint<{
        storagePath: string;
        sizeBytes: number;
        extractedText: string;
        aiSummary: string;
        embedding: number[] | null;
      }>('/api/ai/agent-doc', 'POST', body);

      const id = nextNumericId();
      const item: StoredAgentSource = {
        id,
        agentId,
        fileName: String(body.name || 'documento').slice(0, 200),
        mimeType: String(body.mimeType || 'application/octet-stream').slice(0, 120),
        sizeBytes: analyzed.sizeBytes,
        storagePath: analyzed.storagePath.slice(0, 512),
        aiSummary: analyzed.aiSummary ? analyzed.aiSummary.slice(0, 16000) : null,
        extractedText: analyzed.extractedText ? analyzed.extractedText.slice(0, 65000) : null,
        embedding: analyzed.embedding ? analyzed.embedding.slice(0, 4096) : null,
        deletedAt: null,
        createdAt: new Date().toISOString(),
      };
      await createSubdoc(uid, 'agentSources', String(id), { ...item });
      return item as T;
    }
  }

  const agSrcDelMatch = pathname.match(/^\/api\/agents\/(\d+)\/sources\/(\d+)$/);
  if (agSrcDelMatch && method === 'DELETE') {
    await deleteSubdoc(uid, 'agentSources', agSrcDelMatch[2]);
    return { ok: true } as T;
  }

  const agConvMsgsMatch = pathname.match(/^\/api\/agents\/(\d+)\/conversations\/(\d+)\/messages$/);
  if (agConvMsgsMatch && method === 'GET') {
    const agentId = Number(agConvMsgsMatch[1]);
    const convId = Number(agConvMsgsMatch[2]);
    const rows = (await listSubcollection<AgentMessage>(uid, 'agentMessages'))
      .filter((m) => m.agentId === agentId && m.conversationId === convId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return rows as T;
  }

  const agConvsMatch = pathname.match(/^\/api\/agents\/(\d+)\/conversations$/);
  if (agConvsMatch && method === 'GET') {
    const agentId = Number(agConvsMatch[1]);
    const rows = (await listSubcollection<AgentConversation & { deletedAt?: string | null }>(
      uid,
      'agentConversations',
    ))
      .filter((c) => !c.deletedAt && c.agentId === agentId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return rows as T;
  }

  const agMemoriesMatch = pathname.match(/^\/api\/agents\/(\d+)\/memories$/);
  if (agMemoriesMatch && method === 'GET') {
    const agentId = Number(agMemoriesMatch[1]);
    const rows = (await listSubcollection<StoredAgentMemory>(uid, 'agentMemories'))
      .filter((m) => m.agentId === agentId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return rows as T;
  }

  const agChatMatch = pathname.match(/^\/api\/agents\/(\d+)\/chat$/);
  if (agChatMatch && method === 'POST') {
    const agentId = Number(agChatMatch[1]);
    const userMessage = typeof body.message === 'string' ? body.message.trim() : '';
    if (!userMessage) throw new Error('Escribí un mensaje para el agente.');
    const ag = await getSubdoc<StoredAgent>(uid, 'agents', String(agentId));
    if (!ag || ag.deletedAt) throw new Error('Agente no encontrado.');

    let convId = typeof body.conversationId === 'number' ? body.conversationId : null;
    if (!convId) {
      convId = nextNumericId();
      await createSubdoc(uid, 'agentConversations', String(convId), {
        id: convId,
        agentId,
        title: userMessage.slice(0, 160),
        deletedAt: null,
      });
    }

    const userMsgId = nextNumericId();
    const savedUserMsg: AgentMessage = {
      id: userMsgId,
      conversationId: convId,
      agentId,
      role: 'user',
      content: userMessage.slice(0, 65000),
      citations: [],
      createdAt: new Date().toISOString(),
    };
    await createSubdoc(uid, 'agentMessages', String(userMsgId), { ...savedUserMsg });

    const [allDocs, allAgMems, allAgMsgs] = await Promise.all([
      listSubcollection<StoredAgentSource>(uid, 'agentSources'),
      listSubcollection<StoredAgentMemory>(uid, 'agentMemories'),
      listSubcollection<AgentMessage>(uid, 'agentMessages'),
    ]);

    const hasEmbeddedDocs = allDocs.some(
      (d) => !d.deletedAt && d.agentId === agentId && Array.isArray(d.embedding) && d.embedding.length > 0,
    );
    let qEmb: number[] | null = null;
    if (
      hasEmbeddedDocs ||
      ag.permissionMode === 'docs_and_selected_folders' ||
      ag.permissionMode === 'full_personal_memory'
    ) {
      const qEmbRes = await withRaceTimeout(
        callServerEndpoint<{ embedding: number[] | null }>('/api/ai/embed', 'POST', {
          text: userMessage,
        }).catch(() => ({ embedding: null })),
        2000,
        { embedding: null },
      );
      qEmb = qEmbRes.embedding;
    }

    const authorizedSources: Array<{
      sourceType: string;
      sourceId: number;
      title: string;
      content: string;
      score: number;
    }> = allDocs
      .filter((d) => !d.deletedAt && d.agentId === agentId)
      .map((d) => ({
        sourceType: 'agent_document',
        sourceId: d.id,
        title: d.fileName,
        content: `${d.aiSummary ? `Resumen: ${d.aiSummary}\n` : ''}${(d.extractedText || '').slice(0, 4000)}`,
        score: (qEmb ? cosineSimilarity(qEmb, d.embedding) : 0) + 0.5,
      }));

    const agMems =
      ag.permissionMode !== 'docs_only' && ag.memoryEnabled
        ? allAgMems
            .filter((m) => m.agentId === agentId)
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .slice(0, 20)
            .map((m) => ({ content: m.content, category: m.category }))
        : [];

    if (ag.permissionMode === 'docs_and_selected_folders' && ag.allowedFolderIds.length > 0) {
      const allowedSet = new Set(ag.allowedFolderIds);
      const [allFiles, allMems] = await Promise.all([
        listSubcollection<StoredFile>(uid, 'files'),
        listSubcollection<StoredMemory>(uid, 'memories'),
      ]);
      for (const f of allFiles.filter((x) => !x.deletedAt && x.folderId !== null && allowedSet.has(x.folderId))) {
        authorizedSources.push({
          sourceType: 'silvv_file',
          sourceId: f.id,
          title: f.displayName,
          content: `${f.aiSummary || ''}\n${(f.extractedText || '').slice(0, 2000)}`,
          score: qEmb ? cosineSimilarity(qEmb, f.embedding) : 0.2,
        });
      }
      for (const m of allMems.filter((x) => !x.deletedAt && x.folderId !== null && allowedSet.has(x.folderId))) {
        authorizedSources.push({
          sourceType: 'silvv_memory',
          sourceId: m.id,
          title: m.title || m.category,
          content: m.content,
          score: qEmb ? cosineSimilarity(qEmb, m.embedding) : 0.2,
        });
      }
    } else if (ag.permissionMode === 'full_personal_memory') {
      const [allFiles, allMems, allNotes] = await Promise.all([
        listSubcollection<StoredFile>(uid, 'files'),
        listSubcollection<StoredMemory>(uid, 'memories'),
        listSubcollection<StoredNote>(uid, 'notes'),
      ]);
      for (const m of allMems.filter((x) => !x.deletedAt && x.isActive).slice(0, 35)) {
        authorizedSources.push({
          sourceType: 'silvv_memory',
          sourceId: m.id,
          title: m.title || m.category,
          content: m.content,
          score: qEmb ? cosineSimilarity(qEmb, m.embedding) : 0.2,
        });
      }
      for (const n of allNotes.filter((x) => !x.deletedAt).slice(0, 20)) {
        authorizedSources.push({
          sourceType: 'silvv_note',
          sourceId: n.id,
          title: `Nota: ${n.title}`,
          content: n.content.slice(0, 2000),
          score: qEmb ? cosineSimilarity(qEmb, n.embedding) : 0.2,
        });
      }
      for (const f of allFiles.filter((x) => !x.deletedAt).slice(0, 20)) {
        authorizedSources.push({
          sourceType: 'silvv_file',
          sourceId: f.id,
          title: f.displayName,
          content: `${f.aiSummary || ''}\n${(f.extractedText || '').slice(0, 2000)}`,
          score: qEmb ? cosineSimilarity(qEmb, f.embedding) : 0.2,
        });
      }
    }

    const history = allAgMsgs
      .filter((m) => m.agentId === agentId && m.conversationId === convId && m.id !== userMsgId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(-12)
      .map((m) => ({ role: m.role, content: m.content }));

    const topSources = authorizedSources
      .sort((a, b) => b.score - a.score)
      .slice(0, 20)
      .map(({ sourceType, sourceId, title, content }) => ({ sourceType, sourceId, title, content }));

    const reply = await callServerEndpoint<{
      answer: string;
      citations: Array<{ sourceType: string; sourceId: number; title: string; excerpt: string }>;
      newAgentMemory: string;
    }>('/api/ai/agent-chat', 'POST', {
      agent: ag,
      question: userMessage,
      sources: topSources,
      agentMemories: agMems,
      history,
    });

    if (reply.newAgentMemory && ag.memoryEnabled) {
      const amId = nextNumericId();
      await createSubdoc(uid, 'agentMemories', String(amId), {
        id: amId,
        agentId,
        content: reply.newAgentMemory.slice(0, 8000),
        category: 'general',
      });
    }

    const assistantMsgId = nextNumericId();
    const savedAssistantMsg: AgentMessage = {
      id: assistantMsgId,
      conversationId: convId,
      agentId,
      role: 'assistant',
      content: (reply.answer || 'Listo.').slice(0, 65000),
      citations: (reply.citations || []).slice(0, 30),
      createdAt: new Date().toISOString(),
    };
    await createSubdoc(uid, 'agentMessages', String(assistantMsgId), { ...savedAssistantMsg });
    await updateSubdoc(uid, 'agentConversations', String(convId), {});

    return {
      conversationId: convId,
      userMessage: savedUserMsg,
      assistantMessage: savedAssistantMsg,
    } as T;
  }

  const agIdMatch = pathname.match(/^\/api\/agents\/(\d+)$/);
  if (agIdMatch) {
    const id = Number(agIdMatch[1]);
    if (method === 'PATCH') {
      const patch: Record<string, unknown> = {};
      if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim().slice(0, 100);
      if (typeof body.description === 'string') patch.description = body.description.slice(0, 1000);
      if (typeof body.icon === 'string') patch.icon = body.icon.slice(0, 32);
      if (typeof body.instructions === 'string') patch.instructions = body.instructions.slice(0, 16000);
      if (typeof body.personality === 'string') patch.personality = body.personality.slice(0, 300);
      if (typeof body.objective === 'string') patch.objective = body.objective.slice(0, 500);
      if (typeof body.responseStyle === 'string') patch.responseStyle = body.responseStyle.slice(0, 300);
      if (['concise', 'balanced', 'deep'].includes(String(body.depthLevel))) patch.depthLevel = body.depthLevel;
      if (Array.isArray(body.toolsEnabled)) patch.toolsEnabled = body.toolsEnabled.map(String).slice(0, 20);
      if (typeof body.memoryEnabled === 'boolean') patch.memoryEnabled = body.memoryEnabled;
      if (
        ['docs_only', 'docs_and_agent_memory', 'docs_and_selected_folders', 'full_personal_memory'].includes(
          String(body.permissionMode),
        )
      ) {
        patch.permissionMode = body.permissionMode;
      }
      if (Array.isArray(body.allowedFolderIds)) {
        patch.allowedFolderIds = body.allowedFolderIds.map(Number).filter(Number.isFinite).slice(0, 50);
      }
      if (typeof body.isArchived === 'boolean') patch.isArchived = body.isArchived;

      await updateSubdoc(uid, 'agents', String(id), patch);
      const updated = await getSubdoc<StoredAgent>(uid, 'agents', String(id));
      if (!updated) throw new Error('Agente no encontrado.');
      return updated as T;
    }
    if (method === 'DELETE') {
      await updateSubdoc(uid, 'agents', String(id), { deletedAt: new Date().toISOString() });
      return { ok: true } as T;
    }
  }

  // ---- ACTIONS LOG & TRASH ----
  if (pathname === '/api/actions' && method === 'GET') {
    const rows = (await listSubcollection<ActionLogItem>(uid, 'actionsLog'))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 50);
    return rows as T;
  }

  if (pathname === '/api/trash' && method === 'GET') {
    const [projs, mems, fls, tsks, evts, notes, memEvts] = await Promise.all([
      listSubcollection<StoredProject>(uid, 'projects'),
      listSubcollection<StoredMemory>(uid, 'memories'),
      listSubcollection<StoredFile>(uid, 'files'),
      listSubcollection<StoredTask>(uid, 'tasks'),
      listSubcollection<StoredEvent>(uid, 'calendarEvents'),
      listSubcollection<StoredNote>(uid, 'notes'),
      listSubcollection<StoredMemoryEvent>(uid, 'memoryEvents'),
    ]);
    return {
      projects: projs.filter((x) => Boolean(x.deletedAt)),
      memories: mems
        .filter((x) => Boolean(x.deletedAt))
        .map((m) => ({ id: m.id, title: m.title, content: m.content, deletedAt: m.deletedAt })),
      files: fls
        .filter((x) => Boolean(x.deletedAt))
        .map((f) => ({ id: f.id, displayName: f.displayName, deletedAt: f.deletedAt })),
      tasks: tsks.filter((x) => Boolean(x.deletedAt)),
      events: evts.filter((x) => Boolean(x.deletedAt)),
      notes: notes
        .filter((x) => Boolean(x.deletedAt))
        .map((n) => ({ id: n.id, title: n.title, content: n.content.slice(0, 140), deletedAt: n.deletedAt })),
      memoryEvents: memEvts
        .filter((x) => Boolean(x.deletedAt))
        .map((e) => ({ id: e.id, title: e.title, category: e.category, deletedAt: e.deletedAt })),
    } as T;
  }

  if (pathname === '/api/trash/restore' && method === 'POST') {
    const type = String(body.type || '');
    const id = String(body.id || '');
    const subMap: Record<string, string> = {
      project: 'projects',
      memory: 'memories',
      file: 'files',
      task: 'tasks',
      event: 'calendarEvents',
      note: 'notes',
      memory_event: 'memoryEvents',
    };
    const sub = subMap[type];
    if (!sub || !id) throw new Error('Tipo o ID inválido.');
    await updateSubdoc(uid, sub, id, { deletedAt: null });
    return { ok: true } as T;
  }

  if (pathname === '/api/trash/purge' && method === 'DELETE') {
    const type = String(body.type || '');
    const id = String(body.id || '');
    if (type === 'file') {
      const f = await getSubdoc<StoredFile>(uid, 'files', id);
      if (f?.storagePath) {
        await callServerEndpoint('/api/files/blob', 'DELETE', { storagePath: f.storagePath }).catch(() => {});
      }
      await deleteSubdoc(uid, 'files', id);
      return { ok: true } as T;
    }
    const subMap: Record<string, string> = {
      project: 'projects',
      memory: 'memories',
      task: 'tasks',
      event: 'calendarEvents',
      note: 'notes',
      memory_event: 'memoryEvents',
    };
    const sub = subMap[type];
    if (!sub || !id) throw new Error('Tipo o ID inválido.');
    await deleteSubdoc(uid, sub, id);
    return { ok: true } as T;
  }

  throw new Error(`Ruta no soportada: ${method} ${pathname}`);
}

export async function getPrivateFileDownloadInfo(
  fileId: number,
): Promise<{ storagePath: string; mimeType: string; displayName: string }> {
  const uid = await ensureBootstrapped();
  const f = await getSubdoc<StoredFile>(uid, 'files', String(fileId));
  if (!f || f.deletedAt) throw new Error('Archivo no encontrado.');
  return {
    storagePath: f.storagePath,
    mimeType: f.mimeType,
    displayName: f.displayName,
  };
}
