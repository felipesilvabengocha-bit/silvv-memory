import { useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  CalendarRange,
  Check,
  Download,
  FileText,
  RefreshCw,
  RotateCw,
  StickyNote,
  Trash2,
  X,
} from 'lucide-react';
import {
  apiRequest,
  type SummaryRecordItem,
  type SummarySourceItem,
} from '../lib/api';
import { MarkdownRenderer } from './MarkdownRenderer';

interface SummariesViewProps {
  onDataChanged: () => void;
  onNavigateToNotes?: () => void;
}

const SECTION_LABELS: Record<string, string> = {
  // Daily (6)
  miDia: 'Mi día',
  loMasImportante: 'Lo más importante',
  personas: 'Personas',
  ideasYPensamientos: 'Ideas y pensamientos',
  actividad: 'Actividad',
  pendientes: 'Pendientes',
  // Weekly (10)
  resumenGeneral: 'Resumen general',
  acontecimientosImportantes: 'Acontecimientos importantes',
  personasRelevantes: 'Personas relevantes',
  proyectosYAvances: 'Proyectos y avances',
  nuevasIdeas: 'Nuevas ideas',
  actividadesYCompromisos: 'Actividades y compromisos',
  temasMasConversados: 'Temas más conversados',
  cambiosVsSemanasAnteriores: 'Cambios respecto a semanas anteriores',
  proximosCompromisos: 'Próximos compromisos',
  relacionesDetectadas: 'Relaciones detectadas',
  // Monthly (12)
  cronologia: 'Cronología',
  principalesExperiencias: 'Principales experiencias',
  avancesPersonalesYProyectos: 'Avances personales y proyectos',
  actividadesAcademicas: 'Actividades académicas',
  actividadesPoliticas: 'Actividades políticas',
  personasYSituaciones: 'Personas y situaciones',
  temasRepetidos: 'Temas repetidos',
  cambiosDeOpinionesODecisiones: 'Cambios de opiniones o decisiones',
  objetivosAlcanzados: 'Objetivos alcanzados',
  objetivosPendientes: 'Objetivos pendientes',
};

function getSectionLabel(key: string): string {
  if (SECTION_LABELS[key]) return SECTION_LABELS[key];
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

export function SummariesView({ onDataChanged, onNavigateToNotes }: SummariesViewProps) {
  const [periodKind, setPeriodKind] = useState<'daily' | 'weekly' | 'monthly'>('daily');
  const [data, setData] = useState<{
    daily: SummaryRecordItem[];
    weekly: SummaryRecordItem[];
    monthly: SummaryRecordItem[];
  }>({ daily: [], weekly: [], monthly: [] });
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [customPeriodKey, setCustomPeriodKey] = useState('');

  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [syncingAuto, setSyncingAuto] = useState(false);
  const [savingNote, setSavingNote] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [sourcesModalOpen, setSourcesModalOpen] = useState(false);
  const [sourcesList, setSourcesList] = useState<SummarySourceItem[]>([]);
  const [loadingSources, setLoadingSources] = useState(false);

  const loadSummaries = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest<{
        daily: SummaryRecordItem[];
        weekly: SummaryRecordItem[];
        monthly: SummaryRecordItem[];
      }>('/api/summaries');
      setData(res);
      const list = res[periodKind];
      setSelectedId((prev) => {
        if (prev && list.some((s) => s.id === prev)) return prev;
        return list[0]?.id ?? null;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar resúmenes.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSummaries();
  }, []);

  const currentList = useMemo(() => data[periodKind] || [], [data, periodKind]);

  useEffect(() => {
    setSelectedId(currentList[0]?.id ?? null);
    setCustomPeriodKey('');
  }, [periodKind]);

  const activeSummary = useMemo(
    () => currentList.find((s) => s.id === selectedId) || currentList[0] || null,
    [currentList, selectedId],
  );

  const handleSyncAuto = async () => {
    setSyncingAuto(true);
    setError(null);
    setNotice(null);
    try {
      const res = await apiRequest<{ ok: boolean; importedCount: number }>(
        '/api/summaries/sync-auto',
        { method: 'POST' },
      );
      await loadSummaries();
      onDataChanged();
      setNotice(
        res.importedCount > 0
          ? `Se importaron ${res.importedCount} resúmenes generados automáticamente.`
          : 'Tus resúmenes automáticos están al día.',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al sincronizar resúmenes automáticos.');
    } finally {
      setSyncingAuto(false);
    }
  };

  const handleGenerate = async (forceRegenerate = false, overrideKey?: string) => {
    setGenerating(true);
    setError(null);
    setNotice(null);
    try {
      const created = await apiRequest<SummaryRecordItem>('/api/summaries/generate', {
        method: 'POST',
        body: JSON.stringify({
          periodKind,
          periodKey: overrideKey || customPeriodKey.trim() || undefined,
          forceRegenerate,
        }),
      });
      await loadSummaries();
      setSelectedId(created.id);
      onDataChanged();
      setNotice(`Resumen ${periodKind === 'daily' ? 'diario' : periodKind === 'weekly' ? 'semanal' : 'mensual'} generado.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo generar el resumen.');
    } finally {
      setGenerating(false);
    }
  };

  const handleInspectSources = async (sum: SummaryRecordItem) => {
    setSourcesModalOpen(true);
    setLoadingSources(true);
    setSourcesList([]);
    try {
      const rows = await apiRequest<SummarySourceItem[]>(
        `/api/summaries/${sum.periodKind}/${sum.id}/sources`,
      );
      setSourcesList(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron cargar las fuentes.');
      setSourcesModalOpen(false);
    } finally {
      setLoadingSources(false);
    }
  };

  const handleSaveAsNote = async (sum: SummaryRecordItem) => {
    setSavingNote(true);
    setError(null);
    try {
      const res = await apiRequest<{ ok: boolean; noteId: number }>(
        `/api/summaries/${sum.periodKind}/${sum.id}/save-note`,
        { method: 'POST' },
      );
      setData((prev) => ({
        ...prev,
        [sum.periodKind]: prev[sum.periodKind].map((s) =>
          s.id === sum.id ? { ...s, savedNoteId: res.noteId } : s,
        ),
      }));
      onDataChanged();
      setNotice('Resumen guardado en tu sección de Notas.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar como nota.');
    } finally {
      setSavingNote(false);
    }
  };

  const handleDeleteSummary = async (sum: SummaryRecordItem) => {
    try {
      await apiRequest(`/api/summaries/${sum.periodKind}/${sum.id}`, { method: 'DELETE' });
      const remaining = currentList.filter((s) => s.id !== sum.id);
      setData((prev) => ({
        ...prev,
        [sum.periodKind]: remaining,
      }));
      setSelectedId(remaining[0]?.id ?? null);
      onDataChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo eliminar el resumen.');
    }
  };

  const handleExport = (sum: SummaryRecordItem, format: 'md' | 'json') => {
    const content =
      format === 'json'
        ? JSON.stringify(sum, null, 2)
        : [
            `# ${sum.title}`,
            `Período: ${sum.periodKey} (${sum.periodStart.slice(0, 10)} a ${sum.periodEnd.slice(0, 10)})`,
            '',
            sum.narrative,
            '',
            ...Object.entries(sum.sections || {}).map(
              ([k, v]) => `## ${getSectionLabel(k)}\n${v}\n`,
            ),
          ].join('\n');

    const blob = new Blob([content], {
      type: format === 'json' ? 'application/json' : 'text/markdown;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `silvv-memory-${sum.periodKind}-${sum.periodKey}.${format}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6 animate-silvv-in">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Resúmenes inteligentes
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Síntesis diarias, semanales y mensuales generadas exclusivamente con tu actividad real en SILVV MEMORY.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <div className="inline-flex items-center gap-1 p-1 rounded-xl glass-subtle">
            {(
              [
                { id: 'daily', label: 'Diarios' },
                { id: 'weekly', label: 'Semanal' },
                { id: 'monthly', label: 'Mensual' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setPeriodKind(tab.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors whitespace-nowrap shrink-0 ${
                  periodKind === tab.id
                    ? 'bg-white dark:bg-[#1E1E26] text-zinc-900 dark:text-zinc-50 shadow-xs'
                    : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            disabled={syncingAuto}
            onClick={handleSyncAuto}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl glass-panel text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:border-violet-500/40 cursor-pointer whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncingAuto ? 'animate-spin' : ''}`} />
            <span>Sincronizar automáticos</span>
          </button>

          <button
            type="button"
            disabled={generating}
            onClick={() => handleGenerate(false)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-xs font-medium cursor-pointer whitespace-nowrap shrink-0"
          >
            <RotateCw className={`w-3.5 h-3.5 ${generating ? 'animate-spin' : ''}`} />
            <span>{generating ? 'Generando...' : 'Generar período actual'}</span>
          </button>
        </div>
      </div>

      {/* Period selector bar */}
      <div className="glass-panel rounded-2xl px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
          <CalendarRange className="w-4 h-4 text-violet-500 shrink-0" />
          <span>
            {periodKind === 'daily'
              ? 'Podés elegir cualquier día específico (YYYY-MM-DD):'
              : periodKind === 'weekly'
                ? 'Podés indicar una semana ISO (ej: 2026-W47):'
                : 'Podés elegir cualquier mes específico (YYYY-MM):'}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {periodKind === 'daily' ? (
            <input
              type="date"
              value={customPeriodKey}
              onChange={(e) => setCustomPeriodKey(e.target.value)}
              className="px-3 py-1.5 rounded-xl border border-zinc-200/80 dark:border-white/10 bg-white/70 dark:bg-black/30 text-xs tabular-nums"
            />
          ) : periodKind === 'monthly' ? (
            <input
              type="month"
              value={customPeriodKey}
              onChange={(e) => setCustomPeriodKey(e.target.value)}
              className="px-3 py-1.5 rounded-xl border border-zinc-200/80 dark:border-white/10 bg-white/70 dark:bg-black/30 text-xs tabular-nums"
            />
          ) : (
            <input
              type="text"
              value={customPeriodKey}
              onChange={(e) => setCustomPeriodKey(e.target.value)}
              placeholder="2026-W47"
              className="w-32 px-3 py-1.5 rounded-xl border border-zinc-200/80 dark:border-white/10 bg-white/70 dark:bg-black/30 text-xs tabular-nums"
            />
          )}
          <button
            type="button"
            disabled={generating || !customPeriodKey.trim()}
            onClick={() => handleGenerate(false, customPeriodKey.trim())}
            className="px-3.5 py-1.5 rounded-xl glass-subtle text-xs font-medium text-zinc-800 dark:text-zinc-200 disabled:opacity-40 cursor-pointer whitespace-nowrap shrink-0"
          >
            Generar fecha
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3.5 rounded-xl border border-red-300 dark:border-red-900/60 bg-red-50/80 dark:bg-red-950/30 text-sm text-red-700 dark:text-red-300 flex items-center justify-between gap-2">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} className="cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {notice && (
        <div className="p-3.5 rounded-xl border border-emerald-300 dark:border-emerald-900/60 bg-emerald-50/80 dark:bg-emerald-950/30 text-xs text-emerald-800 dark:text-emerald-300 flex items-center justify-between gap-2">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Historical Sidebar */}
        <aside className="lg:col-span-4 glass-panel rounded-2xl p-4 space-y-2.5 self-start max-h-[680px] overflow-y-auto">
          <div className="flex items-center justify-between px-1 pb-1">
            <h2 className="font-display text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Historial ({currentList.length})
            </h2>
          </div>

          {loading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-16 rounded-xl bg-zinc-200/60 dark:bg-white/5 animate-pulse" />
              ))}
            </div>
          ) : currentList.length === 0 ? (
            <div className="py-8 text-center space-y-2 px-3">
              <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                Sin resúmenes en esta categoría
              </p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Tocá "Generar período actual" para sintetizar tu actividad real sin inventar datos.
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {currentList.map((s) => {
                const active = activeSummary?.id === s.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setSelectedId(s.id)}
                    className={`w-full text-left p-3 rounded-xl transition-colors cursor-pointer space-y-1 ${
                      active
                        ? 'bg-violet-600/12 dark:bg-violet-500/18 border border-violet-500/40'
                        : 'glass-subtle hover:border-violet-500/30'
                    }`}
                  >
                    <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                      {s.title}
                    </p>
                    <p className="text-[11px] text-zinc-500 dark:text-zinc-400 tabular-nums">
                      {s.periodKey} · {s.generatedMode === 'auto' ? 'Automático' : 'Manual'}
                      {s.savedNoteId ? ' · Guardado en Notas' : ''}
                    </p>
                  </button>
                );
              })}
            </div>
          )}
        </aside>

        {/* Detail Card */}
        <section className="lg:col-span-8 glass-panel rounded-2xl p-6 space-y-6">
          {!activeSummary ? (
            <div className="py-16 text-center space-y-3 max-w-md mx-auto">
              <FileText className="w-7 h-7 text-zinc-400 mx-auto" />
              <p className="font-display text-base font-medium text-zinc-900 dark:text-zinc-100">
                Generá tu primer resumen real
              </p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
                SILVV MEMORY analiza tus conversaciones, notas, recuerdos, archivos y vivencias reales registradas durante el período, citando fuentes exactas sin inventar hechos.
              </p>
            </div>
          ) : (
            <>
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 pb-4 border-b border-zinc-200/70 dark:border-white/10">
                <div className="space-y-1 min-w-0">
                  <h2 className="font-display text-xl font-semibold text-zinc-900 dark:text-zinc-50">
                    {activeSummary.title}
                  </h2>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 tabular-nums">
                    Período {activeSummary.periodKey} · {activeSummary.periodStart.slice(0, 10)} al{' '}
                    {activeSummary.periodEnd.slice(0, 10)} ·{' '}
                    {activeSummary.generatedMode === 'auto' ? 'Generado automáticamente' : 'Generado manualmente'}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    disabled={generating}
                    onClick={() => handleGenerate(true, activeSummary.periodKey)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl glass-subtle text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:border-violet-500/40 cursor-pointer whitespace-nowrap"
                  >
                    <RotateCw className={`w-3.5 h-3.5 ${generating ? 'animate-spin' : ''}`} />
                    <span>Regenerar</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleInspectSources(activeSummary)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl glass-subtle text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:border-violet-500/40 cursor-pointer whitespace-nowrap"
                  >
                    <BookOpen className="w-3.5 h-3.5" />
                    <span>Fuentes</span>
                  </button>
                  {activeSummary.savedNoteId ? (
                    <button
                      type="button"
                      onClick={() => onNavigateToNotes?.()}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-emerald-600/15 text-emerald-700 dark:text-emerald-300 text-xs font-medium cursor-pointer whitespace-nowrap"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>Ver en Notas</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={savingNote}
                      onClick={() => handleSaveAsNote(activeSummary)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium cursor-pointer whitespace-nowrap"
                    >
                      <StickyNote className="w-3.5 h-3.5" />
                      <span>{savingNote ? 'Guardando...' : 'Guardar como nota'}</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleExport(activeSummary, 'md')}
                    title="Exportar Markdown"
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl glass-subtle text-xs text-zinc-600 dark:text-zinc-300 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>.md</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleExport(activeSummary, 'json')}
                    title="Exportar JSON"
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl glass-subtle text-xs text-zinc-600 dark:text-zinc-300 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>.json</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteSummary(activeSummary)}
                    title="Eliminar resumen"
                    className="p-1.5 rounded-xl glass-subtle text-zinc-500 hover:text-red-500 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div className="glass-subtle rounded-2xl p-4 sm:p-5">
                <MarkdownRenderer content={activeSummary.narrative} />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {Object.entries(activeSummary.sections || {}).map(([key, value]) => (
                  <article key={key} className="glass-subtle rounded-xl p-4 space-y-1.5">
                    <h3 className="font-display text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                      {getSectionLabel(key)}
                    </h3>
                    <div className="text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed">
                      <MarkdownRenderer content={String(value || 'Sin registros.')} />
                    </div>
                  </article>
                ))}
              </div>
            </>
          )}
        </section>
      </div>

      {/* Sources Modal */}
      {sourcesModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setSourcesModalOpen(false)}
        >
          <div
            className="w-full max-w-2xl glass-elevated rounded-2xl p-6 space-y-4 max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="font-display text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                  Fuentes reales utilizadas
                </h3>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Cada dato del resumen proviene exclusivamente de estos registros verificados.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSourcesModalOpen(false)}
                className="p-1.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {loadingSources ? (
              <p className="text-sm text-zinc-500">Cargando fuentes verificadas...</p>
            ) : sourcesList.length === 0 ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-400 py-6 text-center">
                No hubo registros de actividad guardados durante este período.
              </p>
            ) : (
              <ul className="divide-y divide-zinc-200/70 dark:divide-white/10">
                {sourcesList.map((src) => (
                  <li key={src.id} className="py-3 space-y-1">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                        {src.title}
                      </p>
                      <span className="text-[11px] text-zinc-500 dark:text-zinc-400 tabular-nums shrink-0">
                        {src.sourceType} {src.sourceDate ? `· ${src.sourceDate.slice(0, 10)}` : ''}
                      </span>
                    </div>
                    <p className="text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed">
                      {src.excerpt}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
