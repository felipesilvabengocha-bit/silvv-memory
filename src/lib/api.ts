import { auth } from './firebase';
import { dispatchSilvvRequest, getPrivateFileDownloadInfo } from './silvvStore';

export const DEFAULT_MEMORY_EVENT_CATEGORIES = [
  'Vida personal',
  'Relaciones y amistades',
  'Familia',
  'Estudios',
  'Política',
  'Trabajo',
  'Proyectos',
  'Experiencias',
  'Ideas',
  'Otros',
];

export interface UserProfile {
  id: number;
  uid: string;
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
  language: string;
  timezone: string;
}

export interface UserPreferences {
  userUid: string;
  theme: 'dark' | 'light' | 'system';
  accentColor: string;
  uiDensity: 'comfortable' | 'compact';
  autonomyLevel: 'manual' | 'balanced' | 'proactive';
  autoCreateCalendarEvents: boolean;
  autoClassifyThreshold: number;
  proactiveNotificationsEnabled: boolean;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  disabledMemoryCategories: string[];
  customEventCategories?: string[];
}

export interface GoogleCalendarIntegration {
  id: number;
  provider: string;
  status: string;
  accountEmail: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
}

export interface FolderItem {
  id: number;
  parentId: number | null;
  name: string;
  slug: string;
  category: string | null;
  description: string | null;
  isSystem: boolean;
  autoCreated: boolean;
  createdAt: string;
  updatedAt?: string;
}

export interface ProjectObjective {
  id: string;
  title: string;
  done: boolean;
}

export interface ProjectItem {
  id: number;
  folderId: number | null;
  name: string;
  description: string | null;
  category: string | null;
  objectives: ProjectObjective[];
  status: 'idea' | 'active' | 'paused' | 'completed' | 'archived';
  progressPercent: number;
  targetDate: string | null;
  isPriority: boolean;
  autoCreated: boolean;
  lastActivityAt: string;
  createdAt: string;
}

export interface MemoryItem {
  id: number;
  memoryLayer: 'episodic' | 'semantic' | 'project' | 'temporal';
  originKind: string;
  category: string;
  title: string | null;
  content: string;
  tags: string[];
  importance: number;
  confidence: number;
  isActive: boolean;
  projectId: number | null;
  folderId: number | null;
  sourceType: string;
  sourceConversationId?: number | null;
  sourceMessageId?: number | null;
  sourceFileId?: number | null;
  createdAt: string;
}

export interface MemoryDetailResponse {
  memory: MemoryItem;
  sourceMessage: {
    id: number;
    conversationId: number;
    content: string;
    createdAt: string;
    attachments?: MessageAttachment[];
  } | null;
  sourceFile: {
    id: number;
    displayName: string;
    mimeType: string;
    fileKind: FileItem['fileKind'];
    aiSummary: string | null;
  } | null;
  entities: Array<{ relationType: string; entityName: string | null; entityType: string | null }>;
}

export interface FileItem {
  id: number;
  folderId: number | null;
  projectId: number | null;
  originalName: string;
  displayName: string;
  mimeType: string;
  sizeBytes: number;
  fileKind: 'image' | 'pdf' | 'document' | 'audio' | 'link' | 'other';
  extractedText: string | null;
  aiSummary: string | null;
  detectedCategory: string | null;
  classificationConfidence: number | null;
  processingStatus: string;
  errorMessage: string | null;
  createdAt: string;
}

export interface TaskItem {
  id: number;
  projectId: number | null;
  title: string;
  description: string | null;
  kind: 'task' | 'deadline' | 'reminder';
  status: 'pending' | 'in_progress' | 'done' | 'cancelled';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  dueAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface CalendarEventItem {
  id: number;
  projectId: number | null;
  externalProvider: string;
  externalEventId?: string | null;
  title: string;
  description: string | null;
  category: string | null;
  location: string | null;
  startAt: string;
  endAt: string;
  allDay: boolean;
  timezone: string;
  syncStatus: string;
  linkedMemoryEventId?: number | null;
}

export interface NoteFolderItem {
  id: number;
  parentId: number | null;
  name: string;
  color: string | null;
  createdAt: string;
  updatedAt?: string;
}

export interface NoteAttachment {
  id: number;
  fileId: number | null;
  fileName: string;
  mimeType: string;
  fileKind: 'image' | 'pdf' | 'document' | 'audio' | 'other';
  sizeBytes: number;
  storagePath: string;
}

export interface NoteItem {
  id: number;
  folderId: number | null;
  projectId: number | null;
  title: string;
  content: string;
  tags: string[];
  isQuick: boolean;
  isPinned: boolean;
  isArchived: boolean;
  attachments: NoteAttachment[];
  sourceConversationId: number | null;
  sourceMessageId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface NoteOrganization {
  title: string;
  category: 'Estudios' | 'Vida diaria';
  subfolderName: string;
  tags: string[];
}

export interface MemoryEventItem {
  id: number;
  title: string;
  description: string;
  eventDate: string | null;
  datePrecision: 'exact' | 'day' | 'approximate' | 'unknown';
  dateLabel: string | null;
  category: string;
  people: string[];
  projectId: number | null;
  sourceConversationId: number | null;
  sourceMessageId: number | null;
  sourceMessageText: string | null;
  relatedFileIds: number[];
  relatedNoteIds: number[];
  tags: string[];
  importance: number;
  createdAt: string;
  updatedAt?: string;
}

export interface PersonEntityItem {
  id: number;
  name: string;
  normalizedName: string;
  relationship: string | null;
  notes: string | null;
  mentionCount: number;
  lastMentionedAt: string | null;
  createdAt: string;
}

export interface EventRelationItem {
  id: number;
  sourceEventId: number;
  targetType: 'memory_event' | 'person' | 'project' | 'note' | 'file' | 'calendar_event';
  targetId: number;
  targetLabel: string;
  relationKind: string;
  createdAt: string;
}

export interface SummaryRecordItem {
  id: number;
  periodKind: 'daily' | 'weekly' | 'monthly';
  periodKey: string;
  periodStart: string;
  periodEnd: string;
  title: string;
  narrative: string;
  sections: Record<string, string>;
  generatedMode: 'auto' | 'manual';
  savedNoteId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface SummarySourceItem {
  id: number;
  summaryKind: 'daily' | 'weekly' | 'monthly';
  summaryId: number;
  sourceType: string;
  sourceId: number;
  title: string;
  excerpt: string;
  sourceDate: string | null;
  createdAt: string;
}

export interface ActionLogItem {
  id: number;
  toolName: string;
  status: 'requested' | 'confirmed' | 'executed' | 'failed' | 'rejected';
  inputPayload: Record<string, unknown>;
  outputPayload: Record<string, unknown>;
  errorMessage: string | null;
  requiresConfirmation: boolean;
  confirmedByUser: boolean;
  createdAt: string;
}

export interface ConversationItem {
  id: number;
  projectId: number | null;
  title: string;
  contextSummary: string | null;
  isArchived: boolean;
  lastMessageAt: string;
}

export interface MessageAttachment {
  id: number;
  fileId: number | null;
  attachmentType: string;
  externalUrl: string | null;
  fileName: string | null;
  mimeType: string | null;
  aiSummary: string | null;
  detectedCategory: string | null;
}

export interface ProposedActionCard {
  actionLogId: number;
  toolName: string;
  status: 'executed' | 'requested' | 'rejected';
  summary: string;
  payload: Record<string, unknown>;
}

export interface MessageItem {
  id: number;
  conversationId: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
  processingStatus: string;
  errorMessage: string | null;
  editedAt?: string | null;
  metadata: {
    classifications?: string[];
    detectedCategory?: string;
    classificationConfidence?: number;
    suggestedFolderName?: string;
    savedMemories?: Array<{
      id: number;
      title: string | null;
      content: string;
      category: string;
      layer: string;
      originKind?: string;
    }>;
    createdNotes?: Array<{
      id: number;
      title: string;
      isQuick: boolean;
    }>;
    createdMemoryEvents?: Array<{
      id: number;
      title: string;
      category: string;
      dateLabel: string | null;
      people: string[];
    }>;
    actions?: ProposedActionCard[];
    linkUrl?: string;
  };
  attachments?: MessageAttachment[];
  createdAt: string;
}

export interface KnowledgeConversation {
  id: number;
  title: string;
  deepMode: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeCitation {
  sourceType: 'memory' | 'file' | 'message' | 'project' | 'note' | 'memory_event';
  sourceId: number;
  title: string;
  excerpt: string;
}

export interface KnowledgeMessage {
  id: number;
  conversationId: number;
  role: 'user' | 'assistant';
  content: string;
  deepMode: boolean;
  citations: KnowledgeCitation[];
  metadata?: {
    insufficientData?: boolean;
    inspectedSources?: number;
  };
  createdAt: string;
}

export type AgentPermissionMode =
  | 'docs_only'
  | 'docs_and_agent_memory'
  | 'docs_and_selected_folders'
  | 'full_personal_memory';

export interface AgentItem {
  id: number;
  name: string;
  description: string | null;
  icon: string;
  instructions: string;
  personality: string;
  objective: string | null;
  responseStyle: string;
  depthLevel: 'concise' | 'balanced' | 'deep';
  toolsEnabled: string[];
  memoryEnabled: boolean;
  permissionMode: AgentPermissionMode;
  allowedFolderIds: number[];
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AgentKnowledgeSource {
  id: number;
  agentId: number;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  aiSummary: string | null;
  extractedText: string | null;
  createdAt: string;
}

export interface AgentConversation {
  id: number;
  agentId: number;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentMessage {
  id: number;
  conversationId: number;
  agentId: number;
  role: 'user' | 'assistant';
  content: string;
  citations: Array<{ sourceType: string; sourceId: number; title: string; excerpt: string }>;
  createdAt: string;
}

export interface AgentMemory {
  id: number;
  agentId: number;
  content: string;
  category: string;
  createdAt: string;
}

export interface DashboardData {
  upcomingEvents: CalendarEventItem[];
  pendingTasks: TaskItem[];
  activeProjects: ProjectItem[];
  recentMemories: MemoryItem[];
  recentFiles: FileItem[];
  folders: FolderItem[];
  recentConversations: ConversationItem[];
  createdAgents: AgentItem[];
  recentNotes: NoteItem[];
  recentNoteFolders: NoteFolderItem[];
  recentMemoryEvents: MemoryEventItem[];
  latestDailySummary: SummaryRecordItem | null;
  latestWeeklySummary: SummaryRecordItem | null;
  unreadNotifications: Array<{ id: number; kind: string; title: string; body: string; createdAt: string }>;
  recentActions: ActionLogItem[];
}

export interface SearchHit {
  type: 'memory' | 'file' | 'project' | 'task' | 'event' | 'message' | 'note' | 'memory_event';
  id: number;
  title: string;
  subtitle: string;
  snippet: string;
  score: number;
  createdAt: string;
}

export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  return dispatchSilvvRequest<T>(path, options);
}

export async function fetchPrivateFileBlobUrl(fileId: number): Promise<string> {
  const user = auth.currentUser;
  if (!user) throw new Error('No hay sesión activa.');
  const info = await getPrivateFileDownloadInfo(fileId);
  const token = await user.getIdToken();
  const params = new URLSearchParams({
    storagePath: info.storagePath,
    mimeType: info.mimeType,
    displayName: info.displayName,
  });
  const response = await fetch(`/api/files/download?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error('No se pudo descargar el archivo.');
  }
  const blob = await response.blob();
  return URL.createObjectURL(blob);
}

export async function fetchPrivateStorageBlobUrl(params: {
  storagePath: string;
  mimeType: string;
  displayName: string;
}): Promise<string> {
  const user = auth.currentUser;
  if (!user) throw new Error('No hay sesión activa.');
  const token = await user.getIdToken();
  const q = new URLSearchParams({
    storagePath: params.storagePath,
    mimeType: params.mimeType,
    displayName: params.displayName,
  });
  const response = await fetch(`/api/files/download?${q.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error('No se pudo descargar el adjunto.');
  }
  const blob = await response.blob();
  return URL.createObjectURL(blob);
}
