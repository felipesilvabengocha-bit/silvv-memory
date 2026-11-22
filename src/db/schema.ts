import {
  boolean,
  integer,
  jsonb,
  pgTable,
  real,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  email: text('email').notNull(),
  fullName: text('full_name'),
  avatarUrl: text('avatar_url'),
  language: text('language').notNull().default('es-UY'),
  timezone: text('timezone').notNull().default('America/Montevideo'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const userPreferences = pgTable('user_preferences', {
  userUid: text('user_uid')
    .primaryKey()
    .references(() => users.uid, { onDelete: 'cascade' }),
  theme: text('theme').notNull().default('dark'),
  accentColor: text('accent_color').notNull().default('violet'),
  uiDensity: text('ui_density').notNull().default('comfortable'),
  autonomyLevel: text('autonomy_level').notNull().default('balanced'),
  autoCreateCalendarEvents: boolean('auto_create_calendar_events').notNull().default(false),
  autoClassifyThreshold: real('auto_classify_threshold').notNull().default(0.8),
  proactiveNotificationsEnabled: boolean('proactive_notifications_enabled').notNull().default(true),
  quietHoursStart: text('quiet_hours_start').default('22:00'),
  quietHoursEnd: text('quiet_hours_end').default('08:00'),
  disabledMemoryCategories: jsonb('disabled_memory_categories').$type<string[]>().notNull().default([]),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const folders = pgTable('folders', {
  id: serial('id').primaryKey(),
  userUid: text('user_uid')
    .notNull()
    .references(() => users.uid, { onDelete: 'cascade' }),
  parentId: integer('parent_id'),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  category: text('category'),
  description: text('description'),
  isSystem: boolean('is_system').notNull().default(false),
  autoCreated: boolean('auto_created').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
});

export const projects = pgTable('projects', {
  id: serial('id').primaryKey(),
  userUid: text('user_uid')
    .notNull()
    .references(() => users.uid, { onDelete: 'cascade' }),
  folderId: integer('folder_id').references(() => folders.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  description: text('description'),
  category: text('category').default('General'),
  objectives: jsonb('objectives').$type<Array<{ id: string; title: string; done: boolean }>>().notNull().default([]),
  status: text('status').notNull().default('active'),
  progressPercent: integer('progress_percent').notNull().default(0),
  targetDate: text('target_date'),
  isPriority: boolean('is_priority').notNull().default(false),
  autoCreated: boolean('auto_created').notNull().default(false),
  lastActivityAt: timestamp('last_activity_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
});

export const conversations = pgTable('conversations', {
  id: serial('id').primaryKey(),
  userUid: text('user_uid')
    .notNull()
    .references(() => users.uid, { onDelete: 'cascade' }),
  projectId: integer('project_id').references(() => projects.id, { onDelete: 'set null' }),
  title: text('title').notNull().default('Conversación general'),
  contextSummary: text('context_summary'),
  isArchived: boolean('is_archived').notNull().default(false),
  lastMessageAt: timestamp('last_message_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
});

export const messages = pgTable('messages', {
  id: serial('id').primaryKey(),
  userUid: text('user_uid')
    .notNull()
    .references(() => users.uid, { onDelete: 'cascade' }),
  conversationId: integer('conversation_id')
    .notNull()
    .references(() => conversations.id, { onDelete: 'cascade' }),
  role: text('role').notNull(),
  content: text('content').notNull().default(''),
  processingStatus: text('processing_status').notNull().default('received'),
  errorMessage: text('error_message'),
  editedAt: timestamp('edited_at'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
});

export const files = pgTable('files', {
  id: serial('id').primaryKey(),
  userUid: text('user_uid')
    .notNull()
    .references(() => users.uid, { onDelete: 'cascade' }),
  folderId: integer('folder_id').references(() => folders.id, { onDelete: 'set null' }),
  projectId: integer('project_id').references(() => projects.id, { onDelete: 'set null' }),
  storagePath: text('storage_path').notNull(),
  originalName: text('original_name').notNull(),
  displayName: text('display_name').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: integer('size_bytes').notNull().default(0),
  fileKind: text('file_kind').notNull().default('other'),
  sourceUrl: text('source_url'),
  extractedText: text('extracted_text'),
  aiSummary: text('ai_summary'),
  detectedCategory: text('detected_category'),
  classificationConfidence: real('classification_confidence'),
  processingStatus: text('processing_status').notNull().default('received'),
  errorMessage: text('error_message'),
  embedding: jsonb('embedding').$type<number[] | null>(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
});

export const attachments = pgTable('attachments', {
  id: serial('id').primaryKey(),
  userUid: text('user_uid')
    .notNull()
    .references(() => users.uid, { onDelete: 'cascade' }),
  messageId: integer('message_id')
    .notNull()
    .references(() => messages.id, { onDelete: 'cascade' }),
  fileId: integer('file_id').references(() => files.id, { onDelete: 'set null' }),
  attachmentType: text('attachment_type').notNull(),
  externalUrl: text('external_url'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const memories = pgTable('memories', {
  id: serial('id').primaryKey(),
  userUid: text('user_uid')
    .notNull()
    .references(() => users.uid, { onDelete: 'cascade' }),
  memoryLayer: text('memory_layer').notNull(), // episodic | semantic | project | temporal
  category: text('category').notNull().default('General'),
  originKind: text('origin_kind').notNull().default('fact'), // fact | preference | opinion | idea | decision | commitment | academic | professional | temporal
  title: text('title'),
  content: text('content').notNull(),
  tags: jsonb('tags').$type<string[]>().notNull().default([]),
  importance: integer('importance').notNull().default(3),
  confidence: real('confidence').notNull().default(0.9),
  isActive: boolean('is_active').notNull().default(true),
  projectId: integer('project_id').references(() => projects.id, { onDelete: 'set null' }),
  folderId: integer('folder_id').references(() => folders.id, { onDelete: 'set null' }),
  sourceType: text('source_type').notNull().default('message'),
  sourceConversationId: integer('source_conversation_id').references(() => conversations.id, { onDelete: 'set null' }),
  sourceMessageId: integer('source_message_id').references(() => messages.id, { onDelete: 'set null' }),
  sourceFileId: integer('source_file_id').references(() => files.id, { onDelete: 'set null' }),
  occurredAt: timestamp('occurred_at'),
  expiresAt: timestamp('expires_at'),
  embedding: jsonb('embedding').$type<number[] | null>(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
});

export const entities = pgTable('entities', {
  id: serial('id').primaryKey(),
  userUid: text('user_uid')
    .notNull()
    .references(() => users.uid, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  entityType: text('entity_type').notNull().default('concept'),
  description: text('description'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const memoryRelations = pgTable('memory_relations', {
  id: serial('id').primaryKey(),
  userUid: text('user_uid')
    .notNull()
    .references(() => users.uid, { onDelete: 'cascade' }),
  sourceMemoryId: integer('source_memory_id')
    .notNull()
    .references(() => memories.id, { onDelete: 'cascade' }),
  targetMemoryId: integer('target_memory_id').references(() => memories.id, { onDelete: 'cascade' }),
  targetEntityId: integer('target_entity_id').references(() => entities.id, { onDelete: 'cascade' }),
  relationType: text('relation_type').notNull(),
  strength: real('strength').notNull().default(0.8),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const tasks = pgTable('tasks', {
  id: serial('id').primaryKey(),
  userUid: text('user_uid')
    .notNull()
    .references(() => users.uid, { onDelete: 'cascade' }),
  projectId: integer('project_id').references(() => projects.id, { onDelete: 'set null' }),
  title: text('title').notNull(),
  description: text('description'),
  kind: text('kind').notNull().default('task'),
  status: text('status').notNull().default('pending'),
  priority: text('priority').notNull().default('medium'),
  dueAt: timestamp('due_at'),
  remindAt: timestamp('remind_at'),
  completedAt: timestamp('completed_at'),
  sourceMessageId: integer('source_message_id').references(() => messages.id, { onDelete: 'set null' }),
  sourceFileId: integer('source_file_id').references(() => files.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
});

export const calendarEvents = pgTable('calendar_events', {
  id: serial('id').primaryKey(),
  userUid: text('user_uid')
    .notNull()
    .references(() => users.uid, { onDelete: 'cascade' }),
  projectId: integer('project_id').references(() => projects.id, { onDelete: 'set null' }),
  externalProvider: text('external_provider').notNull().default('local'),
  externalEventId: text('external_event_id'),
  title: text('title').notNull(),
  description: text('description'),
  category: text('category').default('Agenda'),
  location: text('location'),
  startAt: timestamp('start_at').notNull(),
  endAt: timestamp('end_at').notNull(),
  allDay: boolean('all_day').notNull().default(false),
  timezone: text('timezone').notNull().default('America/Montevideo'),
  syncStatus: text('sync_status').notNull().default('local_only'),
  sourceMessageId: integer('source_message_id').references(() => messages.id, { onDelete: 'set null' }),
  sourceFileId: integer('source_file_id').references(() => files.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
});

export const integrations = pgTable('integrations', {
  id: serial('id').primaryKey(),
  userUid: text('user_uid')
    .notNull()
    .references(() => users.uid, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),
  status: text('status').notNull().default('disconnected'),
  accountEmail: text('account_email'),
  lastSyncedAt: timestamp('last_synced_at'),
  lastError: text('last_error'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Knowledge Chat (Section 5 — Independent from General Chat)
export const knowledgeConversations = pgTable('knowledge_conversations', {
  id: serial('id').primaryKey(),
  userUid: text('user_uid')
    .notNull()
    .references(() => users.uid, { onDelete: 'cascade' }),
  title: text('title').notNull().default('Investigación personal'),
  deepMode: boolean('deep_mode').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
});

export const knowledgeMessages = pgTable('knowledge_messages', {
  id: serial('id').primaryKey(),
  userUid: text('user_uid')
    .notNull()
    .references(() => users.uid, { onDelete: 'cascade' }),
  conversationId: integer('conversation_id')
    .notNull()
    .references(() => knowledgeConversations.id, { onDelete: 'cascade' }),
  role: text('role').notNull(),
  content: text('content').notNull(),
  deepMode: boolean('deep_mode').notNull().default(false),
  citations: jsonb('citations')
    .$type<
      Array<{
        sourceType: 'memory' | 'file' | 'message' | 'project';
        sourceId: number;
        title: string;
        excerpt: string;
        date: string;
      }>
    >()
    .notNull()
    .default([]),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Custom Agents (Section 6 — Isolated Knowledge Bases & Permissions)
export const agents = pgTable('agents', {
  id: serial('id').primaryKey(),
  userUid: text('user_uid')
    .notNull()
    .references(() => users.uid, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  icon: text('icon').notNull().default('bot'),
  instructions: text('instructions').notNull().default(''),
  personality: text('personality').default('Analítico, claro y estructurado'),
  objective: text('objective'),
  responseStyle: text('response_style').default('Profesional y directo'),
  depthLevel: text('depth_level').notNull().default('balanced'), // concise | balanced | deep
  toolsEnabled: jsonb('tools_enabled').$type<string[]>().notNull().default(['search_agent_knowledge']),
  memoryEnabled: boolean('memory_enabled').notNull().default(true),
  permissionMode: text('permission_mode').notNull().default('docs_only'), // docs_only | docs_and_agent_memory | docs_and_selected_folders | full_personal_memory
  allowedFolderIds: jsonb('allowed_folder_ids').$type<number[]>().notNull().default([]),
  modelName: text('model_name').notNull().default('gemini-4-hydrogen'),
  isArchived: boolean('is_archived').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
});

export const agentKnowledgeSources = pgTable('agent_knowledge_sources', {
  id: serial('id').primaryKey(),
  userUid: text('user_uid')
    .notNull()
    .references(() => users.uid, { onDelete: 'cascade' }),
  agentId: integer('agent_id')
    .notNull()
    .references(() => agents.id, { onDelete: 'cascade' }),
  fileName: text('file_name').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: integer('size_bytes').notNull().default(0),
  storagePath: text('storage_path').notNull(),
  extractedText: text('extracted_text'),
  aiSummary: text('ai_summary'),
  embedding: jsonb('embedding').$type<number[] | null>(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const agentConversations = pgTable('agent_conversations', {
  id: serial('id').primaryKey(),
  userUid: text('user_uid')
    .notNull()
    .references(() => users.uid, { onDelete: 'cascade' }),
  agentId: integer('agent_id')
    .notNull()
    .references(() => agents.id, { onDelete: 'cascade' }),
  title: text('title').notNull().default('Sesión con agente'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
});

export const agentMessages = pgTable('agent_messages', {
  id: serial('id').primaryKey(),
  userUid: text('user_uid')
    .notNull()
    .references(() => users.uid, { onDelete: 'cascade' }),
  conversationId: integer('conversation_id')
    .notNull()
    .references(() => agentConversations.id, { onDelete: 'cascade' }),
  agentId: integer('agent_id')
    .notNull()
    .references(() => agents.id, { onDelete: 'cascade' }),
  role: text('role').notNull(),
  content: text('content').notNull(),
  citations: jsonb('citations')
    .$type<Array<{ sourceType: string; sourceId: number; title: string; excerpt: string }>>()
    .notNull()
    .default([]),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const agentMemories = pgTable('agent_memories', {
  id: serial('id').primaryKey(),
  userUid: text('user_uid')
    .notNull()
    .references(() => users.uid, { onDelete: 'cascade' }),
  agentId: integer('agent_id')
    .notNull()
    .references(() => agents.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  category: text('category').notNull().default('Agente'),
  importance: integer('importance').notNull().default(3),
  embedding: jsonb('embedding').$type<number[] | null>(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const notifications = pgTable('notifications', {
  id: serial('id').primaryKey(),
  userUid: text('user_uid')
    .notNull()
    .references(() => users.uid, { onDelete: 'cascade' }),
  kind: text('kind').notNull().default('proactive_suggestion'),
  title: text('title').notNull(),
  body: text('body').notNull(),
  relatedProjectId: integer('related_project_id').references(() => projects.id, { onDelete: 'set null' }),
  isRead: boolean('is_read').notNull().default(false),
  readAt: timestamp('read_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const actionsLog = pgTable('actions_log', {
  id: serial('id').primaryKey(),
  userUid: text('user_uid')
    .notNull()
    .references(() => users.uid, { onDelete: 'cascade' }),
  toolName: text('tool_name').notNull(),
  status: text('status').notNull().default('executed'),
  inputPayload: jsonb('input_payload').$type<Record<string, unknown>>().notNull().default({}),
  outputPayload: jsonb('output_payload').$type<Record<string, unknown>>().notNull().default({}),
  errorMessage: text('error_message'),
  requiresConfirmation: boolean('requires_confirmation').notNull().default(false),
  confirmedByUser: boolean('confirmed_by_user').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
