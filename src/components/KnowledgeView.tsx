import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  BookOpen,
  FileSearch,
  Layers,
  PanelLeft,
  Plus,
  Send,
  X,
} from 'lucide-react';
import {
  apiRequest,
  type KnowledgeCitation,
  type KnowledgeConversation,
  type KnowledgeMessage,
} from '../lib/api';
import { MarkdownRenderer } from './MarkdownRenderer';

interface SourceDetailPayload {
  type: string;
  item: Record<string, unknown>;
}

const SOURCE_TYPE_LABELS: Record<string, string> = {
  memory: 'Recuerdo',
  file: 'Archivo',
  message: 'Mensaje',
  project: 'Proyecto',
  note: 'Nota',
  memory_event: 'Agenda Memoria',
};

export function KnowledgeView() {
  const [conversations, setConversations] = useState<KnowledgeConversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<number | null>(null);
  const [messages, setMessages] = useState<KnowledgeMessage[]>([]);
  const [deepMode, setDeepMode] = useState(false);
  const [question, setQuestion] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const [inspectedCitation, setInspectedCitation] = useState<KnowledgeCitation | null>(null);
  const [sourceDetail, setSourceDetail] = useState<SourceDetailPayload | null>(null);
  const [loadingSource, setLoadingSource] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);

  const loadConversations = async () => {
    try {
      const list = await apiRequest<KnowledgeConversation[]>('/api/knowledge/conversations');
      setConversations(list);
      if (list.length > 0 && !activeConvId) {
        setActiveConvId(list[0].id);
        setDeepMode(Boolean(list[0].deepMode));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar investigaciones.');
    }
  };

  const loadMessages = async (convId: number) => {
    setLoading(true);
    try {
      const res = await apiRequest<{
        conversation: KnowledgeConversation;
        messages: KnowledgeMessage[];
      }>(`/api/knowledge/conversations/${convId}/messages`);
      setMessages(res.messages);
      setDeepMode(Boolean(res.conversation.deepMode));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar mensajes.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadConversations();
  }, []);

  useEffect(() => {
    if (activeConvId) {
      loadMessages(activeConvId);
    } else {
      setMessages([]);
    }
  }, [activeConvId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, sending]);

  const handleNewSession = async () => {
    try {
      const created = await apiRequest<KnowledgeConversation>('/api/knowledge/conversations', {
        method: 'POST',
        body: JSON.stringify({
          title: `Investigación ${new Date().toLocaleDateString('es-UY')}`,
          deepMode,
        }),
      });
      setConversations((prev) => [created, ...prev]);
      setActiveConvId(created.id);
      setMessages([]);
      setDrawerOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear la investigación.');
    }
  };

  const handleAsk = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = question.trim();
    if (!trimmed || sending) return;

    setSending(true);
    setError(null);
    try {
      const res = await apiRequest<{
        conversationId: number;
        userMessage: KnowledgeMessage;
        assistantMessage: KnowledgeMessage;
      }>('/api/knowledge/ask', {
        method: 'POST',
        body: JSON.stringify({
          conversationId: activeConvId,
          question: trimmed,
          deepMode,
        }),
      });

      setQuestion('');
      if (!activeConvId) {
        setActiveConvId(res.conversationId);
        await loadConversations();
      }
      await loadMessages(res.conversationId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al consultar tu base personal.');
    } finally {
      setSending(false);
    }
  };

  const handleOpenCitation = async (cit: KnowledgeCitation) => {
    setInspectedCitation(cit);
    setLoadingSource(true);
    setSourceDetail(null);
    try {
      const res = await apiRequest<SourceDetailPayload>(
        `/api/knowledge/source?type=${encodeURIComponent(cit.sourceType)}&id=${cit.sourceId}`,
      );
      setSourceDetail(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo abrir la fuente original.');
      setInspectedCitation(null);
    } finally {
      setLoadingSource(false);
    }
  };

  return (
    <div className="relative h-full flex overflow-hidden">
      {/* Collapsible Investigations Drawer */}
      {drawerOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/45 lg:hidden"
            onClick={() => setDrawerOpen(false)}
          />
          <aside className="fixed inset-y-0 left-0 z-50 w-72 lg:static lg:z-10 lg:w-80 glass-elevated lg:glass-panel border-r border-zinc-200/70 dark:border-white/10 p-4 flex flex-col gap-3 overflow-hidden shrink-0">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-display text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                Investigaciones
              </h2>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleNewSession}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium cursor-pointer whitespace-nowrap"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Nueva</span>
                </button>
                <button
                  type="button"
                  onClick={() => setDrawerOpen(false)}
                  className="p-1.5 rounded-xl glass-subtle text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Investiga exclusivamente en tus recuerdos, notas, Agenda Memoria, documentos y proyectos.
            </p>

            <div className="space-y-1 overflow-y-auto flex-1 pr-1">
              {conversations.map((c) => {
                const active = c.id === activeConvId;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      setActiveConvId(c.id);
                      setDrawerOpen(false);
                    }}
                    className={`w-full text-left px-3 py-2 rounded-xl text-xs transition-colors cursor-pointer ${
                      active
                        ? 'bg-violet-600/15 text-violet-700 dark:text-violet-200 font-medium'
                        : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200/50 dark:hover:bg-white/5'
                    }`}
                  >
                    <p className="truncate">{c.title}</p>
                    <p className="text-[11px] text-zinc-500 tabular-nums mt-0.5">
                      {c.deepMode ? 'Análisis profundo' : 'Estándar'} ·{' '}
                      {new Date(c.updatedAt).toLocaleDateString('es-UY', {
                        day: '2-digit',
                        month: 'short',
                      })}
                    </p>
                  </button>
                );
              })}
            </div>
          </aside>
        </>
      )}

      {/* Full-Screen Main Knowledge RAG Stream */}
      <section className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        <div className="px-4 sm:px-6 py-2.5 border-b border-zinc-200/70 dark:border-white/10 glass-panel flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={() => setDrawerOpen((v) => !v)}
              title="Historial de investigaciones"
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl glass-subtle text-xs font-medium text-zinc-700 dark:text-zinc-200 cursor-pointer whitespace-nowrap shrink-0"
            >
              <PanelLeft className="w-4 h-4" />
              <span className="hidden sm:inline">Historial ({conversations.length})</span>
            </button>
            <div className="min-w-0">
              <h1 className="font-display text-sm sm:text-base font-semibold text-zinc-900 dark:text-zinc-50 flex items-center gap-2 truncate">
                <FileSearch className="w-4 h-4 text-violet-500 shrink-0" />
                <span className="truncate">Chat de conocimiento</span>
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setDeepMode((v) => !v)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                deepMode
                  ? 'bg-violet-600 text-white'
                  : 'glass-subtle text-zinc-700 dark:text-zinc-200'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Análisis profundo: {deepMode ? 'Activo' : 'Normal'}</span>
            </button>
            <button
              type="button"
              onClick={handleNewSession}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl glass-subtle text-xs font-medium cursor-pointer whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Nueva</span>
            </button>
          </div>
        </div>

        {error && (
          <div className="mx-4 sm:mx-8 mt-3 p-3 rounded-xl border border-red-300 dark:border-red-900/60 bg-red-50/80 dark:bg-red-950/30 text-xs text-red-700 dark:text-red-300 flex items-center justify-between gap-2 shrink-0">
            <span>{error}</span>
            <button type="button" onClick={() => setError(null)} className="cursor-pointer">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-4 sm:px-8 py-6">
          <div className="max-w-4xl mx-auto space-y-6">
            {loading ? (
              <div className="space-y-4">
                <div className="h-16 w-2/3 rounded-2xl bg-zinc-200/60 dark:bg-white/5 animate-pulse" />
                <div className="h-24 w-3/4 rounded-2xl bg-zinc-200/60 dark:bg-white/5 animate-pulse" />
              </div>
            ) : messages.length === 0 ? (
              <div className="max-w-xl mx-auto py-16 text-center space-y-3">
                <h2 className="font-display text-xl font-semibold text-zinc-900 dark:text-zinc-50">
                  Investigá exclusivamente tu base personal
                </h2>
                <p className="text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed">
                  SILVV MEMORY cruza tus notas, recuerdos, archivos, vivencias de Agenda Memoria y conversaciones previas sin usar internet. Probá preguntar: "¿Qué contradicciones hay entre mis notas?", "Resumí todo lo registrado sobre una persona o proyecto" o "¿Cómo evolucionó mi opinión sobre...?".
                </p>
              </div>
            ) : (
              messages.map((m) => {
                const isUser = m.role === 'user';
                return (
                  <div
                    key={m.id}
                    className={`flex flex-col ${
                      isUser ? 'items-end' : 'items-start'
                    } space-y-2 animate-silvv-in`}
                  >
                    <div
                      className={`max-w-3xl rounded-2xl px-4 py-3.5 text-sm leading-relaxed ${
                        isUser
                          ? 'bg-violet-600 text-white shadow-sm'
                          : 'glass-panel text-zinc-900 dark:text-zinc-100'
                      }`}
                    >
                      {isUser ? (
                        <p className="whitespace-pre-wrap">{m.content}</p>
                      ) : (
                        <MarkdownRenderer content={m.content} />
                      )}
                    </div>

                    {!isUser && m.metadata?.insufficientData && (
                      <div className="max-w-3xl flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400 px-1">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                        <span>
                          Información personal insuficiente en tu base para responder con certeza.
                        </span>
                      </div>
                    )}

                    {!isUser && m.citations && m.citations.length > 0 && (
                      <div className="max-w-3xl w-full space-y-1.5">
                        <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400 px-1">
                          Fuentes verificadas ({m.citations.length}) — tocá para abrir el original:
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {m.citations.map((cit, i) => (
                            <button
                              key={`${cit.sourceType}-${cit.sourceId}-${i}`}
                              type="button"
                              onClick={() => handleOpenCitation(cit)}
                              className="text-left p-3 rounded-xl glass-subtle hover:border-violet-500/50 transition-colors cursor-pointer space-y-0.5"
                            >
                              <div className="flex items-center justify-between gap-2 text-xs font-medium text-violet-600 dark:text-violet-400">
                                <span className="flex items-center gap-1.5 min-w-0">
                                  <BookOpen className="w-3 h-3 shrink-0" />
                                  <span className="truncate">{cit.title}</span>
                                </span>
                                <span className="text-[11px] text-zinc-400 shrink-0">
                                  {SOURCE_TYPE_LABELS[cit.sourceType] || cit.sourceType}
                                </span>
                              </div>
                              <p className="text-xs text-zinc-500 dark:text-zinc-400 line-clamp-2">
                                {cit.excerpt}
                              </p>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="text-[11px] text-zinc-500 dark:text-zinc-400 px-1 tabular-nums">
                      {isUser ? 'Vos' : 'Investigación SILVV MEMORY'} ·{' '}
                      {m.deepMode ? 'Profundo' : 'Estándar'} ·{' '}
                      {new Date(m.createdAt).toLocaleTimeString('es-UY', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </div>
                  </div>
                );
              })
            )}

            {sending && (
              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                {deepMode
                  ? 'Cruzando notas, Agenda Memoria, documentos y recuerdos en análisis profundo...'
                  : 'Buscando exclusivamente en tu base personal verificada...'}
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        </div>

        <form
          onSubmit={handleAsk}
          className="px-4 sm:px-8 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] border-t border-zinc-200/70 dark:border-white/10 glass-panel shrink-0"
        >
          <div className="max-w-4xl mx-auto flex items-end gap-2">
            <textarea
              rows={1}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleAsk(e);
                }
              }}
              placeholder="Preguntá únicamente sobre tus notas, recuerdos, Agenda Memoria, archivos y proyectos..."
              className="flex-1 min-w-0 resize-none px-4 py-2.5 min-h-[44px] max-h-36 rounded-xl border border-zinc-200/80 dark:border-white/10 bg-white/80 dark:bg-black/35 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
            />
            <button
              type="submit"
              disabled={sending || !question.trim()}
              className="inline-flex items-center justify-center gap-2 px-4 min-h-[44px] rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white text-sm font-medium cursor-pointer whitespace-nowrap shrink-0"
            >
              <Send className="w-4 h-4" />
              <span className="hidden sm:inline">Investigar</span>
            </button>
          </div>
        </form>
      </section>

      {/* Source Inspector Modal */}
      {inspectedCitation && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setInspectedCitation(null)}
        >
          <div
            className="w-full max-w-xl glass-elevated rounded-2xl p-6 space-y-4 max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs text-violet-600 dark:text-violet-400 font-medium">
                  Fuente original ({SOURCE_TYPE_LABELS[inspectedCitation.sourceType] || inspectedCitation.sourceType})
                </p>
                <h3 className="font-display text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                  {inspectedCitation.title}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setInspectedCitation(null)}
                className="p-1.5 text-zinc-400 hover:text-zinc-200 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {loadingSource ? (
              <p className="text-sm text-zinc-500">Cargando documento original...</p>
            ) : sourceDetail ? (
              <div className="space-y-3 text-sm text-zinc-700 dark:text-zinc-300">
                {sourceDetail.item.content ? (
                  <div className="glass-subtle p-4 rounded-xl">
                    <MarkdownRenderer content={String(sourceDetail.item.content)} />
                  </div>
                ) : null}
                {sourceDetail.item.description ? (
                  <div className="glass-subtle p-4 rounded-xl">
                    <MarkdownRenderer content={String(sourceDetail.item.description)} />
                  </div>
                ) : null}
                {sourceDetail.item.aiSummary ? (
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-zinc-500">Resumen</p>
                    <p className="leading-relaxed">{String(sourceDetail.item.aiSummary)}</p>
                  </div>
                ) : null}
                {sourceDetail.item.extractedText ? (
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-zinc-500">Texto extraído</p>
                    <pre className="whitespace-pre-wrap text-xs glass-subtle p-4 rounded-xl max-h-64 overflow-y-auto font-sans">
                      {String(sourceDetail.item.extractedText)}
                    </pre>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
