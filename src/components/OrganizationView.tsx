import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Brain, FolderOpen, Search, StickyNote, Users, X } from 'lucide-react';
import {
  apiRequest,
  type CalendarEventItem,
  type MemoryEventItem,
  type MemoryItem,
  type NoteFolderItem,
  type NoteItem,
  type PersonEntityItem,
  type SmartFolderItem,
} from '../lib/api';
import { MemoryView } from './MemoryView';
import { NotesView } from './NotesView';
import { PeopleView } from './PeopleView';

export type OrganizationCategory = 'notes' | 'memories' | 'people';

type OrganizationSnapshot = {
  folders: SmartFolderItem[];
  noteFolders: NoteFolderItem[];
  notes: NoteItem[];
  memories: MemoryItem[];
  people: PersonEntityItem[];
  memoryEvents: MemoryEventItem[];
  calendarEvents: CalendarEventItem[];
};

type OrganizationRecord = {
  id: number;
  type: OrganizationCategory | 'memory_event' | 'calendar_event';
  title: string;
  excerpt: string;
  smartFolderIds: string[];
  category?: string | null;
  tags?: string[];
  entities?: string[];
};

interface OrganizationViewProps {
  isActive: boolean;
  activeCategory: OrganizationCategory;
  onCategoryChange: (category: OrganizationCategory) => void;
  onDataChanged: () => void;
  onGoToChat: () => void;
}

const CATEGORY_INFO: Array<{
  id: OrganizationCategory;
  label: string;
  description: string;
  icon: typeof StickyNote;
}> = [
  { id: 'notes', label: 'Notas', description: 'Apuntes e ideas', icon: StickyNote },
  { id: 'memories', label: 'Memorias', description: 'Recuerdos y temas', icon: Brain },
  { id: 'people', label: 'Personas', description: 'Perfiles y relaciones', icon: Users },
];

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export function OrganizationView({
  isActive,
  activeCategory,
  onCategoryChange,
  onDataChanged,
  onGoToChat,
}: OrganizationViewProps) {
  const [snapshot, setSnapshot] = useState<OrganizationSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selectedFolder, setSelectedFolder] = useState<SmartFolderItem | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await apiRequest<OrganizationSnapshot>('/api/organization');
      setSnapshot(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo cargar la organización inteligente.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isActive) void load();
  }, [isActive]);

  useEffect(() => {
    const handleRemoteChange = (event: Event) => {
      const collectionName = (event as CustomEvent<{ collectionName?: string }>).detail?.collectionName;
      if (isActive && [
        'notes', 'noteFolders', 'memories', 'peopleEntities', 'memoryEvents', 'calendarEvents', 'smartFolders',
      ].includes(collectionName || '')) {
        void load();
      }
    };
    window.addEventListener('silvv:organization-change', handleRemoteChange);
    return () => window.removeEventListener('silvv:organization-change', handleRemoteChange);
  }, [isActive]);

  const handleDataChanged = () => {
    void load();
    onDataChanged();
  };

  const records = useMemo<OrganizationRecord[]>(() => {
    if (!snapshot) return [];
    return [
      ...snapshot.notes.map((note) => ({
        id: note.id,
        type: 'notes' as const,
        title: note.title,
        excerpt: note.content,
        smartFolderIds: note.smartFolderIds || [],
        tags: note.tags,
      })),
      ...snapshot.memories.map((memory) => ({
        id: memory.id,
        type: 'memories' as const,
        title: memory.title || memory.category,
        excerpt: memory.content,
        category: memory.category,
        tags: memory.tags,
        entities: (memory as MemoryItem & { entities?: string[] }).entities || [],
        smartFolderIds: memory.smartFolderIds || [],
      })),
      ...snapshot.people.map((person) => ({
        id: person.id,
        type: 'people' as const,
        title: person.name,
        excerpt: [person.relationship, person.notes].filter(Boolean).join(' · '),
        smartFolderIds: person.smartFolderIds || [],
      })),
      ...snapshot.memoryEvents.map((event) => ({
        id: event.id,
        type: 'memory_event' as const,
        title: event.title,
        excerpt: event.description,
        category: event.category,
        tags: event.tags,
        entities: event.people,
        smartFolderIds: event.smartFolderIds || [],
      })),
      ...snapshot.calendarEvents.map((event) => ({
        id: event.id,
        type: 'calendar_event' as const,
        title: event.title,
        excerpt: event.description || '',
        category: event.category,
        smartFolderIds: event.smartFolderIds || [],
      })),
    ];
  }, [snapshot]);

  const isInFolder = (record: OrganizationRecord, folder: SmartFolderItem) => {
    if (record.smartFolderIds.includes(folder.id)) return true;
    if (folder.id.startsWith('person-')) return false;
    const folderName = normalize(folder.name);
    const relatedNames = [record.category || '', ...(record.tags || []), ...(record.entities || [])];
    if (relatedNames.some((name) => normalize(name) === folderName)) return true;
    if (record.type === 'notes') {
      const note = snapshot?.notes.find((item) => item.id === record.id);
      const legacyFolder = snapshot?.noteFolders.find((item) => item.id === note?.folderId);
      if (legacyFolder && normalize(legacyFolder.name) === folderName) return true;
    }
    return false;
  };

  const folderCounts = useMemo(() => {
    if (!snapshot) return new Map<string, number>();
    return new Map(snapshot.folders.map((folder) => [
      folder.id,
      records.filter((record) => isInFolder(record, folder)).length,
    ]));
  }, [records, snapshot]);

  const normalizedQuery = normalize(query);
  const matchingFolders = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.folders
      .filter((folder) => {
        if (!normalizedQuery) return true;
        if (normalize(folder.name).includes(normalizedQuery)) return true;
        return records.some((record) =>
          isInFolder(record, folder) &&
          `${record.title} ${record.excerpt} ${(record.tags || []).join(' ')}`.toLocaleLowerCase('es').includes(query.trim().toLocaleLowerCase('es')),
        );
      })
      .sort((a, b) => (folderCounts.get(b.id) || 0) - (folderCounts.get(a.id) || 0) || a.name.localeCompare(b.name));
  }, [snapshot, records, normalizedQuery, query, folderCounts]);

  const searchResults = useMemo(() => {
    if (!normalizedQuery) return [];
    return records
      .filter((record) =>
        `${record.title} ${record.excerpt} ${record.category || ''} ${(record.tags || []).join(' ')} ${(record.entities || []).join(' ')}`
          .toLocaleLowerCase('es')
          .includes(query.trim().toLocaleLowerCase('es')),
      )
      .slice(0, 8);
  }, [records, normalizedQuery, query]);

  const folderRecords = selectedFolder ? records.filter((record) => isInFolder(record, selectedFolder)) : [];
  const counts: Record<OrganizationCategory, number> = {
    notes: snapshot?.notes.length || 0,
    memories: snapshot?.memories.length || 0,
    people: snapshot?.people.length || 0,
  };

  return (
    <main className="space-y-6" aria-labelledby="organization-heading">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-violet-600 dark:text-violet-300">Tu segundo cerebro</p>
          <h1 id="organization-heading" className="font-display text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Organización inteligente
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-zinc-500 dark:text-zinc-400">
            Notas, memorias y personas conectadas por carpetas y referencias compartidas, sin duplicar registros.
          </p>
        </div>
        <div className="relative w-full sm:max-w-sm">
          <Search aria-hidden="true" className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
          <input
            type="search"
            aria-label="Buscar notas, memorias, personas y carpetas"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar en toda tu organización…"
            className="w-full rounded-xl border border-zinc-200/80 bg-white/70 py-2.5 pl-9 pr-3 text-sm text-zinc-900 shadow-sm outline-none transition focus:border-violet-500/50 focus:ring-2 focus:ring-violet-500/20 dark:border-white/10 dark:bg-black/25 dark:text-zinc-100"
          />
        </div>
      </header>

      {error && <p role="alert" className="rounded-xl border border-red-300 bg-red-50/80 p-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">{error}</p>}

      <section aria-labelledby="smart-folders-heading" className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 id="smart-folders-heading" className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Carpetas inteligentes</h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">Las mismas carpetas reúnen elementos relacionados de distintas secciones.</p>
          </div>
          <span className="rounded-full border border-zinc-200/70 px-2.5 py-1 text-xs tabular-nums text-zinc-500 dark:border-white/10 dark:text-zinc-400">
            {loading ? '…' : snapshot?.folders.length || 0}
          </span>
        </div>
        {loading && !snapshot ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
            {[0, 1, 2].map((item) => <div key={item} className="h-24 animate-pulse rounded-2xl bg-zinc-200/60 dark:bg-white/5" />)}
          </div>
        ) : matchingFolders.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-300/80 px-5 py-8 text-center text-sm text-zinc-500 dark:border-white/10 dark:text-zinc-400">
            {normalizedQuery ? 'No hay carpetas o elementos que coincidan con la búsqueda.' : 'Las carpetas aparecerán cuando SILVV clasifique información real.'}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
            {matchingFolders.slice(0, 15).map((folder, index) => (
              <motion.button
                key={folder.id}
                type="button"
                onClick={() => setSelectedFolder(folder)}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(index * 0.025, 0.2), duration: 0.22 }}
                className="group rounded-2xl border border-zinc-200/70 bg-white/55 p-3.5 text-left shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-violet-400/50 hover:bg-white/80 dark:border-white/10 dark:bg-white/[0.035] dark:hover:bg-white/[0.07]"
              >
                <span className="mb-3 flex size-9 items-center justify-center rounded-xl bg-violet-500/10 text-violet-700 transition-transform group-hover:scale-105 dark:text-violet-300">
                  <FolderOpen className="size-4" aria-hidden="true" />
                </span>
                <span className="block truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">{folder.name}</span>
                <span className="mt-1 block text-xs text-zinc-500 dark:text-zinc-400">{folderCounts.get(folder.id) || 0} elementos</span>
              </motion.button>
            ))}
          </div>
        )}
      </section>

      {searchResults.length > 0 && (
        <section aria-label="Resultados de búsqueda" className="rounded-2xl border border-violet-300/40 bg-violet-50/50 p-4 dark:border-violet-400/15 dark:bg-violet-500/[0.04]">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-300">Resultados en toda tu información</h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {searchResults.map((record) => {
              const category = record.type === 'notes' ? 'notes' : record.type === 'people' ? 'people' : 'memories';
              const label = record.type === 'memory_event' ? 'Acontecimiento' : record.type === 'calendar_event' ? 'Agenda' : category === 'notes' ? 'Nota' : category === 'people' ? 'Persona' : 'Memoria';
              return (
                <li key={`${record.type}:${record.id}`}>
                  <button type="button" onClick={() => onCategoryChange(category)} className="w-full rounded-xl bg-white/70 p-3 text-left transition-colors hover:bg-white dark:bg-black/20 dark:hover:bg-black/30">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-violet-600 dark:text-violet-300">{label}</span>
                    <span className="mt-0.5 block truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">{record.title}</span>
                    <span className="mt-0.5 block line-clamp-1 text-xs text-zinc-500 dark:text-zinc-400">{record.excerpt}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section aria-label="Secciones de organización" className="space-y-4">
        <div role="tablist" aria-label="Tipo de información" className="grid grid-cols-3 gap-2 rounded-2xl border border-zinc-200/70 bg-zinc-100/60 p-1.5 dark:border-white/10 dark:bg-white/[0.025]">
          {CATEGORY_INFO.map((item) => {
            const Icon = item.icon;
            const selected = activeCategory === item.id;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => onCategoryChange(item.id)}
                className={`flex min-w-0 items-center gap-2 rounded-xl px-3 py-2.5 text-left transition-all ${selected ? 'bg-white text-zinc-900 shadow-sm dark:bg-[#1E1E26] dark:text-zinc-100' : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200'}`}
              >
                <span className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${selected ? 'bg-violet-500/10 text-violet-700 dark:text-violet-300' : 'bg-zinc-200/70 text-zinc-500 dark:bg-white/5 dark:text-zinc-400'}`}>
                  <Icon className="size-4" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-semibold sm:text-sm">{item.label}</span>
                  <span className="hidden text-[11px] text-zinc-500 sm:block dark:text-zinc-400">{item.description}</span>
                </span>
                <span className="hidden rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] tabular-nums text-zinc-500 sm:block dark:bg-white/5 dark:text-zinc-400">{counts[item.id]}</span>
              </button>
            );
          })}
        </div>

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={activeCategory}
            role="tabpanel"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18 }}
          >
            {activeCategory === 'notes' && (
              <NotesView isActive={isActive} onDataChanged={handleDataChanged} onAskInChat={onGoToChat} showFolderTree={false} />
            )}
            {activeCategory === 'memories' && (
              <MemoryView onDataChanged={handleDataChanged} onGoToChat={onGoToChat} />
            )}
            {activeCategory === 'people' && (
              <PeopleView isActive={isActive} onDataChanged={handleDataChanged} />
            )}
          </motion.div>
        </AnimatePresence>
      </section>

      <AnimatePresence>
        {selectedFolder && (
          <motion.div
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 p-0 backdrop-blur-sm sm:items-center sm:p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setSelectedFolder(null)}
          >
            <motion.section
              role="dialog"
              aria-modal="true"
              aria-labelledby="smart-folder-detail-heading"
              initial={{ y: 24, opacity: 0, scale: 0.99 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: 18, opacity: 0, scale: 0.99 }}
              transition={{ type: 'spring', stiffness: 340, damping: 32 }}
              onClick={(event) => event.stopPropagation()}
              className="max-h-[85dvh] w-full max-w-2xl overflow-hidden rounded-t-3xl border border-zinc-200/70 bg-zinc-50 p-5 shadow-2xl dark:border-white/10 dark:bg-[#111114] sm:rounded-3xl sm:p-6"
            >
              <header className="mb-4 flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-violet-600 dark:text-violet-300">Carpeta compartida</p>
                  <h2 id="smart-folder-detail-heading" className="mt-1 truncate font-display text-xl font-semibold text-zinc-900 dark:text-zinc-100">{selectedFolder.name}</h2>
                  <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{folderRecords.length} elementos vinculados sin duplicar registros</p>
                </div>
                <button type="button" onClick={() => setSelectedFolder(null)} aria-label="Cerrar carpeta" className="rounded-xl p-2 text-zinc-500 hover:bg-zinc-200/70 dark:hover:bg-white/10">
                  <X className="size-4" />
                </button>
              </header>
              <ul className="max-h-[65dvh] overflow-y-auto divide-y divide-zinc-200/70 dark:divide-white/10">
                {folderRecords.length === 0 ? (
                  <li className="py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">No hay elementos visibles en esta carpeta.</li>
                ) : folderRecords.map((record) => {
                  const label = record.type === 'notes' ? 'Nota' : record.type === 'memories' ? 'Memoria' : record.type === 'people' ? 'Persona' : record.type === 'memory_event' ? 'Acontecimiento' : 'Agenda';
                  return (
                    <li key={`${record.type}:${record.id}`} className="py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-violet-600 dark:text-violet-300">{label}</p>
                          <p className="mt-0.5 text-sm font-medium text-zinc-900 dark:text-zinc-100">{record.title}</p>
                          {record.excerpt && <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">{record.excerpt}</p>}
                        </div>
                        <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-1 text-[10px] text-zinc-500 dark:bg-white/5 dark:text-zinc-400">{label}</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </motion.section>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}
