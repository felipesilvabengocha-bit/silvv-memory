import { useEffect, useState } from 'react';
import { Download, Plus, RefreshCw, RotateCcw, Trash2, X } from 'lucide-react';
import {
  apiRequest,
  DEFAULT_MEMORY_EVENT_CATEGORIES,
  type ActionLogItem,
  type GoogleCalendarIntegration,
  type UserPreferences,
  type UserProfile,
} from '../lib/api';
import { authorizeGoogleCalendarPopup, getGoogleAccessToken } from '../lib/firebase';

interface SettingsTrashViewProps {
  user: UserProfile | null;
  preferences: UserPreferences | null;
  googleIntegration: GoogleCalendarIntegration | null;
  onUpdated: (user: UserProfile, preferences: UserPreferences) => void;
  onDataChanged: () => void;
}

interface TrashPayload {
  projects: Array<{ id: number; name: string; deletedAt: string }>;
  memories: Array<{ id: number; title: string | null; content: string; deletedAt: string }>;
  files: Array<{ id: number; displayName: string; deletedAt: string }>;
  tasks: Array<{ id: number; title: string; deletedAt: string }>;
  events: Array<{ id: number; title: string; deletedAt: string }>;
  notes?: Array<{ id: number; title: string; content: string; deletedAt: string }>;
  memoryEvents?: Array<{ id: number; title: string; category: string; deletedAt: string }>;
}

export function SettingsTrashView({
  user,
  preferences,
  googleIntegration,
  onUpdated,
  onDataChanged,
}: SettingsTrashViewProps) {
  const [section, setSection] = useState<'preferences' | 'actions' | 'trash'>('preferences');
  const [fullName, setFullName] = useState(user?.fullName || '');
  const [timezone, setTimezone] = useState(user?.timezone || 'America/Montevideo');
  const [theme, setTheme] = useState<'dark' | 'light' | 'system'>(preferences?.theme || 'dark');
  const [autonomyLevel, setAutonomyLevel] = useState<'manual' | 'balanced' | 'proactive'>(
    preferences?.autonomyLevel || 'balanced'
  );
  const [autoCreateCalendarEvents, setAutoCreateCalendarEvents] = useState(
    Boolean(preferences?.autoCreateCalendarEvents)
  );
  const [threshold, setThreshold] = useState(preferences?.autoClassifyThreshold ?? 0.8);
  const [customCategories, setCustomCategories] = useState<string[]>(
    preferences?.customEventCategories && preferences.customEventCategories.length > 0
      ? preferences.customEventCategories
      : DEFAULT_MEMORY_EVENT_CATEGORIES
  );
  const [newCategoryInput, setNewCategoryInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [syncingGoogle, setSyncingGoogle] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [actions, setActions] = useState<ActionLogItem[]>([]);
  const [trash, setTrash] = useState<TrashPayload | null>(null);

  useEffect(() => {
    if (user) {
      setFullName(user.fullName || '');
      setTimezone(user.timezone || 'America/Montevideo');
    }
    if (preferences) {
      setTheme(preferences.theme);
      setAutonomyLevel(preferences.autonomyLevel);
      setAutoCreateCalendarEvents(preferences.autoCreateCalendarEvents);
      setThreshold(preferences.autoClassifyThreshold);
      setCustomCategories(
        preferences.customEventCategories && preferences.customEventCategories.length > 0
          ? preferences.customEventCategories
          : DEFAULT_MEMORY_EVENT_CATEGORIES
      );
    }
  }, [user, preferences]);

  const loadAux = async () => {
    try {
      const [acts, tr] = await Promise.all([
        apiRequest<ActionLogItem[]>('/api/actions'),
        apiRequest<TrashPayload>('/api/trash'),
      ]);
      setActions(acts);
      setTrash(tr);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar registros.');
    }
  };

  useEffect(() => {
    loadAux();
  }, [section]);

  const handleAddCategory = () => {
    const trimmed = newCategoryInput.trim();
    if (!trimmed) return;
    if (!customCategories.some((c) => c.toLowerCase() === trimmed.toLowerCase())) {
      setCustomCategories((prev) => [...prev, trimmed]);
    }
    setNewCategoryInput('');
  };

  const handleSavePreferences = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaveMsg(null);
    setError(null);
    try {
      const res = await apiRequest<{ user: UserProfile; preferences: UserPreferences }>('/api/me', {
        method: 'PATCH',
        body: JSON.stringify({
          fullName,
          timezone,
          theme,
          autonomyLevel,
          autoCreateCalendarEvents,
          autoClassifyThreshold: threshold,
          customEventCategories:
            customCategories.length > 0 ? customCategories : DEFAULT_MEMORY_EVENT_CATEGORIES,
        }),
      });
      onUpdated(res.user, res.preferences);
      setSaveMsg('Preferencias guardadas.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron guardar los ajustes.');
    } finally {
      setSaving(false);
    }
  };

  const handleExportJson = async () => {
    setExporting(true);
    setError(null);
    try {
      const data = await apiRequest<Record<string, unknown>>('/api/export');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `silvv-memory-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo exportar tu información.');
    } finally {
      setExporting(false);
    }
  };

  const handleConnectGoogle = async () => {
    setSyncingGoogle(true);
    setError(null);
    try {
      let token = getGoogleAccessToken();
      if (!token) token = await authorizeGoogleCalendarPopup();
      if (!token) throw new Error('No se autorizó Google Calendar.');
      await apiRequest('/api/calendar/google/sync', { method: 'POST' });
      setSaveMsg('Google Calendar conectado y sincronizado.');
      onDataChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al conectar Google Calendar.');
    } finally {
      setSyncingGoogle(false);
    }
  };

  const handleRestore = async (type: string, id: number) => {
    try {
      await apiRequest('/api/trash/restore', {
        method: 'POST',
        body: JSON.stringify({ type, id }),
      });
      await loadAux();
      onDataChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo restaurar.');
    }
  };

  const handlePurge = async (type: string, id: number) => {
    try {
      await apiRequest('/api/trash/purge', {
        method: 'DELETE',
        body: JSON.stringify({ type, id }),
      });
      await loadAux();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo eliminar definitivamente.');
    }
  };

  const trashItems = trash
    ? [
        ...trash.projects.map((p) => ({ type: 'project', id: p.id, label: `Proyecto: ${p.name}` })),
        ...trash.memories.map((m) => ({
          type: 'memory',
          id: m.id,
          label: `Recuerdo: ${m.title || m.content.slice(0, 60)}`,
        })),
        ...(trash.notes || []).map((n) => ({
          type: 'note',
          id: n.id,
          label: `Nota: ${n.title || n.content.slice(0, 60)}`,
        })),
        ...(trash.memoryEvents || []).map((me) => ({
          type: 'memory_event',
          id: me.id,
          label: `Agenda Memoria: ${me.title} (${me.category})`,
        })),
        ...trash.files.map((f) => ({ type: 'file', id: f.id, label: `Archivo: ${f.displayName}` })),
        ...trash.tasks.map((t) => ({ type: 'task', id: t.id, label: `Tarea: ${t.title}` })),
        ...trash.events.map((e) => ({ type: 'event', id: e.id, label: `Evento: ${e.title}` })),
      ]
    : [];

  return (
    <div className="space-y-6 animate-silvv-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Ajustes, exportación y papelera
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Configurá la autonomía de SILVV MEMORY, tus categorías de Agenda Memoria, exportá tus datos o recuperá elementos borrados.
          </p>
        </div>

        <div className="inline-flex items-center gap-1 p-1 rounded-xl glass-subtle self-start">
          <button
            type="button"
            onClick={() => setSection('preferences')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer whitespace-nowrap shrink-0 ${
              section === 'preferences'
                ? 'bg-white dark:bg-[#1E1E26] text-zinc-900 dark:text-zinc-100 shadow-xs'
                : 'text-zinc-500 dark:text-zinc-400'
            }`}
          >
            Preferencias
          </button>
          <button
            type="button"
            onClick={() => setSection('actions')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer whitespace-nowrap shrink-0 ${
              section === 'actions'
                ? 'bg-white dark:bg-[#1E1E26] text-zinc-900 dark:text-zinc-100 shadow-xs'
                : 'text-zinc-500 dark:text-zinc-400'
            }`}
          >
            Auditoría
          </button>
          <button
            type="button"
            onClick={() => setSection('trash')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer whitespace-nowrap shrink-0 tabular-nums ${
              section === 'trash'
                ? 'bg-white dark:bg-[#1E1E26] text-zinc-900 dark:text-zinc-100 shadow-xs'
                : 'text-zinc-500 dark:text-zinc-400'
            }`}
          >
            Papelera ({trashItems.length})
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3.5 rounded-xl border border-red-300 dark:border-red-900/60 bg-red-50/90 dark:bg-red-950/30 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {section === 'preferences' && (
        <div className="space-y-6 max-w-3xl">
          <form onSubmit={handleSavePreferences} className="glass-panel rounded-2xl p-6 space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">
                  Nombre visible
                </label>
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-zinc-200/80 dark:border-white/10 bg-white/75 dark:bg-black/30 text-sm text-zinc-900 dark:text-zinc-100"
                />
              </div>

              <div>
                <label className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">
                  Zona horaria
                </label>
                <select
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-zinc-200/80 dark:border-white/10 bg-white/75 dark:bg-black/30 text-sm text-zinc-900 dark:text-zinc-100"
                >
                  <option value="America/Montevideo">America/Montevideo (Uruguay)</option>
                  <option value="America/Argentina/Buenos_Aires">America/Buenos_Aires</option>
                  <option value="America/Santiago">America/Santiago</option>
                  <option value="America/Mexico_City">America/Mexico_City</option>
                  <option value="Europe/Madrid">Europe/Madrid</option>
                  <option value="UTC">UTC</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">
                  Apariencia
                </label>
                <select
                  value={theme}
                  onChange={(e) => setTheme(e.target.value as 'dark' | 'light' | 'system')}
                  className="w-full px-3 py-2 rounded-xl border border-zinc-200/80 dark:border-white/10 bg-white/75 dark:bg-black/30 text-sm text-zinc-900 dark:text-zinc-100"
                >
                  <option value="dark">Modo oscuro (predeterminado)</option>
                  <option value="light">Modo claro</option>
                  <option value="system">Seguir sistema</option>
                </select>
              </div>

              <div>
                <label className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">
                  Nivel de autonomía de SILVV MEMORY
                </label>
                <select
                  value={autonomyLevel}
                  onChange={(e) =>
                    setAutonomyLevel(e.target.value as 'manual' | 'balanced' | 'proactive')
                  }
                  className="w-full px-3 py-2 rounded-xl border border-zinc-200/80 dark:border-white/10 bg-white/75 dark:bg-black/30 text-sm text-zinc-900 dark:text-zinc-100"
                >
                  <option value="manual">Manual (pide confirmación para todo)</option>
                  <option value="balanced">Equilibrado (organiza archivos/tareas, consulta agenda)</option>
                  <option value="proactive">Proactivo (ejecuta automáticamente sin conflictos)</option>
                </select>
              </div>
            </div>

            <div className="space-y-4 pt-2 border-t border-zinc-200/70 dark:border-white/10">
              <label className="flex items-center justify-between gap-4 cursor-pointer">
                <div>
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    Agendar eventos automáticamente en modo equilibrado
                  </p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Si está desactivado, SILVV MEMORY te pide 1 clic para confirmar cada evento nuevo.
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={autoCreateCalendarEvents}
                  onChange={(e) => setAutoCreateCalendarEvents(e.target.checked)}
                  className="w-4 h-4 accent-violet-600"
                />
              </label>

              <div>
                <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400 mb-1 tabular-nums">
                  <span>Umbral mínimo de confianza para auto-clasificar archivos</span>
                  <span>{Math.round(threshold * 100)}%</span>
                </div>
                <input
                  type="range"
                  min={0.5}
                  max={0.95}
                  step={0.05}
                  value={threshold}
                  onChange={(e) => setThreshold(Number(e.target.value))}
                  className="w-full accent-violet-600"
                />
              </div>
            </div>

            {/* Editable Custom Categories for Agenda Memoria */}
            <div className="space-y-3 pt-2 border-t border-zinc-200/70 dark:border-white/10">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    Categorías de Agenda Memoria
                  </p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Personalizá las categorías disponibles para clasificar acontecimientos vividos.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setCustomCategories(DEFAULT_MEMORY_EVENT_CATEGORIES)}
                  className="text-xs text-violet-600 dark:text-violet-400 hover:underline cursor-pointer whitespace-nowrap shrink-0"
                >
                  Restablecer
                </button>
              </div>

              <div className="flex flex-wrap gap-2">
                {customCategories.map((cat) => (
                  <span
                    key={cat}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg glass-subtle text-xs text-zinc-800 dark:text-zinc-200"
                  >
                    <span>{cat}</span>
                    {customCategories.length > 1 && (
                      <button
                        type="button"
                        onClick={() =>
                          setCustomCategories((prev) => prev.filter((item) => item !== cat))
                        }
                        aria-label={`Quitar ${cat}`}
                        className="text-zinc-400 hover:text-red-500 cursor-pointer"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </span>
                ))}
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={newCategoryInput}
                  onChange={(e) => setNewCategoryInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddCategory();
                    }
                  }}
                  placeholder="Agregar categoría (ej: Salud, Viajes, Música)..."
                  className="flex-1 min-w-0 px-3 py-2 rounded-xl border border-zinc-200/80 dark:border-white/10 bg-white/75 dark:bg-black/30 text-xs text-zinc-900 dark:text-zinc-100"
                />
                <button
                  type="button"
                  onClick={handleAddCategory}
                  disabled={!newCategoryInput.trim()}
                  className="inline-flex items-center gap-1 px-3 py-2 rounded-xl glass-subtle text-xs font-medium text-zinc-800 dark:text-zinc-200 hover:bg-zinc-200/60 dark:hover:bg-white/10 disabled:opacity-40 cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Agregar</span>
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between gap-4 pt-2">
              <span className="text-xs text-emerald-600 dark:text-emerald-400">{saveMsg}</span>
              <button
                type="submit"
                disabled={saving}
                className="px-5 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium cursor-pointer whitespace-nowrap shrink-0"
              >
                {saving ? 'Guardando...' : 'Guardar ajustes'}
              </button>
            </div>
          </form>

          {/* Google Calendar + Data Export */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="glass-panel rounded-2xl p-5 space-y-3">
              <h2 className="font-display text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                Conexión con Google Calendar
              </h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Estado: {googleIntegration?.status === 'connected' ? 'Vinculado' : 'Sin sincronizar'}
              </p>
              <button
                type="button"
                disabled={syncingGoogle}
                onClick={handleConnectGoogle}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl glass-subtle text-xs font-medium text-zinc-800 dark:text-zinc-200 hover:bg-zinc-200/60 dark:hover:bg-white/10 cursor-pointer whitespace-nowrap"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${syncingGoogle ? 'animate-spin' : ''}`} />
                <span>{syncingGoogle ? 'Sincronizando...' : 'Conectar / Sincronizar'}</span>
              </button>
            </div>

            <div className="glass-panel rounded-2xl p-5 space-y-3">
              <h2 className="font-display text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                Exportar tu segundo cerebro
              </h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Descargá recuerdos, notas, Agenda Memoria, resúmenes, carpetas, proyectos, eventos, tareas y agentes en JSON.
              </p>
              <button
                type="button"
                disabled={exporting}
                onClick={handleExportJson}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl glass-subtle text-xs font-medium text-zinc-800 dark:text-zinc-200 hover:bg-zinc-200/60 dark:hover:bg-white/10 cursor-pointer whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5" />
                <span>{exporting ? 'Preparando JSON...' : 'Exportar datos (.json)'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {section === 'actions' && (
        <div className="glass-panel rounded-2xl divide-y divide-zinc-200/70 dark:divide-white/10">
          {actions.length === 0 ? (
            <p className="p-8 text-sm text-zinc-500 dark:text-zinc-400 text-center">
              Todavía no hay acciones registradas.
            </p>
          ) : (
            actions.map((act) => (
              <div key={act.id} className="px-6 py-4 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                    {act.toolName} · {act.status}
                  </p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                    {JSON.stringify(act.inputPayload).slice(0, 140)}
                  </p>
                </div>
                <span className="text-xs font-mono tabular-nums text-zinc-500 dark:text-zinc-400 shrink-0">
                  {new Date(act.createdAt).toLocaleString('es-UY')}
                </span>
              </div>
            ))
          )}
        </div>
      )}

      {section === 'trash' && (
        <div className="glass-panel rounded-2xl divide-y divide-zinc-200/70 dark:divide-white/10">
          {trashItems.length === 0 ? (
            <p className="p-8 text-sm text-zinc-500 dark:text-zinc-400 text-center">
              La papelera está vacía.
            </p>
          ) : (
            trashItems.map((item) => (
              <div
                key={`${item.type}-${item.id}`}
                className="px-6 py-4 flex items-center justify-between gap-4"
              >
                <span className="text-sm text-zinc-900 dark:text-zinc-100 truncate">
                  {item.label}
                </span>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleRestore(item.type, item.id)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl glass-subtle text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-200/60 dark:hover:bg-white/10 cursor-pointer whitespace-nowrap"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Restaurar</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handlePurge(item.type, item.id)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-red-300 dark:border-red-900/60 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 cursor-pointer whitespace-nowrap"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Borrar</span>
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
