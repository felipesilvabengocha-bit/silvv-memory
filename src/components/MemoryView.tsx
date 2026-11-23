import { useEffect, useState } from 'react';
import {
  Brain,
  ExternalLink,
  Folder,
  FolderKanban,
  Info,
  Pause,
  Play,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import {
  apiRequest,
  type MemoryDetailResponse,
  type MemoryItem,
} from '../lib/api';
import { FilesView } from './FilesView';
import { PrivateImagePreview } from './PrivateImagePreview';
import { ProjectsView } from './ProjectsView';

interface MemoryViewProps {
  onDataChanged: () => void;
  onGoToChat: () => void;
}

const LAYER_LABELS: Record<string, string> = {
  all: 'Todas',
  semantic: 'Semántica',
  episodic: 'Episódica',
  project: 'Proyectos',
  temporal: 'Temporal',
};

const ORIGIN_KIND_LABELS: Record<string, string> = {
  fact: 'Hecho',
  preference: 'Preferencia',
  opinion: 'Opinión',
  idea: 'Idea',
  decision: 'Decisión',
  commitment: 'Compromiso',
  academic: 'Académico',
  professional: 'Profesional',
  temporal: 'Temporal',
};

export function MemoryView({ onDataChanged, onGoToChat }: MemoryViewProps) {
  const [subTab, setSubTab] = useState<'memories' | 'folders' | 'projects'>('memories');

  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [layerFilter, setLayerFilter] = useState<'all' | 'semantic' | 'episodic' | 'project' | 'temporal'>('all');
  const [query, setQuery] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  const [newLayer, setNewLayer] = useState<'semantic' | 'episodic' | 'project' | 'temporal'>('semantic');
  const [newOriginKind, setNewOriginKind] = useState('fact');
  const [newCategory, setNewCategory] = useState('Personal');
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [newTags, setNewTags] = useState('');
  const [newImportance, setNewImportance] = useState(3);
  const [saving, setSaving] = useState(false);

  const [detailModal, setDetailModal] = useState<MemoryDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const loadMemories = async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await apiRequest<MemoryItem[]>('/api/memories');
      setMemories(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar recuerdos.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMemories();
  }, []);

  useEffect(() => {
    const handleRemoteChange = (event: Event) => {
      const collectionName = (event as CustomEvent<{ collectionName?: string }>).detail?.collectionName;
      if (['memories', 'smartFolders'].includes(collectionName || '')) void loadMemories();
    };
    window.addEventListener('silvv:organization-change', handleRemoteChange);
    return () => window.removeEventListener('silvv:organization-change', handleRemoteChange);
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newContent.trim()) return;
    setSaving(true);
    try {
      const tags = newTags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      await apiRequest('/api/memories', {
        method: 'POST',
        body: JSON.stringify({
          memoryLayer: newLayer,
          originKind: newOriginKind,
          category: newCategory,
          title: newTitle.trim() || undefined,
          content: newContent.trim(),
          tags,
          importance: newImportance,
        }),
      });
      setNewTitle('');
      setNewContent('');
      setNewTags('');
      setShowCreate(false);
      await loadMemories();
      onDataChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar el recuerdo.');
    } finally {
      setSaving(false);
    }
  };

  const handleOpenDetail = async (id: number) => {
    setDetailLoading(true);
    try {
      const res = await apiRequest<MemoryDetailResponse>(`/api/memories/${id}/detail`);
      setDetailModal(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar la ficha del recuerdo.');
    } finally {
      setDetailLoading(false);
    }
  };

  const handleToggleActive = async (mem: MemoryItem) => {
    try {
      await apiRequest(`/api/memories/${mem.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !mem.isActive }),
      });
      setMemories((prev) =>
        prev.map((m) => (m.id === mem.id ? { ...m, isActive: !m.isActive } : m))
      );
      onDataChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo actualizar.');
    }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm('¿Eliminar este recuerdo y quitar sus referencias vinculadas?')) return;
    try {
      await apiRequest(`/api/memories/${id}`, { method: 'DELETE' });
      setMemories((prev) => prev.filter((m) => m.id !== id));
      onDataChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo enviar a la papelera.');
    }
  };

  const filtered = memories.filter((m) => {
    if (layerFilter !== 'all' && m.memoryLayer !== layerFilter) return false;
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return (
      m.content.toLowerCase().includes(q) ||
      (m.title || '').toLowerCase().includes(q) ||
      m.category.toLowerCase().includes(q) ||
      (m.tags || []).some((t) => t.toLowerCase().includes(q))
    );
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Memoria y carpetas
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Segundo cerebro en 4 capas, árbol de subcarpetas, archivos originales y proyectos.
          </p>
        </div>

        <div className="inline-flex items-center gap-1 p-1 rounded-xl glass-subtle self-start overflow-x-auto max-w-full">
          <button
            type="button"
            onClick={() => setSubTab('memories')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer whitespace-nowrap shrink-0 tabular-nums ${
              subTab === 'memories'
                ? 'bg-white dark:bg-[#1E1E26] text-zinc-900 dark:text-zinc-100 shadow-xs'
                : 'text-zinc-500 dark:text-zinc-400'
            }`}
          >
            <Brain className="w-3.5 h-3.5" />
            <span>Recuerdos ({memories.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setSubTab('folders')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer whitespace-nowrap shrink-0 ${
              subTab === 'folders'
                ? 'bg-white dark:bg-[#1E1E26] text-zinc-900 dark:text-zinc-100 shadow-xs'
                : 'text-zinc-500 dark:text-zinc-400'
            }`}
          >
            <Folder className="w-3.5 h-3.5" />
            <span>Archivos</span>
          </button>
          <button
            type="button"
            onClick={() => setSubTab('projects')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer whitespace-nowrap shrink-0 ${
              subTab === 'projects'
                ? 'bg-white dark:bg-[#1E1E26] text-zinc-900 dark:text-zinc-100 shadow-xs'
                : 'text-zinc-500 dark:text-zinc-400'
            }`}
          >
            <FolderKanban className="w-3.5 h-3.5" />
            <span>Proyectos</span>
          </button>
        </div>
      </div>

      {subTab === 'folders' && (
        <FilesView onDataChanged={onDataChanged} onGoToChat={onGoToChat} />
      )}

      {subTab === 'projects' && <ProjectsView onDataChanged={onDataChanged} />}

      {subTab === 'memories' && (
        <div className="space-y-5">
          {error && (
            <div className="p-3.5 rounded-xl border border-red-300 dark:border-red-900/60 bg-red-50/90 dark:bg-red-950/30 text-sm text-red-700 dark:text-red-300">
              {error}
            </div>
          )}

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="inline-flex items-center gap-1 p-1 rounded-xl glass-subtle self-start overflow-x-auto max-w-full">
              {(['all', 'semantic', 'episodic', 'project', 'temporal'] as const).map((layer) => (
                <button
                  key={layer}
                  type="button"
                  onClick={() => setLayerFilter(layer)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    layerFilter === layer
                      ? 'bg-white dark:bg-[#1E1E26] text-zinc-900 dark:text-zinc-100 shadow-xs'
                      : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                  }`}
                >
                  {LAYER_LABELS[layer]}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <div className="relative flex-1 sm:w-64">
                <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Filtrar recuerdos o etiquetas..."
                  className="w-full pl-9 pr-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111114] text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none"
                />
              </div>
              <button
                type="button"
                onClick={() => setShowCreate((v) => !v)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <Plus className="w-4 h-4" />
                <span>Nuevo</span>
              </button>
            </div>
          </div>

          {showCreate && (
            <form
              onSubmit={handleCreate}
              className="glass-panel rounded-2xl p-5 space-y-4"
            >
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div>
                  <label className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">Capa</label>
                  <select
                    value={newLayer}
                    onChange={(e) =>
                      setNewLayer(e.target.value as 'semantic' | 'episodic' | 'project' | 'temporal')
                    }
                    className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#09090B] text-sm text-zinc-900 dark:text-zinc-100"
                  >
                    <option value="semantic">Semántica</option>
                    <option value="episodic">Episódica</option>
                    <option value="project">Proyectos</option>
                    <option value="temporal">Temporal</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">Naturaleza</label>
                  <select
                    value={newOriginKind}
                    onChange={(e) => setNewOriginKind(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#09090B] text-sm text-zinc-900 dark:text-zinc-100"
                  >
                    {Object.entries(ORIGIN_KIND_LABELS).map(([k, label]) => (
                      <option key={k} value={k}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">Categoría</label>
                  <input
                    type="text"
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#09090B] text-sm text-zinc-900 dark:text-zinc-100"
                  />
                </div>
                <div>
                  <label className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">
                    Importancia (1–5)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={5}
                    value={newImportance}
                    onChange={(e) => setNewImportance(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#09090B] text-sm text-zinc-900 dark:text-zinc-100 tabular-nums"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="Título breve..."
                  className="px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#09090B] text-sm text-zinc-900 dark:text-zinc-100"
                />
                <input
                  type="text"
                  value={newTags}
                  onChange={(e) => setNewTags(e.target.value)}
                  placeholder="Etiquetas separadas por coma (ej: facultad, finanzas)"
                  className="px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#09090B] text-sm text-zinc-900 dark:text-zinc-100"
                />
              </div>
              <textarea
                rows={2}
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
                placeholder="Qué querés que SILVV MEMORY recuerde siempre..."
                className="w-full px-3 py-2 rounded-xl border border-zinc-200/80 dark:border-white/10 bg-white/75 dark:bg-black/30 text-sm text-zinc-900 dark:text-zinc-100"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  className="px-4 py-2 rounded-xl glass-subtle text-xs font-medium text-zinc-600 dark:text-zinc-300 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving || !newContent.trim()}
                  className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium cursor-pointer"
                >
                  {saving ? 'Guardando...' : 'Guardar recuerdo'}
                </button>
              </div>
            </form>
          )}

          {/* Memories list */}
          <div className="glass-panel rounded-2xl divide-y divide-zinc-200/70 dark:divide-white/10">
            {loading ? (
              <div className="p-6 space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-14 rounded-xl bg-zinc-200/60 dark:bg-white/5 animate-pulse" />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <div className="p-10 text-center space-y-2">
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  No hay recuerdos en esta vista
                </p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  SILVV MEMORY guarda recuerdos relevantes automáticamente desde tus conversaciones y archivos.
                </p>
              </div>
            ) : (
              filtered.map((mem) => (
                <div
                  key={mem.id}
                  className={`px-5 py-4 flex items-start justify-between gap-4 ${
                    !mem.isActive ? 'opacity-55' : ''
                  }`}
                >
                  <div
                    onClick={() => handleOpenDetail(mem.id)}
                    className="min-w-0 space-y-1 flex-1 cursor-pointer group"
                  >
                    <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 group-hover:text-violet-500 transition-colors">
                      {mem.title || mem.category}
                    </p>
                    <p className="text-sm text-zinc-600 dark:text-zinc-300 leading-relaxed">
                      {mem.content}
                    </p>
                    {mem.sourceType === 'image' && mem.sourceFileId && (
                      <PrivateImagePreview
                        fileId={mem.sourceFileId}
                        alt={`Imagen adjunta al recuerdo ${mem.title || mem.category}`}
                        lazy
                        className="max-h-36 max-w-full rounded-xl object-contain bg-zinc-100 dark:bg-black/20"
                      />
                    )}
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 tabular-nums">
                      {LAYER_LABELS[mem.memoryLayer] || mem.memoryLayer} ·{' '}
                      {ORIGIN_KIND_LABELS[mem.originKind] || mem.originKind} · {mem.category} ·{' '}
                      Importancia {mem.importance}/5
                      {mem.tags && mem.tags.length > 0 ? ` · #${mem.tags.join(' #')}` : ''} ·{' '}
                      {new Date(mem.createdAt).toLocaleDateString('es-UY')}
                    </p>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleOpenDetail(mem.id)}
                      title="Ver ficha y origen"
                      className="p-2 rounded-lg border border-zinc-200 dark:border-zinc-800 text-zinc-500 hover:text-violet-500 cursor-pointer"
                    >
                      <Info className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleToggleActive(mem)}
                      title={mem.isActive ? 'Pausar recuerdo' : 'Reactivar recuerdo'}
                      className="p-2 rounded-lg border border-zinc-200 dark:border-zinc-800 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 cursor-pointer"
                    >
                      {mem.isActive ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(mem.id)}
                      title="Enviar a la papelera"
                      className="p-2 rounded-lg border border-zinc-200 dark:border-zinc-800 text-zinc-500 hover:text-red-600 dark:hover:text-red-400 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Memory Detail Modal (Ficha del recuerdo) */}
      {(detailLoading || detailModal) && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setDetailModal(null)}
        >
          <div
            className="w-full max-w-xl glass-elevated rounded-2xl p-6 space-y-4 max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="font-display text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                  {detailModal?.memory.title || detailModal?.memory.category || 'Ficha del recuerdo'}
                </h2>
                {detailModal && (
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 tabular-nums mt-0.5">
                    {LAYER_LABELS[detailModal.memory.memoryLayer] || detailModal.memory.memoryLayer} ·{' '}
                    {ORIGIN_KIND_LABELS[detailModal.memory.originKind] || detailModal.memory.originKind} ·{' '}
                    {new Date(detailModal.memory.createdAt).toLocaleString('es-UY')}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setDetailModal(null)}
                className="p-1.5 text-zinc-400 hover:text-zinc-200 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {detailLoading || !detailModal ? (
              <p className="text-sm text-zinc-500">Cargando origen y relaciones...</p>
            ) : (
              <div className="space-y-4 text-sm">
                <div className="p-4 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#09090B]">
                  <p className="text-zinc-900 dark:text-zinc-100 leading-relaxed">
                    {detailModal.memory.content}
                  </p>
                </div>

                {detailModal.entities.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                      Relaciones y entidades detectadas
                    </p>
                    <p className="text-xs text-zinc-700 dark:text-zinc-300">
                      {detailModal.entities.map((e) => e.entityName).join(' · ')}
                    </p>
                  </div>
                )}

                {detailModal.sourceMessage && (
                  <div className="space-y-1.5 pt-2 border-t border-zinc-200 dark:border-zinc-800">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                        Origen en conversación #{detailModal.sourceMessage.conversationId}
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          setDetailModal(null);
                          onGoToChat();
                        }}
                        className="inline-flex items-center gap-1 text-xs text-violet-600 dark:text-violet-400 hover:underline cursor-pointer"
                      >
                        <span>Ir al chat</span>
                        <ExternalLink className="w-3 h-3" />
                      </button>
                    </div>
                    <p className="text-xs text-zinc-600 dark:text-zinc-300 italic bg-zinc-50 dark:bg-[#09090B] p-3 rounded-lg border border-zinc-200 dark:border-zinc-800">
                      "{detailModal.sourceMessage.content}"
                    </p>
                    {detailModal.sourceMessage.attachments?.some(
                      (attachment) => attachment.fileId && attachment.mimeType?.startsWith('image/'),
                    ) && (
                      <div className="flex flex-wrap gap-2">
                        {detailModal.sourceMessage.attachments
                          .filter((attachment) => attachment.fileId && attachment.mimeType?.startsWith('image/'))
                          .map((attachment) => (
                            <PrivateImagePreview
                              key={attachment.id}
                              fileId={attachment.fileId!}
                              alt={attachment.fileName || 'Imagen del mensaje de origen'}
                              lazy
                              className="max-h-72 max-w-full rounded-xl object-contain bg-zinc-100 dark:bg-black/20"
                            />
                          ))}
                      </div>
                    )}
                  </div>
                )}

                {detailModal.sourceFile && (
                  <div className="space-y-1 pt-2 border-t border-zinc-200 dark:border-zinc-800">
                    <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                      Archivo de origen
                    </p>
                    <p className="text-xs font-medium text-zinc-800 dark:text-zinc-200">
                      {detailModal.sourceFile.displayName}
                    </p>
                    {detailModal.sourceFile.fileKind === 'image' &&
                      !detailModal.sourceMessage?.attachments?.some(
                        (attachment) => attachment.fileId === detailModal.sourceFile?.id,
                      ) && (
                        <PrivateImagePreview
                          fileId={detailModal.sourceFile.id}
                          alt={detailModal.sourceFile.displayName}
                          lazy
                          className="max-h-72 max-w-full rounded-xl object-contain bg-zinc-100 dark:bg-black/20"
                        />
                      )}
                    {detailModal.sourceFile.aiSummary && (
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        {detailModal.sourceFile.aiSummary}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
