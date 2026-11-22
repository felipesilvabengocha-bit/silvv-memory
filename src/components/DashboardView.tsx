import { useState } from 'react';
import {
  ArrowUpRight,
  BookOpenText,
  Bot,
  Brain,
  Calendar,
  FileSearch,
  Folder,
  FolderKanban,
  History,
  MessageSquare,
  RefreshCw,
  Send,
  StickyNote,
} from 'lucide-react';
import { apiRequest, type DashboardData } from '../lib/api';

export type NavTab =
  | 'dashboard'
  | 'chat'
  | 'notes'
  | 'memory'
  | 'calendar'
  | 'summaries'
  | 'knowledge'
  | 'agents'
  | 'settings';

interface DashboardViewProps {
  data: DashboardData | null;
  loading: boolean;
  error: string | null;
  timezone: string;
  userName: string;
  onRefresh: () => void;
  onNavigate: (tab: NavTab, conversationId?: number) => void;
  onQuickSend: (text: string) => void;
}

export function DashboardView({
  data,
  loading,
  error,
  timezone,
  userName,
  onRefresh,
  onNavigate,
  onQuickSend,
}: DashboardViewProps) {
  const [quickInput, setQuickInput] = useState('');
  const [briefing, setBriefing] = useState<{
    headline: string;
    summary: string;
    nextFocus: string;
  } | null>(null);
  const [briefingLoading, setBriefingLoading] = useState(false);
  const [briefingError, setBriefingError] = useState<string | null>(null);

  const handleGenerateBriefing = async () => {
    setBriefingLoading(true);
    setBriefingError(null);
    try {
      const res = await apiRequest<{ headline: string; summary: string; nextFocus: string }>(
        '/api/dashboard/briefing',
        { method: 'POST' }
      );
      setBriefing(res);
    } catch (err) {
      setBriefingError(err instanceof Error ? err.message : 'No se pudo generar el resumen.');
    } finally {
      setBriefingLoading(false);
    }
  };

  const handleQuickSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = quickInput.trim();
    if (!trimmed) return;
    setQuickInput('');
    onQuickSend(trimmed);
  };

  const formatDateTime = (iso: string) => {
    try {
      return new Intl.DateTimeFormat('es-UY', {
        timeZone: timezone || 'America/Montevideo',
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(iso));
    } catch {
      return iso;
    }
  };

  if (loading && !data) {
    return (
      <div className="space-y-6">
        <div className="h-36 rounded-2xl glass-panel animate-pulse" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="h-64 rounded-2xl glass-panel animate-pulse" />
          <div className="h-64 rounded-2xl glass-panel animate-pulse" />
        </div>
      </div>
    );
  }

  const events = data?.upcomingEvents || [];
  const projects = data?.activeProjects || [];
  const memories = data?.recentMemories || [];
  const conversations = data?.recentConversations || [];
  const folders = data?.folders || [];
  const agents = data?.createdAgents || [];
  const notes = data?.recentNotes || [];
  const memoryEvents = data?.recentMemoryEvents || [];
  const latestDaily = data?.latestDailySummary || null;
  const latestWeekly = data?.latestWeeklySummary || null;
  const actions = data?.recentActions || [];

  return (
    <div className="space-y-6 animate-silvv-in">
      {error && (
        <div className="p-4 rounded-2xl border border-red-300 dark:border-red-900/60 bg-red-50/90 dark:bg-red-950/40 text-sm text-red-700 dark:text-red-300 flex items-center justify-between gap-4">
          <span>{error}</span>
          <button
            type="button"
            onClick={onRefresh}
            className="px-3 py-1.5 rounded-xl border border-red-300 dark:border-red-800 text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer"
          >
            Reintentar
          </button>
        </div>
      )}

      {/* Greeting + Quick Access to SILVV MEMORY */}
      <section className="glass-panel rounded-2xl p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              Hola, {userName}
            </h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">
              Resumen de tu actividad reciente, accesos rápidos y novedades en SILVV MEMORY.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleGenerateBriefing}
              disabled={briefingLoading}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl glass-subtle hover:bg-zinc-200/60 dark:hover:bg-white/10 text-xs font-medium text-zinc-800 dark:text-zinc-200 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${briefingLoading ? 'animate-spin' : ''}`} />
              <span>{briefingLoading ? 'Analizando...' : 'Resumen del día'}</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigate('chat')}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <MessageSquare className="w-3.5 h-3.5" />
              <span>Ir al Chat</span>
            </button>
          </div>
        </div>

        {briefingError && (
          <p className="text-xs text-red-600 dark:text-red-400">{briefingError}</p>
        )}

        {briefing && (
          <div className="pt-4 border-t border-zinc-200/70 dark:border-white/10 space-y-1.5">
            <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {briefing.headline}
            </p>
            <p className="text-sm text-zinc-600 dark:text-zinc-300 leading-relaxed">
              {briefing.summary}
            </p>
            <p className="text-xs font-medium text-violet-600 dark:text-violet-400 pt-1">
              Foco sugerido: {briefing.nextFocus}
            </p>
          </div>
        )}

        <form onSubmit={handleQuickSubmit} className="flex items-center gap-2.5 pt-1">
          <input
            type="text"
            value={quickInput}
            onChange={(e) => setQuickInput(e.target.value)}
            placeholder="Escribí una pregunta, idea, acontecimiento o nota rápida para iniciar en el Chat..."
            className="flex-1 min-w-0 px-4 py-2.5 rounded-xl border border-zinc-200/80 dark:border-white/10 bg-white/75 dark:bg-black/30 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
          />
          <button
            type="submit"
            disabled={!quickInput.trim()}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white text-sm font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <Send className="w-4 h-4" />
            <span className="hidden sm:inline">Enviar al Chat</span>
          </button>
        </form>

        {/* Quick access strip to the 7 core sections */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5 pt-1">
          {[
            { id: 'chat' as NavTab, label: 'Chat general', icon: MessageSquare },
            { id: 'notes' as NavTab, label: 'Notas', icon: StickyNote },
            { id: 'memory' as NavTab, label: 'Memoria', icon: Brain },
            { id: 'calendar' as NavTab, label: 'Agenda', icon: Calendar },
            { id: 'summaries' as NavTab, label: 'Resúmenes', icon: BookOpenText },
            { id: 'knowledge' as NavTab, label: 'Conocimiento', icon: FileSearch },
            { id: 'agents' as NavTab, label: 'Mis agentes', icon: Bot },
          ].map((sec) => {
            const Icon = sec.icon;
            return (
              <button
                key={sec.id}
                type="button"
                onClick={() => onNavigate(sec.id)}
                className="flex items-center gap-2 px-3 py-2.5 rounded-xl glass-subtle hover:border-violet-500/40 text-xs font-medium text-zinc-800 dark:text-zinc-200 transition-colors cursor-pointer text-left whitespace-nowrap shrink-0"
              >
                <Icon className="w-4 h-4 text-violet-600 dark:text-violet-400 shrink-0" />
                <span className="truncate">{sec.label}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Main 2-column grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Latest conversations + Recent memories */}
        <section className="glass-panel rounded-2xl p-6 space-y-6">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-base font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-zinc-400" />
                <span>Últimas conversaciones</span>
              </h2>
              <button
                type="button"
                onClick={() => onNavigate('chat')}
                className="inline-flex items-center gap-1 text-xs font-medium text-violet-600 dark:text-violet-400 hover:underline cursor-pointer whitespace-nowrap shrink-0"
              >
                <span>Abrir chat</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            </div>
            {conversations.length === 0 ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                Todavía no iniciaste conversaciones en el Chat general.
              </p>
            ) : (
              <ul className="divide-y divide-zinc-200/70 dark:divide-white/10">
                {conversations.slice(0, 4).map((c) => (
                  <li key={c.id} className="py-2">
                    <button
                      type="button"
                      onClick={() => onNavigate('chat', c.id)}
                      className="w-full flex items-center justify-between gap-3 text-left hover:text-violet-600 dark:hover:text-violet-400 transition-colors cursor-pointer"
                    >
                      <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                        {c.title}
                      </span>
                      <span className="text-xs font-mono tabular-nums text-zinc-500 shrink-0">
                        {formatDateTime(c.lastMessageAt)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="space-y-3 pt-4 border-t border-zinc-200/70 dark:border-white/10">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-base font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                <Brain className="w-4 h-4 text-zinc-400" />
                <span>Recuerdos recientes</span>
              </h2>
              <button
                type="button"
                onClick={() => onNavigate('memory')}
                className="inline-flex items-center gap-1 text-xs font-medium text-violet-600 dark:text-violet-400 hover:underline cursor-pointer whitespace-nowrap shrink-0"
              >
                <span>Explorar memoria</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            </div>
            {memories.length === 0 ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                Aún no hay recuerdos guardados automáticamente.
              </p>
            ) : (
              <ul className="divide-y divide-zinc-200/70 dark:divide-white/10">
                {memories.slice(0, 4).map((m) => (
                  <li key={m.id} className="py-2.5 space-y-0.5">
                    <p className="text-sm text-zinc-900 dark:text-zinc-100 line-clamp-2">
                      {m.content}
                    </p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 tabular-nums">
                      {m.memoryLayer} · {m.originKind} · {m.category}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* Upcoming events + Active projects */}
        <section className="glass-panel rounded-2xl p-6 space-y-6">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-base font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                <Calendar className="w-4 h-4 text-zinc-400" />
                <span>Próximos compromisos</span>
              </h2>
              <button
                type="button"
                onClick={() => onNavigate('calendar')}
                className="inline-flex items-center gap-1 text-xs font-medium text-violet-600 dark:text-violet-400 hover:underline cursor-pointer whitespace-nowrap shrink-0"
              >
                <span>Abrir agenda</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            </div>
            {events.length === 0 ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                No hay compromisos próximos programados.
              </p>
            ) : (
              <ul className="divide-y divide-zinc-200/70 dark:divide-white/10">
                {events.slice(0, 4).map((ev) => (
                  <li key={ev.id} className="py-2.5 flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                        {ev.title}
                      </p>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                        {ev.externalProvider === 'google' ? 'Google Calendar' : 'SILVV MEMORY'}
                        {ev.location ? ` · ${ev.location}` : ''}
                      </p>
                    </div>
                    <span className="text-xs font-mono tabular-nums text-zinc-500 shrink-0">
                      {formatDateTime(ev.startAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="space-y-3 pt-4 border-t border-zinc-200/70 dark:border-white/10">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-base font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                <FolderKanban className="w-4 h-4 text-zinc-400" />
                <span>Proyectos activos</span>
              </h2>
              <button
                type="button"
                onClick={() => onNavigate('memory')}
                className="inline-flex items-center gap-1 text-xs font-medium text-violet-600 dark:text-violet-400 hover:underline cursor-pointer whitespace-nowrap shrink-0"
              >
                <span>Ver proyectos</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            </div>
            {projects.length === 0 ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                Todavía no hay proyectos activos.
              </p>
            ) : (
              <ul className="divide-y divide-zinc-200/70 dark:divide-white/10">
                {projects.slice(0, 4).map((p) => (
                  <li key={p.id} className="py-2.5 space-y-1.5">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                        {p.name}
                      </span>
                      <span className="text-xs font-mono tabular-nums text-zinc-500 shrink-0">
                        {p.progressPercent}%
                      </span>
                    </div>
                    <div className="w-full h-1.5 rounded-full bg-zinc-200/70 dark:bg-white/10 overflow-hidden">
                      <div
                        className="h-full bg-violet-600 dark:bg-violet-500 rounded-full"
                        style={{ width: `${p.progressPercent}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>

      {/* New SILVV MEMORY Row: Recent Notes, Agenda Memoria, and Automatic Summaries */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <section className="glass-panel rounded-2xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
              <StickyNote className="w-4 h-4 text-zinc-400" />
              <span>Notas recientes</span>
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('notes')}
              className="text-xs font-medium text-violet-600 dark:text-violet-400 hover:underline cursor-pointer whitespace-nowrap"
            >
              Abrir notas
            </button>
          </div>
          {notes.length === 0 ? (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Creá notas manuales, notas rápidas o pedile al Chat que guarde una nota.
            </p>
          ) : (
            <ul className="divide-y divide-zinc-200/70 dark:divide-white/10">
              {notes.slice(0, 4).map((n) => (
                <li key={n.id} className="py-2 space-y-0.5">
                  <button
                    type="button"
                    onClick={() => onNavigate('notes')}
                    className="w-full text-left cursor-pointer hover:text-violet-600 dark:hover:text-violet-400 transition-colors"
                  >
                    <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                      {n.title || 'Sin título'}
                    </p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 tabular-nums truncate">
                      {n.isQuick ? 'Nota rápida' : 'Nota'}
                      {n.tags.length > 0 ? ` · #${n.tags.slice(0, 2).join(' #')}` : ''} ·{' '}
                      {formatDateTime(n.updatedAt)}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="glass-panel rounded-2xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
              <History className="w-4 h-4 text-zinc-400" />
              <span>Agenda Memoria reciente</span>
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('calendar')}
              className="text-xs font-medium text-violet-600 dark:text-violet-400 hover:underline cursor-pointer whitespace-nowrap"
            >
              Ver cronología
            </button>
          </div>
          {memoryEvents.length === 0 ? (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Aún no se registraron acontecimientos vividos o eventos temporales.
            </p>
          ) : (
            <ul className="divide-y divide-zinc-200/70 dark:divide-white/10">
              {memoryEvents.slice(0, 4).map((me) => (
                <li key={me.id} className="py-2 space-y-0.5">
                  <button
                    type="button"
                    onClick={() => onNavigate('calendar')}
                    className="w-full text-left cursor-pointer hover:text-violet-600 dark:hover:text-violet-400 transition-colors"
                  >
                    <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                      {me.title}
                    </p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 tabular-nums truncate">
                      {me.dateLabel || me.eventDate || 'Fecha no especificada'} · {me.category}
                      {me.people.length > 0 ? ` · ${me.people.slice(0, 2).join(', ')}` : ''}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="glass-panel rounded-2xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
              <BookOpenText className="w-4 h-4 text-zinc-400" />
              <span>Últimos resúmenes</span>
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('summaries')}
              className="text-xs font-medium text-violet-600 dark:text-violet-400 hover:underline cursor-pointer whitespace-nowrap"
            >
              Abrir sección
            </button>
          </div>
          {!latestDaily && !latestWeekly ? (
            <div className="space-y-2 py-2">
              <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
                Todavía no hay resúmenes periódicos generados. Podés generar tu resumen diario, semanal o mensual basado exclusivamente en tu actividad real.
              </p>
              <button
                type="button"
                onClick={() => onNavigate('summaries')}
                className="text-xs font-medium text-violet-600 dark:text-violet-400 hover:underline cursor-pointer"
              >
                Generar primer resumen
              </button>
            </div>
          ) : (
            <div className="divide-y divide-zinc-200/70 dark:divide-white/10">
              {latestDaily && (
                <button
                  type="button"
                  onClick={() => onNavigate('summaries')}
                  className="w-full py-2 text-left space-y-0.5 cursor-pointer hover:text-violet-600 dark:hover:text-violet-400 transition-colors"
                >
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 tabular-nums">
                    Diario · {latestDaily.periodKey}
                  </p>
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                    {latestDaily.title}
                  </p>
                  <p className="text-xs text-zinc-600 dark:text-zinc-400 line-clamp-2">
                    {latestDaily.narrative}
                  </p>
                </button>
              )}
              {latestWeekly && (
                <button
                  type="button"
                  onClick={() => onNavigate('summaries')}
                  className="w-full py-2 text-left space-y-0.5 cursor-pointer hover:text-violet-600 dark:hover:text-violet-400 transition-colors"
                >
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 tabular-nums">
                    Semanal · {latestWeekly.periodKey}
                  </p>
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                    {latestWeekly.title}
                  </p>
                  <p className="text-xs text-zinc-600 dark:text-zinc-400 line-clamp-2">
                    {latestWeekly.narrative}
                  </p>
                </button>
              )}
            </div>
          )}
        </section>
      </div>

      {/* Bottom 3-column strip: Modified folders, Created agents, Recent SILVV MEMORY activity */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <section className="glass-panel rounded-2xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
              <Folder className="w-4 h-4 text-zinc-400" />
              <span>Carpetas recientes</span>
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('memory')}
              className="text-xs text-violet-600 dark:text-violet-400 hover:underline cursor-pointer"
            >
              Abrir
            </button>
          </div>
          {folders.length === 0 ? (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">Sin carpetas creadas.</p>
          ) : (
            <ul className="divide-y divide-zinc-200/70 dark:divide-white/10">
              {folders.slice(0, 5).map((f) => (
                <li key={f.id} className="py-2 flex items-center justify-between gap-2 text-sm">
                  <span className="text-zinc-800 dark:text-zinc-200 truncate">{f.name}</span>
                  <span className="text-xs text-zinc-500 shrink-0">
                    {f.category || (f.isSystem ? 'Sistema' : 'Personal')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="glass-panel rounded-2xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
              <Bot className="w-4 h-4 text-zinc-400" />
              <span>Agentes creados</span>
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('agents')}
              className="text-xs text-violet-600 dark:text-violet-400 hover:underline cursor-pointer"
            >
              Gestionar
            </button>
          </div>
          {agents.length === 0 ? (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Todavía no creaste agentes personalizados.
            </p>
          ) : (
            <ul className="divide-y divide-zinc-200/70 dark:divide-white/10">
              {agents.slice(0, 5).map((ag) => (
                <li key={ag.id} className="py-2 flex items-center justify-between gap-2 text-sm">
                  <span className="text-zinc-800 dark:text-zinc-200 truncate">{ag.name}</span>
                  <span className="text-xs text-zinc-500 shrink-0">
                    {ag.permissionMode === 'docs_only' ? 'Solo docs' : 'Con memoria'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="glass-panel rounded-2xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Actividad de SILVV MEMORY
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('settings')}
              className="text-xs text-violet-600 dark:text-violet-400 hover:underline cursor-pointer"
            >
              Historial
            </button>
          </div>
          {actions.length === 0 ? (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Sin acciones recientes registradas.
            </p>
          ) : (
            <ul className="divide-y divide-zinc-200/70 dark:divide-white/10">
              {actions.slice(0, 5).map((act) => (
                <li key={act.id} className="py-2 flex items-center justify-between gap-2 text-xs">
                  <span className="text-zinc-800 dark:text-zinc-200 truncate">
                    {act.toolName} · {act.status}
                  </span>
                  <span className="font-mono tabular-nums text-zinc-500 shrink-0">
                    {formatDateTime(act.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
