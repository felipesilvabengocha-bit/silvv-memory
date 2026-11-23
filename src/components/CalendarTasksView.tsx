import { useEffect, useMemo, useState } from 'react';
import {
  BookHeart,
  Calendar as CalendarIcon,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  Edit3,
  MessageSquareText,
  Plus,
  RefreshCw,
  Search,
  Tag,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import {
  apiRequest,
  DEFAULT_MEMORY_EVENT_CATEGORIES,
  type CalendarEventItem,
  type EventRelationItem,
  type GoogleCalendarIntegration,
  type MemoryEventItem,
  type PersonEntityItem,
  type ProjectItem,
  type TaskItem,
  type UserPreferences,
} from '../lib/api';
import { authorizeGoogleCalendarPopup, getGoogleAccessToken } from '../lib/firebase';

interface CalendarTasksViewProps {
  timezone: string;
  preferences: UserPreferences | null;
  googleIntegration: GoogleCalendarIntegration | null;
  projects?: ProjectItem[];
  onPreferencesUpdated: (prefs: UserPreferences) => void;
  onDataChanged: () => void;
}

interface ConfirmMutationState {
  action: 'create' | 'edit' | 'delete';
  title: string;
  description: string;
  eventId?: number;
  payload?: Record<string, unknown>;
}

type AgendaSpace = 'memoria' | 'real';
type MemoryViewMode = 'timeline' | 'month' | 'week' | 'day' | 'grouped';

export function CalendarTasksView({
  timezone,
  preferences,
  googleIntegration,
  projects = [],
  onPreferencesUpdated,
  onDataChanged,
}: CalendarTasksViewProps) {
  const [space, setSpace] = useState<AgendaSpace>('memoria');

  // Shared state
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // ---- AGENDA MEMORIA STATE ----
  const [memoryEvents, setMemoryEvents] = useState<MemoryEventItem[]>([]);
  const [people, setPeople] = useState<PersonEntityItem[]>([]);
  const [memViewMode, setMemViewMode] = useState<MemoryViewMode>('timeline');
  const [memSearch, setMemSearch] = useState('');
  const [memCategoryFilter, setMemCategoryFilter] = useState<string>('all');
  const [groupBy, setGroupBy] = useState<'person' | 'category' | 'project'>('person');
  const [anchorDate, setAnchorDate] = useState(() => new Date());

  const [showMemForm, setShowMemForm] = useState(false);
  const [editingMemId, setEditingMemId] = useState<number | null>(null);
  const [memTitle, setMemTitle] = useState('');
  const [memDesc, setMemDesc] = useState('');
  const [memDate, setMemDate] = useState('');
  const [memDateLabel, setMemDateLabel] = useState('');
  const [memPrecision, setMemPrecision] = useState<MemoryEventItem['datePrecision']>('day');
  const [memCat, setMemCat] = useState('Vida personal');
  const [memPeopleText, setMemPeopleText] = useState('');
  const [memProjectId, setMemProjectId] = useState<number | ''>('');
  const [linkedCalEventId, setLinkedCalEventId] = useState<number | null>(null);
  const [savingMem, setSavingMem] = useState(false);

  const [detailMemEvent, setDetailMemEvent] = useState<MemoryEventItem | null>(null);
  const [detailRelations, setDetailRelations] = useState<EventRelationItem[]>([]);

  const [showCatManager, setShowCatManager] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');

  // ---- AGENDA REAL + TASKS STATE ----
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [events, setEvents] = useState<CalendarEventItem[]>([]);
  const [taskFilter, setTaskFilter] = useState<'pending' | 'done' | 'all'>('pending');
  const [syncingGoogle, setSyncingGoogle] = useState(false);
  const [hasSessionGoogleToken, setHasSessionGoogleToken] = useState(
    Boolean(getGoogleAccessToken()),
  );

  const [taskTitle, setTaskTitle] = useState('');
  const [taskKind, setTaskKind] = useState<'task' | 'deadline' | 'reminder'>('task');
  const [taskPriority, setTaskPriority] = useState<'low' | 'medium' | 'high' | 'urgent'>('medium');
  const [taskDue, setTaskDue] = useState('');

  const [showEventForm, setShowEventForm] = useState(false);
  const [editingEventId, setEditingEventId] = useState<number | null>(null);
  const [evTitle, setEvTitle] = useState('');
  const [evLocation, setEvLocation] = useState('');
  const [evStart, setEvStart] = useState('');
  const [evEnd, setEvEnd] = useState('');
  const [evSyncGoogle, setEvSyncGoogle] = useState(Boolean(getGoogleAccessToken()));

  const [confirmModal, setConfirmModal] = useState<ConfirmMutationState | null>(null);
  const [executingConfirm, setExecutingConfirm] = useState(false);

  const categories = useMemo(() => {
    const custom = preferences?.customEventCategories || [];
    return custom.length > 0 ? custom : DEFAULT_MEMORY_EVENT_CATEGORIES;
  }, [preferences?.customEventCategories]);

  const loadAll = async () => {
    setLoading(true);
    setError(null);
    try {
      const [tRows, eRows, mRows, pRows] = await Promise.all([
        apiRequest<TaskItem[]>('/api/tasks'),
        apiRequest<CalendarEventItem[]>('/api/calendar'),
        apiRequest<MemoryEventItem[]>('/api/memory-events'),
        apiRequest<PersonEntityItem[]>('/api/people'),
      ]);
      setTasks(tRows);
      setEvents(eRows);
      setMemoryEvents(mRows);
      setPeople(pRows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar Agenda Inteligente.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  // ---- AGENDA MEMORIA HANDLERS ----
  const openCreateMemModal = (prefill?: {
    title?: string;
    description?: string;
    eventDate?: string;
    linkedCalendarEventId?: number;
  }) => {
    setEditingMemId(null);
    setMemTitle(prefill?.title || '');
    setMemDesc(prefill?.description || '');
    setMemDate(prefill?.eventDate ? prefill.eventDate.slice(0, 10) : '');
    setMemDateLabel('');
    setMemPrecision(prefill?.eventDate ? 'day' : 'day');
    setMemCat(categories[0] || 'Vida personal');
    setMemPeopleText('');
    setMemProjectId('');
    setLinkedCalEventId(prefill?.linkedCalendarEventId ?? null);
    setShowMemForm(true);
  };

  const openEditMemModal = (ev: MemoryEventItem) => {
    setEditingMemId(ev.id);
    setMemTitle(ev.title);
    setMemDesc(ev.description);
    setMemDate(ev.eventDate ? ev.eventDate.slice(0, 10) : '');
    setMemDateLabel(ev.dateLabel || '');
    setMemPrecision(ev.datePrecision);
    setMemCat(ev.category);
    setMemPeopleText((ev.people || []).join(', '));
    setMemProjectId(ev.projectId ?? '');
    setLinkedCalEventId(null);
    setShowMemForm(true);
  };

  const handleSaveMemoryEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!memTitle.trim() || !memDesc.trim()) return;
    setSavingMem(true);
    setError(null);
    try {
      const peopleArr = memPeopleText
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const isoDate =
        memPrecision === 'unknown' || !memDate.trim()
          ? null
          : `${memDate.trim()}T12:00:00.000Z`;

      const payload = {
        title: memTitle.trim(),
        description: memDesc.trim(),
        eventDate: isoDate,
        datePrecision: memPrecision,
        dateLabel: memDateLabel.trim() || (isoDate ? memDate.trim() : 'Sin fecha precisa'),
        category: memCat,
        people: peopleArr,
        projectId: memProjectId === '' ? null : Number(memProjectId),
        linkedCalendarEventId: linkedCalEventId ?? undefined,
      };

      if (editingMemId) {
        await apiRequest(`/api/memory-events/${editingMemId}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
      } else {
        await apiRequest('/api/memory-events', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }
      setShowMemForm(false);
      setEditingMemId(null);
      setLinkedCalEventId(null);
      await loadAll();
      onDataChanged();
      setNotice(
        linkedCalEventId
          ? 'Experiencia registrada en Agenda Memoria y vinculada al evento.'
          : 'Acontecimiento guardado en Agenda Memoria.',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar en Agenda Memoria.');
    } finally {
      setSavingMem(false);
    }
  };

  const handleDeleteMemoryEvent = async (id: number) => {
    try {
      await apiRequest(`/api/memory-events/${id}`, { method: 'DELETE' });
      setMemoryEvents((prev) => prev.filter((m) => m.id !== id));
      if (detailMemEvent?.id === id) setDetailMemEvent(null);
      onDataChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo eliminar.');
    }
  };

  const handleInspectMemoryEvent = async (ev: MemoryEventItem) => {
    setDetailMemEvent(ev);
    setDetailRelations([]);
    try {
      const rels = await apiRequest<EventRelationItem[]>(`/api/event-relations?eventId=${ev.id}`);
      setDetailRelations(rels);
    } catch {
      // non-fatal
    }
  };

  const handleAddCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newCategoryName.trim();
    if (!trimmed) return;
    if (categories.some((c) => c.toLowerCase() === trimmed.toLowerCase())) {
      setNewCategoryName('');
      return;
    }
    const nextCats = [...categories, trimmed];
    try {
      const res = await apiRequest<{ preferences: UserPreferences }>('/api/me', {
        method: 'PATCH',
        body: JSON.stringify({ customEventCategories: nextCats }),
      });
      onPreferencesUpdated(res.preferences);
      setNewCategoryName('');
      setNotice(`Categoría "${trimmed}" agregada.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo agregar la categoría.');
    }
  };

  const handleRemoveCategory = async (cat: string) => {
    if (categories.length <= 1) return;
    const nextCats = categories.filter((c) => c !== cat);
    try {
      const res = await apiRequest<{ preferences: UserPreferences }>('/api/me', {
        method: 'PATCH',
        body: JSON.stringify({ customEventCategories: nextCats }),
      });
      onPreferencesUpdated(res.preferences);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo quitar la categoría.');
    }
  };

  // ---- AGENDA REAL HANDLERS ----
  const handleConnectAndSyncGoogle = async () => {
    setSyncingGoogle(true);
    setError(null);
    setNotice(null);
    try {
      let token = getGoogleAccessToken();
      if (!token) token = await authorizeGoogleCalendarPopup();
      setHasSessionGoogleToken(Boolean(token));
      if (!token) throw new Error('No se obtuvo permiso de Google Calendar.');

      const res = await apiRequest<{ ok: boolean; importedCount: number; totalFetched: number }>(
        '/api/calendar/google/sync',
        { method: 'POST' },
      );
      setNotice(
        `Google Calendar sincronizado: ${res.totalFetched} eventos consultados (${res.importedCount} nuevos importados).`,
      );
      setEvSyncGoogle(true);
      await loadAll();
      onDataChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo sincronizar Google Calendar.');
    } finally {
      setSyncingGoogle(false);
    }
  };

  const handleChangeCalendarMode = async (mode: 'auto' | 'confirm' | 'manual') => {
    try {
      const body =
        mode === 'auto'
          ? { autonomyLevel: 'proactive', autoCreateCalendarEvents: true }
          : mode === 'confirm'
            ? { autonomyLevel: 'balanced', autoCreateCalendarEvents: false }
            : { autonomyLevel: 'manual', autoCreateCalendarEvents: false };

      const res = await apiRequest<{ preferences: UserPreferences }>('/api/me', {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      onPreferencesUpdated(res.preferences);
      setNotice('Modo de automatización de Agenda Real actualizado.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cambiar modo.');
    }
  };

  const currentCalendarMode: 'auto' | 'confirm' | 'manual' =
    preferences?.autonomyLevel === 'manual'
      ? 'manual'
      : preferences?.autonomyLevel === 'proactive' || preferences?.autoCreateCalendarEvents
        ? 'auto'
        : 'confirm';

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskTitle.trim()) return;
    try {
      await apiRequest('/api/tasks', {
        method: 'POST',
        body: JSON.stringify({
          title: taskTitle.trim(),
          kind: taskKind,
          priority: taskPriority,
          dueAt: taskDue ? new Date(taskDue).toISOString() : undefined,
        }),
      });
      setTaskTitle('');
      setTaskDue('');
      await loadAll();
      onDataChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al crear tarea.');
    }
  };

  const handleToggleTask = async (task: TaskItem) => {
    const nextStatus = task.status === 'done' ? 'pending' : 'done';
    try {
      const updated = await apiRequest<TaskItem>(`/api/tasks/${task.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: nextStatus }),
      });
      setTasks((prev) => prev.map((t) => (t.id === task.id ? updated : t)));
      onDataChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al actualizar tarea.');
    }
  };

  const handleDeleteTask = async (id: number) => {
    try {
      await apiRequest(`/api/tasks/${id}`, { method: 'DELETE' });
      setTasks((prev) => prev.filter((t) => t.id !== id));
      onDataChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al eliminar tarea.');
    }
  };

  const openEditEvent = (ev: CalendarEventItem) => {
    const toLocalInput = (iso: string) => {
      const d = new Date(iso);
      const pad = (n: number) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
        d.getHours(),
      )}:${pad(d.getMinutes())}`;
    };
    setEditingEventId(ev.id);
    setEvTitle(ev.title);
    setEvLocation(ev.location || '');
    setEvStart(toLocalInput(ev.startAt));
    setEvEnd(toLocalInput(ev.endAt));
    setEvSyncGoogle(ev.externalProvider === 'google' || Boolean(getGoogleAccessToken()));
    setShowEventForm(true);
  };

  const handleSubmitEventForm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!evTitle.trim() || !evStart) return;
    const payload = {
      title: evTitle.trim(),
      location: evLocation.trim() || undefined,
      startAt: new Date(evStart).toISOString(),
      endAt: evEnd ? new Date(evEnd).toISOString() : undefined,
      syncToGoogle: evSyncGoogle && Boolean(getGoogleAccessToken()),
    };

    if (evSyncGoogle && getGoogleAccessToken()) {
      setConfirmModal({
        action: editingEventId ? 'edit' : 'create',
        eventId: editingEventId || undefined,
        title: editingEventId
          ? 'Confirmar actualización en Google Calendar'
          : 'Confirmar creación en Google Calendar',
        description: `Se ${editingEventId ? 'actualizará' : 'creará'} "${evTitle.trim()}" en tu Google Calendar principal.`,
        payload,
      });
      return;
    }

    executeEventMutation(editingEventId ? 'edit' : 'create', editingEventId || undefined, payload);
  };

  const requestDeleteEvent = (ev: CalendarEventItem) => {
    if (ev.externalProvider === 'google' && getGoogleAccessToken()) {
      setConfirmModal({
        action: 'delete',
        eventId: ev.id,
        title: 'Confirmar eliminación en Google Calendar',
        description: `¿Seguro querés eliminar "${ev.title}" de SILVV MEMORY y de tu Google Calendar conectado?`,
      });
      return;
    }
    executeEventMutation('delete', ev.id);
  };

  const executeEventMutation = async (
    action: 'create' | 'edit' | 'delete',
    eventId?: number,
    payload?: Record<string, unknown>,
  ) => {
    setExecutingConfirm(true);
    setError(null);
    setNotice(null);
    try {
      if (action === 'create' && payload) {
        const res = await apiRequest<{
          event: CalendarEventItem;
          conflicts: CalendarEventItem[];
        }>('/api/calendar', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        if (res.conflicts && res.conflicts.length > 0) {
          setNotice(`Atención: este evento se superpone con "${res.conflicts[0].title}".`);
        }
      } else if (action === 'edit' && eventId && payload) {
        await apiRequest(`/api/calendar/${eventId}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
      } else if (action === 'delete' && eventId) {
        await apiRequest(`/api/calendar/${eventId}`, { method: 'DELETE' });
      }

      setShowEventForm(false);
      setEditingEventId(null);
      setEvTitle('');
      setEvLocation('');
      setEvStart('');
      setEvEnd('');
      setConfirmModal(null);
      await loadAll();
      onDataChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al procesar el evento.');
    } finally {
      setExecutingConfirm(false);
    }
  };

  const formatDate = (iso: string) => {
    try {
      return new Intl.DateTimeFormat('es-UY', {
        timeZone: timezone || 'America/Montevideo',
        weekday: 'short',
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(iso));
    } catch {
      return iso;
    }
  };

  const filteredMemoryEvents = useMemo(() => {
    const q = memSearch.trim().toLowerCase();
    return memoryEvents.filter((ev) => {
      if (memCategoryFilter !== 'all' && ev.category !== memCategoryFilter) return false;
      if (!q) return true;
      return (
        ev.title.toLowerCase().includes(q) ||
        ev.description.toLowerCase().includes(q) ||
        ev.category.toLowerCase().includes(q) ||
        (ev.people || []).some((p) => p.toLowerCase().includes(q)) ||
        (ev.dateLabel || '').toLowerCase().includes(q)
      );
    });
  }, [memoryEvents, memSearch, memCategoryFilter]);

  const monthGridDays = useMemo(() => {
    const year = anchorDate.getFullYear();
    const month = anchorDate.getMonth();
    const first = new Date(year, month, 1);
    const startOffset = (first.getDay() + 6) % 7; // Monday = 0
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells: Array<{ day: number | null; key: string }> = [];
    for (let i = 0; i < startOffset; i++) cells.push({ day: null, key: `pad-${i}` });
    for (let d = 1; d <= daysInMonth; d++) {
      const m = String(month + 1).padStart(2, '0');
      const dd = String(d).padStart(2, '0');
      cells.push({ day: d, key: `${year}-${m}-${dd}` });
    }
    return cells;
  }, [anchorDate]);

  const weekDays = useMemo(() => {
    const base = new Date(anchorDate);
    const dow = (base.getDay() + 6) % 7;
    base.setDate(base.getDate() - dow);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(base);
      d.setDate(base.getDate() + i);
      return {
        key: d.toISOString().slice(0, 10),
        label: d.toLocaleDateString('es-UY', { weekday: 'short', day: '2-digit', month: 'short' }),
      };
    });
  }, [anchorDate]);

  const anchorDayKey = useMemo(() => {
    const y = anchorDate.getFullYear();
    const m = String(anchorDate.getMonth() + 1).padStart(2, '0');
    const d = String(anchorDate.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }, [anchorDate]);

  const filteredTasks = tasks.filter((t) => {
    if (taskFilter === 'all') return true;
    if (taskFilter === 'done') return t.status === 'done';
    return t.status !== 'done';
  });

  const nowMs = Date.now();

  return (
    <div className="space-y-6 animate-silvv-in">
      {/* Header & Top Space Switch */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Agenda inteligente
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Agenda Memoria registra tu vida cotidiana automáticamente; Agenda Real coordina tus compromisos futuros y Google Calendar ({timezone}).
          </p>
        </div>

        <div className="inline-flex items-center gap-1 p-1 rounded-xl glass-subtle self-start shrink-0">
          <button
            type="button"
            onClick={() => setSpace('memoria')}
            aria-pressed={space === 'memoria'}
            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors whitespace-nowrap shrink-0 ${
              space === 'memoria'
                ? 'bg-white dark:bg-[#1E1E26] text-zinc-900 dark:text-zinc-50 shadow-xs'
                : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
            }`}
          >
            <BookHeart className="w-3.5 h-3.5 text-violet-500" />
            <span>Agenda Memoria ({memoryEvents.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setSpace('real')}
            aria-pressed={space === 'real'}
            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors whitespace-nowrap shrink-0 ${
              space === 'real'
                ? 'bg-white dark:bg-[#1E1E26] text-zinc-900 dark:text-zinc-50 shadow-xs'
                : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
            }`}
          >
            <CalendarIcon className="w-3.5 h-3.5 text-blue-500" />
            <span>Agenda Real y Tareas ({events.length})</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3.5 rounded-xl border border-red-300 dark:border-red-900/60 bg-red-50/80 dark:bg-red-950/30 text-sm text-red-700 dark:text-red-300 flex items-center justify-between gap-2 animate-silvv-in">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} className="cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {notice && (
        <div className="p-3.5 rounded-xl border border-amber-300 dark:border-amber-800/80 bg-amber-50/80 dark:bg-amber-950/30 text-sm text-amber-800 dark:text-amber-300 flex items-center justify-between gap-2 animate-silvv-in">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ==================== SPACE 1: AGENDA MEMORIA ==================== */}
      {space === 'memoria' && (
        <div className="space-y-5 animate-silvv-calendar-in">
          {/* Controls bar */}
          <div className="glass-panel rounded-2xl p-4 space-y-3">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div className="inline-flex items-center gap-1 p-1 rounded-xl glass-subtle overflow-x-auto max-w-full">
                {(
                  [
                    { id: 'timeline', label: 'Cronología' },
                    { id: 'month', label: 'Mensual' },
                    { id: 'week', label: 'Semanal' },
                    { id: 'day', label: 'Diaria' },
                    { id: 'grouped', label: 'Agrupada' },
                  ] as const
                ).map((vm) => (
                  <button
                    key={vm.id}
                    type="button"
                    onClick={() => setMemViewMode(vm.id)}
                    aria-pressed={memViewMode === vm.id}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer whitespace-nowrap shrink-0 ${
                      memViewMode === vm.id
                        ? 'bg-white dark:bg-[#1E1E26] text-zinc-900 dark:text-zinc-50 shadow-xs'
                        : 'text-zinc-500 dark:text-zinc-400'
                    }`}
                  >
                    {vm.label}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="relative flex-1 sm:w-56">
                  <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={memSearch}
                    onChange={(e) => setMemSearch(e.target.value)}
                    placeholder="Buscar vivencias, personas..."
                    className="w-full pl-8 pr-3 py-1.5 rounded-xl border border-zinc-200/80 dark:border-white/10 bg-white/70 dark:bg-black/30 text-xs text-zinc-900 dark:text-zinc-100 focus:outline-none"
                  />
                </div>

                <select
                  value={memCategoryFilter}
                  onChange={(e) => setMemCategoryFilter(e.target.value)}
                  className="px-3 py-1.5 rounded-xl border border-zinc-200/80 dark:border-white/10 bg-white/70 dark:bg-black/30 text-xs text-zinc-800 dark:text-zinc-200"
                >
                  <option value="all">Todas las categorías</option>
                  {categories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  onClick={() => setShowCatManager((v) => !v)}
                  aria-expanded={showCatManager}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl glass-subtle text-xs text-zinc-700 dark:text-zinc-200 cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Tag className="w-3.5 h-3.5" />
                  <span>Categorías</span>
                </button>

                <button
                  type="button"
                  onClick={() => openCreateMemModal()}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Registrar vivencia</span>
                </button>
              </div>
            </div>

            {showCatManager && (
              <div className="pt-3 border-t border-zinc-200/70 dark:border-white/10 space-y-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  {categories.map((cat) => (
                    <div
                      key={cat}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg glass-subtle text-xs text-zinc-700 dark:text-zinc-200"
                    >
                      <span>{cat}</span>
                      {categories.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleRemoveCategory(cat)}
                          className="text-zinc-400 hover:text-red-500 cursor-pointer"
                          title="Quitar categoría"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <form onSubmit={handleAddCategory} className="flex items-center gap-2 max-w-sm">
                  <input
                    type="text"
                    value={newCategoryName}
                    onChange={(e) => setNewCategoryName(e.target.value)}
                    placeholder="Nueva categoría personalizada..."
                    className="flex-1 px-3 py-1.5 rounded-xl border border-zinc-200/80 dark:border-white/10 bg-white/70 dark:bg-black/30 text-xs"
                  />
                  <button
                    type="submit"
                    disabled={!newCategoryName.trim()}
                    className="px-3 py-1.5 rounded-xl bg-violet-600 text-white text-xs font-medium cursor-pointer whitespace-nowrap"
                  >
                    Agregar
                  </button>
                </form>
              </div>
            )}
          </div>

          {/* View Renderers */}
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-24 rounded-2xl bg-zinc-200/60 dark:bg-white/5 animate-pulse" />
              ))}
            </div>
          ) : memViewMode === 'timeline' ? (
            <div className="silvv-stagger-list glass-panel rounded-2xl divide-y divide-zinc-200/60 dark:divide-white/5">
              {filteredMemoryEvents.length === 0 ? (
                <div className="p-10 text-center space-y-2">
                  <BookHeart className="w-7 h-7 text-zinc-400 mx-auto" />
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    Tu Agenda Memoria todavía está esperando tus primeras vivencias
                  </p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 max-w-md mx-auto">
                    Contale al Chat general lo que te pasó hoy, ayer o con alguien — SILVV MEMORY lo registra automáticamente sin interrumpirte con confirmaciones.
                  </p>
                </div>
              ) : (
                filteredMemoryEvents.map((ev) => (
                  <div
                    key={ev.id}
                    className="silvv-calendar-event p-5 flex items-start justify-between gap-4 hover:bg-zinc-100/40 dark:hover:bg-white/[0.02] transition-colors"
                  >
                    <button
                      type="button"
                      onClick={() => handleInspectMemoryEvent(ev)}
                      className="flex-1 min-w-0 text-left space-y-1.5 cursor-pointer"
                    >
                      <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400 tabular-nums">
                        <span className="font-medium text-violet-600 dark:text-violet-400">
                          {ev.dateLabel || (ev.eventDate ? ev.eventDate.slice(0, 10) : 'Sin fecha precisa')}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>{ev.category}</span>
                        {ev.people && ev.people.length > 0 && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>{ev.people.join(', ')}</span>
                          </>
                        )}
                      </div>
                      <h3 className="font-display text-base font-semibold text-zinc-900 dark:text-zinc-50">
                        {ev.title}
                      </h3>
                      <p className="text-sm text-zinc-600 dark:text-zinc-300 leading-relaxed line-clamp-3">
                        {ev.description}
                      </p>
                    </button>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => openEditMemModal(ev)}
                        title="Editar"
                        className="p-2 rounded-xl glass-subtle text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 cursor-pointer"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteMemoryEvent(ev.id)}
                        title="Enviar a papelera"
                        className="p-2 rounded-xl glass-subtle text-zinc-500 hover:text-red-500 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          ) : memViewMode === 'month' ? (
            <div className="glass-panel rounded-2xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-base font-semibold capitalize text-zinc-900 dark:text-zinc-50">
                  {anchorDate.toLocaleDateString('es-UY', { month: 'long', year: 'numeric' })}
                </h2>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      setAnchorDate((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))
                    }
                    className="p-1.5 rounded-lg glass-subtle cursor-pointer"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setAnchorDate(new Date())}
                    className="px-2.5 py-1 rounded-lg glass-subtle text-xs cursor-pointer"
                  >
                    Hoy
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setAnchorDate((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))
                    }
                    className="p-1.5 rounded-lg glass-subtle cursor-pointer"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-7 gap-2 text-center text-xs text-zinc-500 dark:text-zinc-400 font-medium">
                {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map((d) => (
                  <div key={d}>{d}</div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-2">
                {monthGridDays.map((cell) => {
                  const dayEvents = cell.day
                    ? filteredMemoryEvents.filter((e) => e.eventDate?.slice(0, 10) === cell.key)
                    : [];
                  return (
                    <div
                      key={cell.key}
                      className={`animate-silvv-calendar-day min-h-[84px] rounded-xl p-2 text-xs ${
                        cell.day ? 'glass-subtle' : 'opacity-20'
                      }`}
                    >
                      {cell.day && (
                        <>
                          <div className="font-mono tabular-nums text-zinc-500 dark:text-zinc-400 mb-1">
                            {cell.day}
                          </div>
                          <div className="space-y-1">
                            {dayEvents.slice(0, 3).map((ev) => (
                              <button
                                key={ev.id}
                                type="button"
                                onClick={() => handleInspectMemoryEvent(ev)}
                                className="w-full text-left px-1.5 py-0.5 rounded bg-violet-600/15 text-violet-700 dark:text-violet-300 truncate text-[11px] cursor-pointer"
                              >
                                {ev.title}
                              </button>
                            ))}
                            {dayEvents.length > 3 && (
                              <p className="text-[10px] text-zinc-400 tabular-nums">
                                +{dayEvents.length - 3} más
                              </p>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : memViewMode === 'week' ? (
            <div className="glass-panel rounded-2xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-base font-semibold text-zinc-900 dark:text-zinc-50">
                  Semana del {weekDays[0]?.label}
                </h2>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      setAnchorDate((d) => {
                        const n = new Date(d);
                        n.setDate(n.getDate() - 7);
                        return n;
                      })
                    }
                    className="p-1.5 rounded-lg glass-subtle cursor-pointer"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setAnchorDate(new Date())}
                    className="px-2.5 py-1 rounded-lg glass-subtle text-xs cursor-pointer"
                  >
                    Esta semana
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setAnchorDate((d) => {
                        const n = new Date(d);
                        n.setDate(n.getDate() + 7);
                        return n;
                      })
                    }
                    className="p-1.5 rounded-lg glass-subtle cursor-pointer"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-7 gap-3">
                {weekDays.map((wd) => {
                  const list = filteredMemoryEvents.filter(
                    (e) => e.eventDate?.slice(0, 10) === wd.key,
                  );
                  return (
                    <div key={wd.key} className="animate-silvv-calendar-day glass-subtle rounded-xl p-3 space-y-2 min-h-[160px]">
                      <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300 capitalize tabular-nums">
                        {wd.label}
                      </p>
                      {list.length === 0 ? (
                        <p className="text-[11px] text-zinc-400">Sin registros</p>
                      ) : (
                        list.map((ev) => (
                          <button
                            key={ev.id}
                            type="button"
                            onClick={() => handleInspectMemoryEvent(ev)}
                            className="w-full text-left p-2 rounded-lg bg-violet-600/12 hover:bg-violet-600/20 text-xs space-y-0.5 cursor-pointer"
                          >
                            <p className="font-medium text-zinc-900 dark:text-zinc-100 truncate">
                              {ev.title}
                            </p>
                            <p className="text-[11px] text-zinc-500 truncate">{ev.category}</p>
                          </button>
                        ))
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : memViewMode === 'day' ? (
            <div className="glass-panel rounded-2xl p-5 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-display text-base font-semibold text-zinc-900 dark:text-zinc-50">
                  Vista diaria · {anchorDayKey}
                </h2>
                <input
                  type="date"
                  value={anchorDayKey}
                  onChange={(e) => {
                    if (e.target.value) setAnchorDate(new Date(`${e.target.value}T12:00:00`));
                  }}
                  className="px-3 py-1.5 rounded-xl border border-zinc-200/80 dark:border-white/10 bg-white/70 dark:bg-black/30 text-xs tabular-nums"
                />
              </div>
              {(() => {
                const dayList = filteredMemoryEvents.filter(
                  (e) => e.eventDate?.slice(0, 10) === anchorDayKey,
                );
                return dayList.length === 0 ? (
                  <p className="text-sm text-zinc-500 dark:text-zinc-400 py-8 text-center">
                    No hay vivencias registradas para el {anchorDayKey}.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {dayList.map((ev) => (
                      <div
                        key={ev.id}
                        onClick={() => handleInspectMemoryEvent(ev)}
                        className="glass-subtle rounded-xl p-4 cursor-pointer space-y-1"
                      >
                        <p className="text-xs text-violet-600 dark:text-violet-400">
                          {ev.category}
                          {ev.people.length > 0 ? ` · ${ev.people.join(', ')}` : ''}
                        </p>
                        <h3 className="font-display text-base font-semibold text-zinc-900 dark:text-zinc-50">
                          {ev.title}
                        </h3>
                        <p className="text-sm text-zinc-600 dark:text-zinc-300">{ev.description}</p>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          ) : (
            /* GROUPED VIEW */
            <div className="space-y-4">
              <div className="inline-flex items-center gap-1 p-1 rounded-xl glass-subtle">
                {(
                  [
                    { id: 'person', label: 'Por persona' },
                    { id: 'category', label: 'Por categoría' },
                    { id: 'project', label: 'Por proyecto' },
                  ] as const
                ).map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => setGroupBy(g.id)}
                    aria-pressed={groupBy === g.id}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer whitespace-nowrap ${
                      groupBy === g.id
                        ? 'bg-white dark:bg-[#1E1E26] text-zinc-900 dark:text-zinc-50'
                        : 'text-zinc-500 dark:text-zinc-400'
                    }`}
                  >
                    {g.label}
                  </button>
                ))}
              </div>

              {groupBy === 'person' ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {people.length === 0 ? (
                    <div className="col-span-full glass-panel rounded-2xl p-8 text-center text-sm text-zinc-500">
                      Todavía no hay personas detectadas en tu Agenda Memoria.
                    </div>
                  ) : (
                    people.map((person) => {
                      const relEvents = filteredMemoryEvents.filter((ev) =>
                        ev.people.some(
                          (p) => p.toLowerCase() === person.name.toLowerCase(),
                        ),
                      );
                      return (
                        <div key={person.id} className="glass-panel rounded-2xl p-5 space-y-3">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <Users className="w-4 h-4 text-violet-500 shrink-0" />
                              <h3 className="font-display text-base font-semibold text-zinc-900 dark:text-zinc-50 truncate">
                                {person.name}
                              </h3>
                            </div>
                            <span className="text-xs text-zinc-500 tabular-nums shrink-0">
                              {relEvents.length} registros
                            </span>
                          </div>
                          {relEvents.length === 0 ? (
                            <p className="text-xs text-zinc-400">Sin registros filtrados.</p>
                          ) : (
                            <ul className="divide-y divide-zinc-200/60 dark:divide-white/5">
                              {relEvents.slice(0, 5).map((ev) => (
                                <li key={ev.id} className="py-2">
                                  <button
                                    type="button"
                                    onClick={() => handleInspectMemoryEvent(ev)}
                                    className="w-full text-left cursor-pointer hover:text-violet-500"
                                  >
                                    <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                                      {ev.title}
                                    </p>
                                    <p className="text-xs text-zinc-500 tabular-nums">
                                      {ev.dateLabel || ev.eventDate?.slice(0, 10) || 'Sin fecha'} ·{' '}
                                      {ev.category}
                                    </p>
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              ) : groupBy === 'category' ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {categories.map((cat) => {
                    const list = filteredMemoryEvents.filter((ev) => ev.category === cat);
                    if (list.length === 0) return null;
                    return (
                      <div key={cat} className="glass-panel rounded-2xl p-5 space-y-3">
                        <div className="flex items-center justify-between">
                          <h3 className="font-display text-base font-semibold text-zinc-900 dark:text-zinc-50">
                            {cat}
                          </h3>
                          <span className="text-xs text-zinc-500 tabular-nums">{list.length}</span>
                        </div>
                        <ul className="divide-y divide-zinc-200/60 dark:divide-white/5">
                          {list.slice(0, 6).map((ev) => (
                            <li key={ev.id} className="py-2">
                              <button
                                type="button"
                                onClick={() => handleInspectMemoryEvent(ev)}
                                className="w-full text-left cursor-pointer"
                              >
                                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                                  {ev.title}
                                </p>
                                <p className="text-xs text-zinc-500 tabular-nums">
                                  {ev.dateLabel || ev.eventDate?.slice(0, 10) || 'Sin fecha'}
                                </p>
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {projects.length === 0 ? (
                    <div className="col-span-full glass-panel rounded-2xl p-8 text-center text-sm text-zinc-500">
                      No hay proyectos vinculados todavía.
                    </div>
                  ) : (
                    projects.map((proj) => {
                      const list = filteredMemoryEvents.filter((ev) => ev.projectId === proj.id);
                      return (
                        <div key={proj.id} className="glass-panel rounded-2xl p-5 space-y-3">
                          <div className="flex items-center justify-between">
                            <h3 className="font-display text-base font-semibold text-zinc-900 dark:text-zinc-50 truncate">
                              {proj.name}
                            </h3>
                            <span className="text-xs text-zinc-500 tabular-nums">{list.length}</span>
                          </div>
                          {list.length === 0 ? (
                            <p className="text-xs text-zinc-400">Sin vivencias vinculadas.</p>
                          ) : (
                            <ul className="divide-y divide-zinc-200/60 dark:divide-white/5">
                              {list.map((ev) => (
                                <li key={ev.id} className="py-2">
                                  <button
                                    type="button"
                                    onClick={() => handleInspectMemoryEvent(ev)}
                                    className="w-full text-left cursor-pointer"
                                  >
                                    <p className="text-sm font-medium truncate">{ev.title}</p>
                                    <p className="text-xs text-zinc-500 tabular-nums">
                                      {ev.dateLabel || ev.eventDate?.slice(0, 10) || 'Sin fecha'}
                                    </p>
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ==================== SPACE 2: AGENDA REAL + TASKS ==================== */}
      {space === 'real' && (
        <div className="space-y-5 animate-silvv-calendar-in">
          <div className="glass-panel rounded-2xl px-5 py-3.5 flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-zinc-600 dark:text-zinc-300">
              Google Calendar:{' '}
              <span className="font-medium text-zinc-900 dark:text-zinc-100">
                {hasSessionGoogleToken
                  ? 'Sesión autorizada activa'
                  : googleIntegration?.status === 'connected'
                    ? 'Vinculado (re-autorizá en esta pestaña para sincronizar)'
                    : 'No sincronizado todavía'}
              </span>
              {googleIntegration?.lastSyncedAt && (
                <span className="text-zinc-500 dark:text-zinc-400 tabular-nums">
                  {' '}
                  · Última sincronización {formatDate(googleIntegration.lastSyncedAt)}
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex items-center gap-1 p-1 rounded-xl glass-subtle">
                {[
                  { id: 'auto' as const, label: 'Automático' },
                  { id: 'confirm' as const, label: 'Confirmar' },
                  { id: 'manual' as const, label: 'Manual' },
                ].map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => handleChangeCalendarMode(m.id)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium cursor-pointer whitespace-nowrap ${
                      currentCalendarMode === m.id
                        ? 'bg-white dark:bg-[#1E1E26] text-zinc-900 dark:text-zinc-100'
                        : 'text-zinc-500 dark:text-zinc-400'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={handleConnectAndSyncGoogle}
                disabled={syncingGoogle}
                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-60 text-white text-xs font-medium cursor-pointer whitespace-nowrap shrink-0"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${syncingGoogle ? 'animate-spin' : ''}`} />
                <span>
                  {hasSessionGoogleToken
                    ? syncingGoogle
                      ? 'Sincronizando...'
                      : 'Sincronizar Google Calendar'
                    : 'Conectar Google Calendar'}
                </span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Calendar Events Column */}
            <section className="glass-panel rounded-2xl p-6 space-y-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-display text-base font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                  <CalendarIcon className="w-4 h-4 text-zinc-400" />
                  <span>Compromisos reales ({events.length})</span>
                </h2>
                <button
                  type="button"
                  onClick={() => {
                    setEditingEventId(null);
                    setEvTitle('');
                    setEvLocation('');
                    setEvStart('');
                    setEvEnd('');
                    setShowEventForm((v) => !v);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl glass-subtle text-xs font-medium text-zinc-700 dark:text-zinc-200 cursor-pointer whitespace-nowrap"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Nuevo evento</span>
                </button>
              </div>

              {showEventForm && (
                <form
                  onSubmit={handleSubmitEventForm}
                  className="p-4 rounded-xl glass-subtle space-y-3 animate-silvv-popover-in"
                >
                  <input
                    type="text"
                    required
                    value={evTitle}
                    onChange={(e) => setEvTitle(e.target.value)}
                    placeholder="Título del evento..."
                    className="w-full px-3 py-2 rounded-xl border border-zinc-200/80 dark:border-white/10 bg-white/80 dark:bg-black/30 text-sm"
                  />
                  <input
                    type="text"
                    value={evLocation}
                    onChange={(e) => setEvLocation(e.target.value)}
                    placeholder="Lugar o enlace (opcional)"
                    className="w-full px-3 py-2 rounded-xl border border-zinc-200/80 dark:border-white/10 bg-white/80 dark:bg-black/30 text-sm"
                  />
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs text-zinc-500 mb-1">Inicio</label>
                      <input
                        type="datetime-local"
                        required
                        value={evStart}
                        onChange={(e) => setEvStart(e.target.value)}
                        className="w-full px-3 py-1.5 rounded-xl border border-zinc-200/80 dark:border-white/10 bg-white/80 dark:bg-black/30 text-xs tabular-nums"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-zinc-500 mb-1">Fin (opcional)</label>
                      <input
                        type="datetime-local"
                        value={evEnd}
                        onChange={(e) => setEvEnd(e.target.value)}
                        className="w-full px-3 py-1.5 rounded-xl border border-zinc-200/80 dark:border-white/10 bg-white/80 dark:bg-black/30 text-xs tabular-nums"
                      />
                    </div>
                  </div>
                  {hasSessionGoogleToken && (
                    <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={evSyncGoogle}
                        onChange={(e) => setEvSyncGoogle(e.target.checked)}
                        className="accent-violet-600"
                      />
                      <span>Guardar también en Google Calendar</span>
                    </label>
                  )}
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setShowEventForm(false);
                        setEditingEventId(null);
                      }}
                      className="px-3 py-1.5 rounded-xl glass-subtle text-xs text-zinc-500 cursor-pointer"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      className="px-3.5 py-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium cursor-pointer"
                    >
                      {editingEventId ? 'Guardar cambios' : 'Agendar'}
                    </button>
                  </div>
                </form>
              )}

              {loading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-14 rounded-xl bg-zinc-200/60 dark:bg-white/5 animate-pulse" />
                  ))}
                </div>
              ) : events.length === 0 ? (
                <p className="text-sm text-zinc-500 dark:text-zinc-400 py-6 text-center">
                  No hay eventos agendados todavía. Sincronizá Google Calendar o agendá un compromiso futuro desde el Chat.
                </p>
              ) : (
                <ul className="divide-y divide-zinc-200/60 dark:divide-white/5">
                  {events.map((ev) => {
                    const isFinished = new Date(ev.endAt).getTime() < nowMs;
                    return (
                      <li key={ev.id} className="silvv-calendar-event animate-silvv-calendar-day py-3.5 space-y-2">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 space-y-0.5">
                            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                              {ev.title}
                            </p>
                            <p className="text-xs text-zinc-500 dark:text-zinc-400 tabular-nums">
                              {formatDate(ev.startAt)} ·{' '}
                              {ev.externalProvider === 'google' ? 'Google Calendar' : 'SILVV MEMORY'}
                              {ev.location ? ` · ${ev.location}` : ''}
                            </p>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => openEditEvent(ev)}
                              title="Editar evento"
                              className="p-1.5 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 cursor-pointer"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => requestDeleteEvent(ev)}
                              title="Eliminar evento"
                              className="p-1.5 text-zinc-400 hover:text-red-500 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        {isFinished && !ev.linkedMemoryEventId && (
                          <button
                            type="button"
                            onClick={() => {
                              setSpace('memoria');
                              openCreateMemModal({
                                title: ev.title,
                                description: `Vivencia posterior a "${ev.title}"${ev.location ? ` en ${ev.location}` : ''}: `,
                                eventDate: ev.startAt,
                                linkedCalendarEventId: ev.id,
                              });
                            }}
                            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg glass-subtle text-[11px] font-medium text-violet-600 dark:text-violet-400 hover:border-violet-500/40 cursor-pointer"
                          >
                            <BookHeart className="w-3 h-3" />
                            <span>Registrar lo sucedido en Agenda Memoria</span>
                          </button>
                        )}
                        {ev.linkedMemoryEventId && (
                          <p className="text-[11px] text-emerald-600 dark:text-emerald-400">
                            Ya registrado en Agenda Memoria
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            {/* Tasks & Reminders Column */}
            <section className="glass-panel rounded-2xl p-6 space-y-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-display text-base font-semibold text-zinc-900 dark:text-zinc-100">
                  Tareas y recordatorios
                </h2>
                <div className="inline-flex items-center gap-1 p-1 rounded-xl glass-subtle">
                  {(['pending', 'done', 'all'] as const).map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => setTaskFilter(st)}
                      aria-pressed={taskFilter === st}
                      className={`px-2.5 py-1 rounded-lg text-xs font-medium cursor-pointer whitespace-nowrap ${
                        taskFilter === st
                          ? 'bg-white dark:bg-[#1E1E26] text-zinc-900 dark:text-zinc-100'
                          : 'text-zinc-500 dark:text-zinc-400'
                      }`}
                    >
                      {st === 'pending' ? 'Pendientes' : st === 'done' ? 'Hechas' : 'Todas'}
                    </button>
                  ))}
                </div>
              </div>

              <form onSubmit={handleCreateTask} className="space-y-2.5">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={taskTitle}
                    onChange={(e) => setTaskTitle(e.target.value)}
                    placeholder="Nueva tarea, entrega o recordatorio..."
                    className="flex-1 min-w-0 px-3 py-2 rounded-xl border border-zinc-200/80 dark:border-white/10 bg-white/70 dark:bg-black/30 text-sm"
                  />
                  <button
                    type="submit"
                    disabled={!taskTitle.trim()}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white text-xs font-medium cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Agregar</span>
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <select
                    value={taskKind}
                    onChange={(e) => setTaskKind(e.target.value as 'task' | 'deadline' | 'reminder')}
                    className="px-2.5 py-1.5 rounded-xl border border-zinc-200/80 dark:border-white/10 bg-white/70 dark:bg-black/30 text-xs"
                  >
                    <option value="task">Tarea</option>
                    <option value="reminder">Recordatorio</option>
                    <option value="deadline">Fecha límite</option>
                  </select>
                  <select
                    value={taskPriority}
                    onChange={(e) => setTaskPriority(e.target.value as TaskItem['priority'])}
                    className="px-2.5 py-1.5 rounded-xl border border-zinc-200/80 dark:border-white/10 bg-white/70 dark:bg-black/30 text-xs"
                  >
                    <option value="low">Baja</option>
                    <option value="medium">Media</option>
                    <option value="high">Alta</option>
                    <option value="urgent">Urgente</option>
                  </select>
                  <input
                    type="datetime-local"
                    value={taskDue}
                    onChange={(e) => setTaskDue(e.target.value)}
                    className="px-2.5 py-1.5 rounded-xl border border-zinc-200/80 dark:border-white/10 bg-white/70 dark:bg-black/30 text-xs tabular-nums"
                  />
                </div>
              </form>

              {loading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-12 rounded-xl bg-zinc-200/60 dark:bg-white/5 animate-pulse" />
                  ))}
                </div>
              ) : filteredTasks.length === 0 ? (
                <p className="text-sm text-zinc-500 dark:text-zinc-400 py-6 text-center">
                  No hay tareas en esta vista.
                </p>
              ) : (
                <ul className="divide-y divide-zinc-200/60 dark:divide-white/5">
                  {filteredTasks.map((t) => (
                    <li key={t.id} className="py-3 flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3 min-w-0">
                        <button
                          type="button"
                          onClick={() => handleToggleTask(t)}
                          className="mt-0.5 text-zinc-400 hover:text-violet-500 cursor-pointer shrink-0"
                        >
                          {t.status === 'done' ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                          ) : (
                            <Circle className="w-4 h-4" />
                          )}
                        </button>
                        <div className="min-w-0">
                          <p
                            className={`text-sm ${
                              t.status === 'done'
                                ? 'line-through text-zinc-400'
                                : 'text-zinc-900 dark:text-zinc-100'
                            }`}
                          >
                            {t.title}
                          </p>
                          <p className="text-xs text-zinc-500 dark:text-zinc-400 tabular-nums">
                            {t.kind} · {t.priority}
                            {t.dueAt ? ` · ${formatDate(t.dueAt)}` : ''}
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDeleteTask(t.id)}
                        className="p-1.5 text-zinc-400 hover:text-red-500 cursor-pointer shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>
      )}

      {/* ==================== MODAL: CREATE/EDIT AGENDA MEMORIA EVENT ==================== */}
      {showMemForm && (
        <div
                  className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-silvv-overlay-in"
          onClick={() => !savingMem && setShowMemForm(false)}
        >
          <form
            onSubmit={handleSaveMemoryEvent}
            onClick={(e) => e.stopPropagation()}
            className="animate-silvv-modal-in w-full max-w-lg glass-elevated rounded-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                {editingMemId ? 'Editar vivencia' : 'Registrar en Agenda Memoria'}
              </h2>
              <button
                type="button"
                onClick={() => setShowMemForm(false)}
                className="p-1.5 text-zinc-400 hover:text-zinc-200 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div>
              <label className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">Título</label>
              <input
                type="text"
                required
                value={memTitle}
                onChange={(e) => setMemTitle(e.target.value)}
                placeholder="Ej: Charla con Cata tras clase"
                className="w-full px-3 py-2 rounded-xl border border-zinc-200/80 dark:border-white/10 bg-white/80 dark:bg-black/30 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">
                Qué sucedió / descripción
              </label>
              <textarea
                rows={3}
                required
                value={memDesc}
                onChange={(e) => setMemDesc(e.target.value)}
                placeholder="Contá los detalles reales..."
                className="w-full px-3 py-2 rounded-xl border border-zinc-200/80 dark:border-white/10 bg-white/80 dark:bg-black/30 text-sm"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">
                  Precisión temporal
                </label>
                <select
                  value={memPrecision}
                  onChange={(e) =>
                    setMemPrecision(e.target.value as MemoryEventItem['datePrecision'])
                  }
                  className="w-full px-3 py-2 rounded-xl border border-zinc-200/80 dark:border-white/10 bg-white/80 dark:bg-black/30 text-xs"
                >
                  <option value="day">Día específico</option>
                  <option value="exact">Hora exacta</option>
                  <option value="approximate">Aproximado</option>
                  <option value="unknown">Sin fecha precisa</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">Fecha</label>
                <input
                  type="date"
                  disabled={memPrecision === 'unknown'}
                  value={memDate}
                  onChange={(e) => setMemDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-zinc-200/80 dark:border-white/10 bg-white/80 dark:bg-black/30 text-xs tabular-nums disabled:opacity-40"
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">
                  Etiqueta fecha
                </label>
                <input
                  type="text"
                  value={memDateLabel}
                  onChange={(e) => setMemDateLabel(e.target.value)}
                  placeholder="Hoy, Ayer..."
                  className="w-full px-3 py-2 rounded-xl border border-zinc-200/80 dark:border-white/10 bg-white/80 dark:bg-black/30 text-xs"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">
                  Categoría
                </label>
                <select
                  value={memCat}
                  onChange={(e) => setMemCat(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-zinc-200/80 dark:border-white/10 bg-white/80 dark:bg-black/30 text-xs"
                >
                  {categories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">
                  Proyecto (opcional)
                </label>
                <select
                  value={memProjectId}
                  onChange={(e) =>
                    setMemProjectId(e.target.value ? Number(e.target.value) : '')
                  }
                  className="w-full px-3 py-2 rounded-xl border border-zinc-200/80 dark:border-white/10 bg-white/80 dark:bg-black/30 text-xs"
                >
                  <option value="">Ninguno</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">
                Personas involucradas (separadas por coma)
              </label>
              <input
                type="text"
                value={memPeopleText}
                onChange={(e) => setMemPeopleText(e.target.value)}
                placeholder="Cata, Martín, Sofía..."
                className="w-full px-3 py-2 rounded-xl border border-zinc-200/80 dark:border-white/10 bg-white/80 dark:bg-black/30 text-xs"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowMemForm(false)}
                className="px-4 py-2 rounded-xl glass-subtle text-xs text-zinc-600 dark:text-zinc-300 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={savingMem || !memTitle.trim() || !memDesc.trim()}
                className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium cursor-pointer"
              >
                {savingMem ? 'Guardando...' : 'Guardar en Agenda Memoria'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ==================== MODAL: MEMORY EVENT DETAIL ==================== */}
      {detailMemEvent && (
        <div
                  className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-silvv-overlay-in"
          onClick={() => setDetailMemEvent(null)}
        >
          <div
            className="animate-silvv-modal-in w-full max-w-xl glass-elevated rounded-2xl p-6 space-y-4 max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs text-violet-600 dark:text-violet-400 font-medium tabular-nums">
                  {detailMemEvent.category} ·{' '}
                  {detailMemEvent.dateLabel ||
                    detailMemEvent.eventDate?.slice(0, 10) ||
                    'Sin fecha precisa'}
                </p>
                <h2 className="font-display text-lg font-semibold text-zinc-900 dark:text-zinc-50 mt-0.5">
                  {detailMemEvent.title}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setDetailMemEvent(null)}
                className="p-1.5 text-zinc-400 hover:text-zinc-200 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-sm text-zinc-700 dark:text-zinc-200 leading-relaxed">
              {detailMemEvent.description}
            </p>

            {detailMemEvent.people && detailMemEvent.people.length > 0 && (
              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                Personas: <span className="text-zinc-800 dark:text-zinc-200">{detailMemEvent.people.join(' · ')}</span>
              </div>
            )}

            {detailMemEvent.sourceMessageText && (
              <div className="glass-subtle rounded-xl p-3.5 space-y-1.5">
                <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400 flex items-center gap-1.5">
                  <MessageSquareText className="w-3.5 h-3.5" />
                  <span>Mensaje original en tu conversación</span>
                </p>
                <p className="text-xs italic text-zinc-700 dark:text-zinc-300 leading-relaxed">
                  "{detailMemEvent.sourceMessageText}"
                </p>
              </div>
            )}

            {detailRelations.length > 0 && (
              <div className="space-y-1.5 pt-2 border-t border-zinc-200/70 dark:border-white/10">
                <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  Relaciones detectadas
                </p>
                <p className="text-xs text-zinc-700 dark:text-zinc-300">
                  {detailRelations.map((r) => `${r.targetLabel} (${r.relationKind})`).join(' · ')}
                </p>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  const target = detailMemEvent;
                  setDetailMemEvent(null);
                  openEditMemModal(target);
                }}
                className="px-3.5 py-1.5 rounded-xl glass-subtle text-xs font-medium cursor-pointer"
              >
                Editar
              </button>
              <button
                type="button"
                onClick={() => setDetailMemEvent(null)}
                className="px-3.5 py-1.5 rounded-xl bg-violet-600 text-white text-xs font-medium cursor-pointer"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== MODAL: CONFIRM GOOGLE CALENDAR MUTATION ==================== */}
      {confirmModal && (
        <div
                  className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-silvv-overlay-in"
          onClick={() => !executingConfirm && setConfirmModal(null)}
        >
          <div
            className="animate-silvv-modal-in w-full max-w-md glass-elevated rounded-2xl p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <h3 className="font-display text-base font-semibold text-zinc-900 dark:text-zinc-100">
                {confirmModal.title}
              </h3>
              <button
                type="button"
                disabled={executingConfirm}
                onClick={() => setConfirmModal(null)}
                className="text-zinc-400 hover:text-zinc-200 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-sm text-zinc-600 dark:text-zinc-300 leading-relaxed">
              {confirmModal.description}
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={executingConfirm}
                onClick={() => setConfirmModal(null)}
                className="px-4 py-2 rounded-xl glass-subtle text-xs font-medium text-zinc-600 dark:text-zinc-300 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={executingConfirm}
                onClick={() =>
                  executeEventMutation(
                    confirmModal.action,
                    confirmModal.eventId,
                    confirmModal.payload,
                  )
                }
                className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium cursor-pointer"
              >
                {executingConfirm ? 'Aplicando...' : 'Confirmar cambio'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
