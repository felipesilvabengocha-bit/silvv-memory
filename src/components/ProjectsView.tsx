import { useEffect, useState } from 'react';
import { CheckCircle2, Circle, Plus, Star, Trash2 } from 'lucide-react';
import { apiRequest, type ProjectItem, type ProjectObjective } from '../lib/api';

interface ProjectsViewProps {
  onDataChanged: () => void;
}

const STATUS_LABELS: Record<ProjectItem['status'], string> = {
  idea: 'Idea',
  active: 'Activo',
  paused: 'Pausado',
  completed: 'Completado',
  archived: 'Archivado',
};

export function ProjectsView({ onDataChanged }: ProjectsViewProps) {
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('Trabajo');
  const [targetDate, setTargetDate] = useState('');
  const [objectivesText, setObjectivesText] = useState('');
  const [saving, setSaving] = useState(false);

  const loadProjects = async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await apiRequest<ProjectItem[]>('/api/projects');
      setProjects(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar proyectos.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProjects();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      const objectives = objectivesText
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);

      await apiRequest('/api/projects', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          category: category.trim() || 'General',
          targetDate: targetDate || undefined,
          objectives,
        }),
      });
      setName('');
      setDescription('');
      setTargetDate('');
      setObjectivesText('');
      setShowCreate(false);
      await loadProjects();
      onDataChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear el proyecto.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleObjective = async (project: ProjectItem, objId: string) => {
    const updatedObjectives: ProjectObjective[] = project.objectives.map((o) =>
      o.id === objId ? { ...o, done: !o.done } : o
    );
    try {
      const updated = await apiRequest<ProjectItem>(`/api/projects/${project.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ objectives: updatedObjectives }),
      });
      setProjects((prev) => prev.map((p) => (p.id === project.id ? updated : p)));
      onDataChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al actualizar objetivo.');
    }
  };

  const handleStatusChange = async (project: ProjectItem, status: ProjectItem['status']) => {
    try {
      const updated = await apiRequest<ProjectItem>(`/api/projects/${project.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      setProjects((prev) => prev.map((p) => (p.id === project.id ? updated : p)));
      onDataChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cambiar estado.');
    }
  };

  const handleTogglePriority = async (project: ProjectItem) => {
    try {
      const updated = await apiRequest<ProjectItem>(`/api/projects/${project.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isPriority: !project.isPriority }),
      });
      setProjects((prev) => prev.map((p) => (p.id === project.id ? updated : p)));
      onDataChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al actualizar prioridad.');
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await apiRequest(`/api/projects/${id}`, { method: 'DELETE' });
      setProjects((prev) => prev.filter((p) => p.id !== id));
      onDataChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al eliminar proyecto.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Proyectos
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Iniciativas, objetivos, fechas meta y progreso real conectado a tu contexto de SILVV MEMORY.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate((v) => !v)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>Nuevo proyecto</span>
        </button>
      </div>

      {error && (
        <div className="p-3.5 rounded-xl border border-red-300 dark:border-red-900/60 bg-red-50/90 dark:bg-red-950/30 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {showCreate && (
        <form
          onSubmit={handleCreate}
          className="glass-panel rounded-2xl p-6 space-y-4"
        >
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-1">
              <label className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">Nombre</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ej: Lanzamiento Q4"
                className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#09090B] text-sm text-zinc-900 dark:text-zinc-100"
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">Categoría</label>
              <input
                type="text"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#09090B] text-sm text-zinc-900 dark:text-zinc-100"
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">Fecha objetivo</label>
              <input
                type="date"
                value={targetDate}
                onChange={(e) => setTargetDate(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#09090B] text-sm text-zinc-900 dark:text-zinc-100 tabular-nums"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">Descripción</label>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Alcance, contexto o resultado esperado..."
              className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#09090B] text-sm text-zinc-900 dark:text-zinc-100"
            />
          </div>

          <div>
            <label className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">
              Objetivos (uno por línea)
            </label>
            <textarea
              rows={3}
              value={objectivesText}
              onChange={(e) => setObjectivesText(e.target.value)}
              placeholder={'Definir presupuesto\nCerrar cronograma\nRevisar entregables'}
              className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#09090B] text-sm text-zinc-900 dark:text-zinc-100"
            />
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              className="px-4 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 text-xs font-medium text-zinc-600 dark:text-zinc-300 cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving || !name.trim()}
              className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium cursor-pointer"
            >
              {saving ? 'Creando...' : 'Crear proyecto'}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {[1, 2].map((i) => (
            <div key={i} className="h-52 rounded-xl bg-zinc-200/70 dark:bg-zinc-900 animate-pulse" />
          ))}
        </div>
      ) : projects.length === 0 ? (
        <div className="glass-panel rounded-2xl p-10 text-center space-y-3">
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
            Todavía no hay proyectos activos
          </p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Creá un proyecto manualmente o describí una nueva iniciativa en el Chat general para que SILVV MEMORY la estructure.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {projects.map((p) => (
            <article
              key={p.id}
              className="glass-panel rounded-2xl p-6 space-y-4 flex flex-col justify-between"
            >
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="font-display text-lg font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                      {p.name}
                    </h2>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 tabular-nums">
                      {p.category || 'General'} · {STATUS_LABELS[p.status]}
                      {p.targetDate ? ` · Meta ${p.targetDate}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleTogglePriority(p)}
                      title="Marcar prioridad"
                      className={`p-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 cursor-pointer ${
                        p.isPriority ? 'text-amber-500' : 'text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      <Star className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(p.id)}
                      title="Enviar a papelera"
                      className="p-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 text-zinc-400 hover:text-red-500 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {p.description && (
                  <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
                    {p.description}
                  </p>
                )}

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400 tabular-nums">
                    <span>Progreso</span>
                    <span>{p.progressPercent}%</span>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
                    <div
                      className="h-full bg-violet-600 dark:bg-violet-500 rounded-full transition-all"
                      style={{ width: `${p.progressPercent}%` }}
                    />
                  </div>
                </div>

                {p.objectives && p.objectives.length > 0 && (
                  <ul className="space-y-1.5 pt-2 border-t border-zinc-200 dark:border-zinc-800/80">
                    {p.objectives.map((obj) => (
                      <li key={obj.id}>
                        <button
                          type="button"
                          onClick={() => handleToggleObjective(p, obj.id)}
                          className="w-full flex items-center gap-2.5 text-left text-sm py-1 text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-zinc-100 cursor-pointer"
                        >
                          {obj.done ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                          ) : (
                            <Circle className="w-4 h-4 text-zinc-400 shrink-0" />
                          )}
                          <span className={obj.done ? 'line-through text-zinc-400' : ''}>
                            {obj.title}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="pt-3 border-t border-zinc-200 dark:border-zinc-800/80 flex items-center justify-between gap-3">
                <label className="text-xs text-zinc-500 dark:text-zinc-400">Estado</label>
                <select
                  value={p.status}
                  onChange={(e) => handleStatusChange(p, e.target.value as ProjectItem['status'])}
                  className="px-2.5 py-1 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#09090B] text-xs text-zinc-800 dark:text-zinc-200"
                >
                  {Object.entries(STATUS_LABELS).map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
