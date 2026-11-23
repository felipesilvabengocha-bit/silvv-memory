import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import {
  Activity,
  ArrowRight,
  Brain,
  Calendar,
  Check,
  ChevronDown,
  Clock3,
  FileText,
  FolderKanban,
  MessageSquare,
  RefreshCw,
  Sparkles,
  Star,
  Users,
  X,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { apiRequest } from '../lib/api';
import { auth } from '../lib/firebase';
import type {
  InsightSourceType,
  PersonalInsight,
  PersonalInsightEvidence,
  PersonalInsightsResponse,
  PersonalInsightRefreshResponse,
} from '../lib/insight-types';

interface PersonalInsightsViewProps {
  onQuickSend: (text: string) => void;
  onOpenSource: (evidence: PersonalInsightEvidence) => void;
}

const SOURCE_LABELS: Record<InsightSourceType, string> = {
  message: 'Conversación',
  knowledge_message: 'Chat de conocimiento',
  agent_message: 'Conversación con agente',
  agent_memory: 'Memoria de agente',
  note: 'Nota',
  memory: 'Recuerdo',
  memory_event: 'Acontecimiento',
  person: 'Persona',
  project: 'Proyecto',
  task: 'Tarea',
  calendar_event: 'Agenda',
  file: 'Archivo',
};

const SOURCE_ICONS: Record<InsightSourceType, typeof FileText> = {
  message: MessageSquare,
  knowledge_message: MessageSquare,
  agent_message: MessageSquare,
  agent_memory: Brain,
  note: FileText,
  memory: Brain,
  memory_event: Calendar,
  person: Users,
  project: FolderKanban,
  task: Check,
  calendar_event: Calendar,
  file: FileText,
};

const CONFIDENCE_LABELS = {
  high: 'Alta',
  medium: 'Media',
  low: 'Inicial',
} as const;

function formatDate(value: string | null): string {
  if (!value) return 'Sin fecha precisa';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Sin fecha precisa';
  return new Intl.DateTimeFormat('es-UY', { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

function formatChartPeriod(value: string): string {
  const date = new Date(`${value}-01T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('es-UY', { month: 'short', year: '2-digit' }).format(date);
}

function getPeriodLabel(insight: PersonalInsight): string {
  if (!insight.periodStart && !insight.periodEnd) return 'Período sin fecha precisa';
  if (!insight.periodStart) return `Hasta ${formatDate(insight.periodEnd)}`;
  if (!insight.periodEnd) return `Desde ${formatDate(insight.periodStart)}`;
  if (insight.periodStart.slice(0, 10) === insight.periodEnd.slice(0, 10)) {
    return formatDate(insight.periodStart);
  }
  return `${formatDate(insight.periodStart)} – ${formatDate(insight.periodEnd)}`;
}

function makeChatContext(insight: PersonalInsight): string {
  const sourceNotes = insight.evidence
    .map((item) => `• ${item.title} (${formatDate(item.sourceDate)}): “${item.excerpt}”`)
    .join('\n');
  return [
    'Quiero continuar este tema a partir de un Insight personal de SILVV MEMORY.',
    `Descubrimiento: ${insight.title}`,
    `Observación: ${insight.narrative}`,
    `Límites de la interpretación: ${insight.rationale}`,
    `Confianza orientativa: ${CONFIDENCE_LABELS[insight.confidence].toLowerCase()}.`,
    insight.userCorrection ? `Corrección tuya: ${insight.userCorrection}` : '',
    'Fuentes reales que lo respaldan:',
    sourceNotes,
    'Ayudame a profundizar con cuidado: distinguí hechos explícitos de hipótesis y no agregues conclusiones que las fuentes no sostengan.',
  ].join('\n\n');
}

function InsightChart({ insight }: { insight: PersonalInsight }) {
  const visualization = insight.visualization;
  if (!visualization || visualization.kind === 'none' || visualization.points.length < 2) return null;

  const accessibleSummary = visualization.points
    .map((point) => `${formatChartPeriod(point.period)}: ${point.count}`)
    .join('; ');

  return (
    <figure className="rounded-2xl glass-subtle p-4 sm:p-5" aria-label={visualization.label}>
      <figcaption className="mb-3 flex items-center gap-2 text-xs font-medium text-zinc-700 dark:text-zinc-200">
        <Activity className="h-4 w-4 text-violet-500" aria-hidden="true" />
        {visualization.label}
      </figcaption>
      <div
        className="h-44 w-full"
        role="img"
        aria-label={`${visualization.label}. ${accessibleSummary}`}
      >
        <ResponsiveContainer width="100%" height="100%">
          {visualization.kind === 'bar' ? (
            <BarChart data={visualization.points} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="currentColor" strokeDasharray="4 5" opacity={0.12} />
              <XAxis
                dataKey="period"
                tickFormatter={formatChartPeriod}
                axisLine={false}
                tickLine={false}
                tick={{ fill: 'currentColor', fontSize: 10 }}
                tickMargin={9}
              />
              <YAxis
                allowDecimals={false}
                axisLine={false}
                tickLine={false}
                tick={{ fill: 'currentColor', fontSize: 10 }}
                width={30}
              />
              <Tooltip
                cursor={{ fill: 'rgb(var(--silvv-accent) / 0.08)' }}
                contentStyle={{
                  backgroundColor: 'rgb(var(--silvv-surface))',
                  borderColor: 'rgb(var(--silvv-border) / 0.18)',
                  color: 'rgb(var(--silvv-text))',
                  borderRadius: 12,
                }}
                labelFormatter={(label) => formatChartPeriod(String(label))}
                formatter={(value) => [value, 'Fuentes citadas']}
              />
              <Bar dataKey="count" fill="rgb(var(--silvv-accent))" radius={[5, 5, 0, 0]} maxBarSize={42} />
            </BarChart>
          ) : (
            <LineChart data={visualization.points} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="currentColor" strokeDasharray="4 5" opacity={0.12} />
              <XAxis
                dataKey="period"
                tickFormatter={formatChartPeriod}
                axisLine={false}
                tickLine={false}
                tick={{ fill: 'currentColor', fontSize: 10 }}
                tickMargin={9}
              />
              <YAxis
                allowDecimals={false}
                axisLine={false}
                tickLine={false}
                tick={{ fill: 'currentColor', fontSize: 10 }}
                width={30}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'rgb(var(--silvv-surface))',
                  borderColor: 'rgb(var(--silvv-border) / 0.18)',
                  color: 'rgb(var(--silvv-text))',
                  borderRadius: 12,
                }}
                labelFormatter={(label) => formatChartPeriod(String(label))}
                formatter={(value) => [value, 'Fuentes citadas']}
              />
              <Line
                type="monotone"
                dataKey="count"
                stroke="rgb(var(--silvv-accent))"
                strokeWidth={2.5}
                dot={{ r: 3, fill: 'rgb(var(--silvv-accent))' }}
                activeDot={{ r: 5 }}
              />
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
        Cada punto cuenta fuentes citadas en ese mes; no equivale al total de menciones del tema.
      </p>
    </figure>
  );
}

interface InsightCardProps {
  insight: PersonalInsight;
  featured?: boolean;
  onQuickSend: (text: string) => void;
  onOpenSource: (evidence: PersonalInsightEvidence) => void;
  onUpdated: (response: PersonalInsightsResponse) => void;
}

function InsightCard({ insight, featured = false, onQuickSend, onOpenSource, onUpdated }: InsightCardProps) {
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [questionOpen, setQuestionOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [asking, setAsking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [correction, setCorrection] = useState(insight.userCorrection || '');
  const [correcting, setCorrecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = async (patch: { isStarred?: boolean; dismissed?: boolean }) => {
    setSaving(true);
    setError(null);
    try {
      const response = await apiRequest<PersonalInsightsResponse>(`/api/insights/${insight.id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      onUpdated(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar el cambio.');
    } finally {
      setSaving(false);
    }
  };

  const saveCorrection = async () => {
    const value = correction.trim();
    if (!value) return;
    setCorrecting(true);
    setError(null);
    try {
      const response = await apiRequest<PersonalInsightsResponse>(`/api/insights/${insight.id}/correction`, {
        method: 'POST',
        body: JSON.stringify({ correction: value }),
      });
      onUpdated(response);
      setCorrectionOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar la corrección.');
    } finally {
      setCorrecting(false);
    }
  };

  const ask = async (text: string) => {
    setAsking(true);
    setError(null);
    setAnswer('');
    try {
      const response = await apiRequest<{ answer: string }>(`/api/insights/${insight.id}/question`, {
        method: 'POST',
        body: JSON.stringify({ question: text }),
      });
      setAnswer(response.answer);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo ampliar este insight.');
    } finally {
      setAsking(false);
    }
  };

  const askWhy = () => {
    const prompt = '¿Qué evidencia concreta sostiene este insight y cuáles son los límites de esa interpretación?';
    setQuestionOpen(true);
    setQuestion(prompt);
    void ask(prompt);
  };

  const SourceIcon = insight.evidence[0]
    ? SOURCE_ICONS[insight.evidence[0].sourceType]
    : FileText;

  return (
    <article
      className={`glass-panel rounded-3xl p-5 sm:p-6 ${featured ? 'border-violet-500/35 shadow-[0_18px_50px_-32px_rgba(124,58,237,0.5)]' : ''}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-600/10 px-2.5 py-1 text-[11px] font-medium text-violet-700 dark:text-violet-300">
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              {insight.dismissedAt ? insight.userCorrection ? 'Corregido por vos' : 'En el historial' : featured ? 'Descubrimiento destacado' : 'Descubrimiento'}
            </span>
            <span className="inline-flex items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
              <SourceIcon className="h-3.5 w-3.5" aria-hidden="true" />
              {insight.evidence.length} {insight.evidence.length === 1 ? 'fuente' : 'fuentes'}
            </span>
          </div>
          <h2 className={`${featured ? 'text-xl sm:text-2xl' : 'text-lg'} font-display font-semibold tracking-tight text-zinc-900 dark:text-zinc-50`}>
            {insight.title}
          </h2>
        </div>
        <button
          type="button"
          disabled={saving || Boolean(insight.dismissedAt)}
          aria-label={insight.isStarred ? 'Quitar de importantes' : 'Marcar como importante'}
          aria-pressed={insight.isStarred}
          title={insight.isStarred ? 'Quitar de importantes' : 'Marcar como importante'}
          onClick={() => void update({ isStarred: !insight.isStarred })}
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl glass-subtle text-zinc-500 transition-colors hover:text-amber-500 disabled:opacity-45"
        >
          <Star className={`h-4 w-4 ${insight.isStarred ? 'fill-amber-400 text-amber-500' : ''}`} aria-hidden="true" />
        </button>
      </div>

      <p className="mt-4 max-w-4xl text-sm leading-7 text-zinc-700 dark:text-zinc-300">
        {insight.narrative}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-y border-zinc-200/70 py-3 text-[11px] text-zinc-500 dark:border-white/10 dark:text-zinc-400">
        <span className="inline-flex items-center gap-1.5">
          <Activity className="h-3.5 w-3.5" aria-hidden="true" />
          Confianza orientativa: {CONFIDENCE_LABELS[insight.confidence]}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
          {getPeriodLabel(insight)}
        </span>
      </div>

      {insight.rationale && (
        <p className="mt-3 text-xs leading-6 text-zinc-500 dark:text-zinc-400">
          <span className="font-medium text-zinc-700 dark:text-zinc-300">Qué sostiene esta lectura: </span>
          {insight.rationale}
        </p>
      )}

      {insight.userCorrection && (
        <div className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3" role="note">
          <p className="text-[11px] font-semibold text-amber-800 dark:text-amber-200">Tu corrección guardada</p>
          <p className="mt-1 text-xs leading-5 text-zinc-700 dark:text-zinc-300">{insight.userCorrection}</p>
        </div>
      )}

      <div className="mt-4">
        <InsightChart insight={insight} />
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-expanded={sourcesOpen}
          onClick={() => setSourcesOpen((open) => !open)}
          className="inline-flex min-h-10 items-center gap-2 rounded-xl glass-subtle px-3.5 text-xs font-medium text-zinc-700 hover:border-violet-500/35 dark:text-zinc-200"
        >
          <SourceIcon className="h-3.5 w-3.5" aria-hidden="true" />
          Fuentes
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${sourcesOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
        </button>
        {!insight.dismissedAt && (
          <>
            <button
              type="button"
              onClick={() => onQuickSend(makeChatContext(insight))}
              className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-violet-600 px-3.5 text-xs font-medium text-white transition-colors hover:bg-violet-500"
            >
              <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
              Continuar en Chat
            </button>
            <button
              type="button"
              disabled={asking}
              onClick={askWhy}
              className="inline-flex min-h-10 items-center gap-2 rounded-xl glass-subtle px-3.5 text-xs font-medium text-zinc-700 hover:border-violet-500/35 disabled:opacity-50 dark:text-zinc-200"
            >
              {asking ? <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Activity className="h-3.5 w-3.5" aria-hidden="true" />}
              ¿Cómo llegaste a esto?
            </button>
            <button
              type="button"
              aria-expanded={correctionOpen}
              onClick={() => setCorrectionOpen((open) => !open)}
              className="inline-flex min-h-10 items-center gap-2 rounded-xl glass-subtle px-3.5 text-xs font-medium text-zinc-700 hover:border-violet-500/35 dark:text-zinc-200"
            >
              Corregir
            </button>
            <button
              type="button"
              aria-expanded={questionOpen}
              onClick={() => setQuestionOpen((open) => !open)}
              className="inline-flex min-h-10 items-center gap-2 rounded-xl glass-subtle px-3.5 text-xs font-medium text-zinc-700 hover:border-violet-500/35 dark:text-zinc-200"
            >
              Preguntar
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void update({ dismissed: true })}
              className="ml-auto inline-flex min-h-10 items-center gap-2 rounded-xl px-3 text-xs font-medium text-zinc-500 transition-colors hover:text-zinc-900 disabled:opacity-50 dark:text-zinc-400 dark:hover:text-zinc-100"
            >
              Descartar
            </button>
          </>
        )}
        {insight.dismissedAt && (
          <button
            type="button"
            disabled={saving}
            onClick={() => void update({ dismissed: false })}
            className="inline-flex min-h-10 items-center gap-2 rounded-xl glass-subtle px-3.5 text-xs font-medium text-zinc-700 hover:border-violet-500/35 disabled:opacity-50 dark:text-zinc-200"
          >
            <Check className="h-3.5 w-3.5" aria-hidden="true" />
            Restaurar
          </button>
        )}
      </div>

      {sourcesOpen && (
        <ul className="mt-4 flex flex-col gap-2.5" aria-label={`Fuentes de ${insight.title}`}>
          {insight.evidence.map((item) => {
            const Icon = SOURCE_ICONS[item.sourceType];
            return (
              <li key={item.sourceKey} className="rounded-2xl glass-subtle p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2 text-xs font-medium text-zinc-800 dark:text-zinc-200">
                    <Icon className="h-3.5 w-3.5 shrink-0 text-violet-500" aria-hidden="true" />
                    <span className="truncate">{item.title}</span>
                    <span className="shrink-0 text-zinc-500 dark:text-zinc-400">· {SOURCE_LABELS[item.sourceType]}</span>
                  </div>
                  <span className="text-[11px] text-zinc-500 dark:text-zinc-400">{formatDate(item.sourceDate)}</span>
                </div>
                <blockquote className="mt-2 border-l-2 border-violet-500/40 pl-3 text-xs leading-6 text-zinc-600 dark:text-zinc-300">
                  {item.excerpt}
                </blockquote>
                <button
                  type="button"
                  onClick={() => onOpenSource(item)}
                  className="mt-3 inline-flex items-center gap-1.5 text-[11px] font-medium text-violet-700 hover:text-violet-500 dark:text-violet-300"
                >
                  Ir a la sección
                  <ArrowRight className="h-3 w-3" aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {correctionOpen && !insight.dismissedAt && (
        <section className="mt-4 rounded-2xl glass-subtle p-4" aria-label={`Corregir ${insight.title}`}>
          <label htmlFor={`insight-correction-${insight.id}`} className="mb-2 block text-xs font-medium text-zinc-700 dark:text-zinc-200">
            ¿Qué interpretación debería corregir?
          </label>
          <textarea
            id={`insight-correction-${insight.id}`}
            value={correction}
            onChange={(event) => setCorrection(event.target.value)}
            maxLength={1000}
            rows={2}
            placeholder="Aportá el contexto que falta o indicá qué conclusión no te representa."
            className="w-full resize-y rounded-xl border border-zinc-200/80 bg-white/70 px-3 py-2.5 text-sm text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 focus:border-violet-500/50 dark:border-white/10 dark:bg-black/20 dark:text-zinc-100"
          />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
            <span className="text-[11px] text-zinc-500 dark:text-zinc-400">La corrección se guarda y este hallazgo pasa al historial.</span>
            <button
              type="button"
              disabled={!correction.trim() || correcting}
              onClick={() => void saveCorrection()}
              className="inline-flex min-h-9 items-center gap-2 rounded-xl bg-violet-600 px-3.5 text-xs font-medium text-white disabled:opacity-50"
            >
              {correcting ? <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
              {correcting ? 'Guardando…' : 'Guardar corrección'}
            </button>
          </div>
        </section>
      )}

      {questionOpen && !insight.dismissedAt && (
        <section className="mt-4 rounded-2xl glass-subtle p-4" aria-label={`Preguntar sobre ${insight.title}`}>
          <label htmlFor={`insight-question-${insight.id}`} className="mb-2 block text-xs font-medium text-zinc-700 dark:text-zinc-200">
            Preguntá sobre este descubrimiento
          </label>
          <textarea
            id={`insight-question-${insight.id}`}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            maxLength={1000}
            rows={2}
            placeholder="¿Qué cambió entre estos períodos? ¿Qué evidencia lo limita?"
            className="w-full resize-y rounded-xl border border-zinc-200/80 bg-white/70 px-3 py-2.5 text-sm text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 focus:border-violet-500/50 dark:border-white/10 dark:bg-black/20 dark:text-zinc-100"
          />
          <div className="mt-2 flex items-center justify-between gap-3">
            <span className="text-[11px] text-zinc-500 dark:text-zinc-400">La respuesta se limita a las fuentes citadas.</span>
            <button
              type="button"
              disabled={!question.trim() || asking}
              onClick={() => void ask(question)}
              className="inline-flex min-h-9 items-center gap-2 rounded-xl bg-violet-600 px-3.5 text-xs font-medium text-white disabled:opacity-50"
            >
              {asking ? <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
              {asking ? 'Analizando…' : 'Preguntar'}
            </button>
          </div>
          {answer && (
            <p className="mt-3 rounded-xl border border-violet-500/15 bg-violet-600/5 p-3 text-sm leading-6 text-zinc-700 dark:text-zinc-200" aria-live="polite">
              {answer}
            </p>
          )}
        </section>
      )}

      {error && (
        <div className="mt-4 flex items-start justify-between gap-3 rounded-xl border border-red-300/70 bg-red-50/80 p-3 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/25 dark:text-red-300" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Cerrar error" className="shrink-0">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      )}
    </article>
  );
}

export function PersonalInsightsView({ onQuickSend, onOpenSource }: PersonalInsightsViewProps) {
  const uid = auth.currentUser?.uid;
  const cacheKey = uid ? `personal-insights:${uid}` : null;
  const { data, error, isLoading, mutate } = useSWR<PersonalInsightsResponse>(
    cacheKey,
    () => apiRequest<PersonalInsightsResponse>('/api/insights'),
    { revalidateOnFocus: false, revalidateOnReconnect: true, revalidateOnMount: true },
  );
  const [view, setView] = useState<'discoveries' | 'history'>('discoveries');
  const [refreshing, setRefreshing] = useState<'incremental' | 'deep' | null>(null);
  const [sourceChanged, setSourceChanged] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    const markSourcesChanged = () => {
      setSourceChanged(true);
      void mutate();
    };
    window.addEventListener('silvv:organization-change', markSourcesChanged);
    return () => window.removeEventListener('silvv:organization-change', markSourcesChanged);
  }, [mutate]);

  const activeInsights = useMemo(
    () => (data?.insights || []).filter((insight) => !insight.dismissedAt),
    [data?.insights],
  );
  const dismissedInsights = useMemo(
    () => (data?.insights || []).filter((insight) => Boolean(insight.dismissedAt)),
    [data?.insights],
  );
  const visibleInsights = view === 'history' ? dismissedInsights : activeInsights;
  const featuredInsight = view === 'discoveries' ? visibleInsights[0] : null;

  const handleRefresh = async (deep: boolean) => {
    setRefreshing(deep ? 'deep' : 'incremental');
    setNotice(null);
    setActionError(null);
    try {
      const response = await apiRequest<PersonalInsightRefreshResponse>('/api/insights/refresh', {
        method: 'POST',
        body: JSON.stringify({ deep }),
      });
      await mutate(response, { revalidate: false });
      setSourceChanged(false);
      if (response.sourceCount === 0) {
        setNotice('Todavía no hay información de la cuenta que analizar. No se generaron estadísticas de ejemplo.');
      } else if (!response.analyzed) {
        setNotice('El análisis está al día; no hizo falta volver a procesar tus fuentes.');
      } else if (response.generatedCount === 0) {
        setNotice('El análisis se actualizó con la información nueva, sin agregar descubrimientos redundantes.');
      } else {
        setNotice(`Análisis actualizado con ${response.generatedCount} ${response.generatedCount === 1 ? 'descubrimiento nuevo' : 'descubrimientos nuevos'}.`);
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'No se pudo actualizar Insights.');
    } finally {
      setRefreshing(null);
    }
  };

  const handleUpdated = async (response: PersonalInsightsResponse) => {
    await mutate(response, { revalidate: false });
  };

  const sourceCount = data?.sourceCount || 0;
  const needsUpdate = Boolean(data?.needsUpdate || sourceChanged);
  const isEmpty = !isLoading && !error && sourceCount === 0;

  return (
    <main className="animate-silvv-in space-y-6 pb-8">
      <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-2xl">
          <p className="mb-2 inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-violet-600 dark:text-violet-300">
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            Lectura personal, con evidencia
          </p>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-3xl">
            Insights personales
          </h1>
          <p className="mt-2 text-sm leading-6 text-zinc-500 dark:text-zinc-400">
            Descubrimientos abiertos sobre tus conversaciones, recuerdos, notas y proyectos. Cada conclusión muestra qué fuentes la sostienen y qué límites tiene.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={Boolean(refreshing) || isLoading || sourceCount === 0}
            onClick={() => void handleRefresh(false)}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-violet-600 px-4 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing === 'incremental' ? 'animate-spin' : ''}`} aria-hidden="true" />
            {refreshing === 'incremental' ? 'Actualizando…' : 'Actualizar análisis'}
          </button>
          <button
            type="button"
            disabled={Boolean(refreshing) || isLoading || sourceCount === 0}
            onClick={() => void handleRefresh(true)}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl glass-subtle px-4 text-xs font-semibold text-zinc-700 transition-colors hover:border-violet-500/35 disabled:cursor-not-allowed disabled:opacity-50 dark:text-zinc-200"
          >
            {refreshing === 'deep' ? <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Activity className="h-3.5 w-3.5" aria-hidden="true" />}
            Análisis profundo
          </button>
        </div>
      </header>

      {sourceCount > 0 && (
        <section className="flex flex-col gap-3 rounded-2xl glass-panel p-4 sm:flex-row sm:items-center sm:justify-between sm:px-5" aria-label="Estado del análisis">
          <div className="flex items-start gap-3">
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-600/10 text-violet-600 dark:text-violet-300">
              <Activity className="h-4 w-4" aria-hidden="true" />
            </span>
            <div>
              <p className="text-sm font-medium text-zinc-800 dark:text-zinc-100">
                {sourceCount} {sourceCount === 1 ? 'registro disponible' : 'registros disponibles'} para analizar
              </p>
              <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                {data?.lastAnalyzedAt
                  ? `Último análisis: ${formatDate(data.lastAnalyzedAt)}`
                  : 'Todavía no se ejecutó un análisis.'}
                {' '}Los gráficos cuentan solo fuentes citadas; no miden cercanía ni calidad de una relación.
              </p>
            </div>
          </div>
          {needsUpdate && (
            <span className="inline-flex items-center gap-1.5 self-start rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1.5 text-[11px] font-medium text-amber-800 dark:text-amber-200 sm:self-auto">
              <Activity className="h-3.5 w-3.5" aria-hidden="true" />
              Hay fuentes nuevas o modificadas
            </span>
          )}
        </section>
      )}

      {(actionError || error) && (
        <div className="flex items-start justify-between gap-3 rounded-xl border border-red-300/70 bg-red-50/80 p-3.5 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/25 dark:text-red-300" role="alert">
          <span>{actionError || (error instanceof Error ? error.message : 'No se pudieron cargar tus Insights.')}</span>
          <button type="button" onClick={() => setActionError(null)} aria-label="Cerrar error" className="shrink-0">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      )}

      {notice && (
        <div className="flex items-start justify-between gap-3 rounded-xl border border-emerald-300/70 bg-emerald-50/80 p-3.5 text-sm text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/25 dark:text-emerald-200" role="status" aria-live="polite">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Cerrar aviso" className="shrink-0">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      )}

      {isLoading && (
        <section className="space-y-4" aria-label="Cargando Insights" aria-busy="true">
          <div className="h-24 rounded-2xl glass-panel animate-pulse" />
          <div className="h-72 rounded-3xl glass-panel animate-pulse" />
        </section>
      )}

      {isEmpty && (
        <section className="glass-panel rounded-3xl px-6 py-12 text-center sm:px-10">
          <span className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-600/10 text-violet-600 dark:text-violet-300">
            <Sparkles className="h-6 w-6" aria-hidden="true" />
          </span>
          <h2 className="mt-5 font-display text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            Tus descubrimientos empiezan con tu propio contexto
          </h2>
          <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-zinc-500 dark:text-zinc-400">
            Todavía no hay conversaciones, notas, recuerdos ni proyectos disponibles en esta cuenta de prueba. Cuando haya información real, Insights podrá buscar conexiones sin completar estadísticas ficticias.
          </p>
          <button
            type="button"
            onClick={() => onQuickSend('Quiero empezar a guardar ideas y experiencias importantes para poder volver a ellas más adelante.')}
            className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-xl glass-subtle px-4 text-xs font-semibold text-zinc-700 hover:border-violet-500/35 dark:text-zinc-200"
          >
            Ir al Chat
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </section>
      )}

      {!isLoading && !isEmpty && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-base font-semibold text-zinc-900 dark:text-zinc-100">
                {view === 'history' ? 'Historial de descubrimientos' : 'Lo que empieza a tomar forma'}
              </h2>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                {view === 'history' ? 'Los insights descartados se conservan aquí y no vuelven a aparecer automáticamente.' : 'Sin categorías obligatorias: cada hallazgo se organiza según la evidencia disponible.'}
              </p>
            </div>
            <div className="inline-flex items-center gap-1 rounded-xl glass-subtle p-1" role="group" aria-label="Vista de insights">
              <button
                type="button"
                aria-pressed={view === 'discoveries'}
                onClick={() => setView('discoveries')}
                className={`min-h-9 rounded-lg px-3 text-xs font-medium transition-colors ${view === 'discoveries' ? 'bg-white text-zinc-900 shadow-sm dark:bg-[#1E1E26] dark:text-zinc-50' : 'text-zinc-500 dark:text-zinc-400'}`}
              >
                Descubrimientos ({activeInsights.length})
              </button>
              <button
                type="button"
                aria-pressed={view === 'history'}
                onClick={() => setView('history')}
                className={`min-h-9 rounded-lg px-3 text-xs font-medium transition-colors ${view === 'history' ? 'bg-white text-zinc-900 shadow-sm dark:bg-[#1E1E26] dark:text-zinc-50' : 'text-zinc-500 dark:text-zinc-400'}`}
              >
                Historial ({dismissedInsights.length})
              </button>
            </div>
          </div>

          {visibleInsights.length === 0 ? (
            <section className="glass-panel rounded-3xl px-6 py-12 text-center">
              <span className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-500 dark:bg-white/5 dark:text-zinc-400">
                {view === 'history' ? <Clock3 className="h-5 w-5" aria-hidden="true" /> : <Sparkles className="h-5 w-5" aria-hidden="true" />}
              </span>
              <h3 className="mt-4 font-display text-base font-semibold text-zinc-900 dark:text-zinc-100">
                {view === 'history' ? 'Todavía no hay descubrimientos descartados' : 'Aún no hay un patrón suficientemente respaldado'}
              </h3>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-zinc-500 dark:text-zinc-400">
                {view === 'history'
                  ? 'Los descubrimientos que descartes aparecerán aquí.'
                  : 'Podés actualizar el análisis cuando quieras. Si la evidencia no alcanza, Insights lo indicará en lugar de inventar una conclusión.'}
              </p>
              {view === 'discoveries' && (
                <button
                  type="button"
                  disabled={Boolean(refreshing)}
                  onClick={() => void handleRefresh(false)}
                  className="mt-5 inline-flex min-h-10 items-center gap-2 rounded-xl bg-violet-600 px-4 text-xs font-semibold text-white disabled:opacity-50"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
                  Analizar fuentes nuevas
                </button>
              )}
            </section>
          ) : (
            <div className="flex flex-col gap-4">
              {featuredInsight && (
                <InsightCard
                  key={featuredInsight.id}
                  insight={featuredInsight}
                  featured
                  onQuickSend={onQuickSend}
                  onOpenSource={onOpenSource}
                  onUpdated={handleUpdated}
                />
              )}
              {visibleInsights.slice(featuredInsight ? 1 : 0).map((insight) => (
                <InsightCard
                  key={insight.id}
                  insight={insight}
                  onQuickSend={onQuickSend}
                  onOpenSource={onOpenSource}
                  onUpdated={handleUpdated}
                />
              ))}
            </div>
          )}
        </>
      )}
    </main>
  );
}
