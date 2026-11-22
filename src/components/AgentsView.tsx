import { useEffect, useRef, useState } from 'react';
import {
  Archive,
  BookOpen,
  Bot,
  Brain,
  Briefcase,
  Code2,
  Copy,
  Edit3,
  FileUp,
  Plus,
  Send,
  Shield,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import {
  apiRequest,
  type AgentConversation,
  type AgentItem,
  type AgentKnowledgeSource,
  type AgentMemory,
  type AgentMessage,
  type AgentPermissionMode,
  type FolderItem,
} from '../lib/api';

const AGENT_ICONS: Array<{ id: string; label: string; Icon: typeof Bot }> = [
  { id: 'bot', label: 'Asistente', Icon: Bot },
  { id: 'brain', label: 'Estrategia', Icon: Brain },
  { id: 'book', label: 'Estudio', Icon: BookOpen },
  { id: 'briefcase', label: 'Trabajo', Icon: Briefcase },
  { id: 'code', label: 'Código', Icon: Code2 },
  { id: 'sparkles', label: 'Creativo', Icon: Sparkles },
  { id: 'shield', label: 'Auditor', Icon: Shield },
];

const PERMISSION_LABELS: Record<AgentPermissionMode, { title: string; desc: string }> = {
  docs_only: {
    title: 'Solo documentos propios (estricto · predeterminado)',
    desc: 'Aislamiento total: únicamente lee los archivos cargados en este agente.',
  },
  docs_and_agent_memory: {
    title: 'Documentos + memoria propia del agente',
    desc: 'Usa sus documentos y recuerda conversaciones previas dentro de este agente.',
  },
  docs_and_selected_folders: {
    title: 'Documentos + carpetas autorizadas de SILVV MEMORY',
    desc: 'Accede a sus documentos y únicamente a las carpetas de SILVV MEMORY que elijas abajo.',
  },
  full_personal_memory: {
    title: 'Acceso completo a tu memoria personal de SILVV MEMORY',
    desc: 'Autorizado a consultar tus recuerdos y archivos generales de SILVV MEMORY.',
  },
};

const AVAILABLE_TOOLS = [
  { id: 'search_agent_knowledge', label: 'Buscar en su base documental' },
  { id: 'summarize_documents', label: 'Resumir y sintetizar archivos' },
  { id: 'compare_sources', label: 'Comparar múltiples documentos' },
  { id: 'create_structured_notes', label: 'Generar esquemas y guías' },
];

export function AgentsView() {
  const [agents, setAgents] = useState<AgentItem[]>([]);
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Selected agent workspace
  const [selectedAgent, setSelectedAgent] = useState<AgentItem | null>(null);
  const [workspaceTab, setWorkspaceTab] = useState<'chat' | 'knowledge' | 'memories'>('chat');

  // Agent builder modal/panel
  const [builderOpen, setBuilderOpen] = useState(false);
  const [editingAgentId, setEditingAgentId] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [icon, setIcon] = useState('bot');
  const [instructions, setInstructions] = useState('');
  const [personality, setPersonality] = useState('Analítico, claro y estructurado');
  const [objective, setObjective] = useState('');
  const [responseStyle, setResponseStyle] = useState('Profesional, directo y accionable');
  const [depthLevel, setDepthLevel] = useState<'concise' | 'balanced' | 'deep'>('balanced');
  const [toolsEnabled, setToolsEnabled] = useState<string[]>(['search_agent_knowledge']);
  const [memoryEnabled, setMemoryEnabled] = useState(true);
  const [permissionMode, setPermissionMode] = useState<AgentPermissionMode>('docs_only');
  const [allowedFolderIds, setAllowedFolderIds] = useState<number[]>([]);
  const [savingAgent, setSavingAgent] = useState(false);

  // Selected agent data
  const [sources, setSources] = useState<AgentKnowledgeSource[]>([]);
  const [agentMemories, setAgentMemories] = useState<AgentMemory[]>([]);
  const [conversations, setConversations] = useState<AgentConversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<number | null>(null);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [sendingChat, setSendingChat] = useState(false);
  const [uploadingSource, setUploadingSource] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadAgents = async () => {
    setLoading(true);
    try {
      const [agList, fldList] = await Promise.all([
        apiRequest<AgentItem[]>('/api/agents'),
        apiRequest<FolderItem[]>('/api/folders'),
      ]);
      setAgents(agList);
      setFolders(fldList);
      if (selectedAgent) {
        const refreshed = agList.find((a) => a.id === selectedAgent.id) || null;
        setSelectedAgent(refreshed);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar agentes.');
    } finally {
      setLoading(false);
    }
  };

  const loadAgentWorkspace = async (agentId: number) => {
    try {
      const [srcs, convs, mems] = await Promise.all([
        apiRequest<AgentKnowledgeSource[]>(`/api/agents/${agentId}/sources`),
        apiRequest<AgentConversation[]>(`/api/agents/${agentId}/conversations`),
        apiRequest<AgentMemory[]>(`/api/agents/${agentId}/memories`),
      ]);
      setSources(srcs);
      setConversations(convs);
      setAgentMemories(mems);
      if (convs.length > 0) {
        setActiveConvId(convs[0].id);
        const msgs = await apiRequest<AgentMessage[]>(
          `/api/agents/${agentId}/conversations/${convs[0].id}/messages`
        );
        setMessages(msgs);
      } else {
        setActiveConvId(null);
        setMessages([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar espacio del agente.');
    }
  };

  useEffect(() => {
    loadAgents();
  }, []);

  useEffect(() => {
    if (selectedAgent) {
      loadAgentWorkspace(selectedAgent.id);
    }
  }, [selectedAgent?.id]);

  const openBuilder = (ag?: AgentItem) => {
    if (ag) {
      setEditingAgentId(ag.id);
      setName(ag.name);
      setDescription(ag.description || '');
      setIcon(ag.icon || 'bot');
      setInstructions(ag.instructions || '');
      setPersonality(ag.personality || '');
      setObjective(ag.objective || '');
      setResponseStyle(ag.responseStyle || '');
      setDepthLevel(ag.depthLevel || 'balanced');
      setToolsEnabled(ag.toolsEnabled || ['search_agent_knowledge']);
      setMemoryEnabled(Boolean(ag.memoryEnabled));
      setPermissionMode(ag.permissionMode || 'docs_only');
      setAllowedFolderIds(ag.allowedFolderIds || []);
    } else {
      setEditingAgentId(null);
      setName('');
      setDescription('');
      setIcon('bot');
      setInstructions('');
      setPersonality('Analítico, claro y estructurado');
      setObjective('');
      setResponseStyle('Profesional, directo y accionable');
      setDepthLevel('balanced');
      setToolsEnabled(['search_agent_knowledge']);
      setMemoryEnabled(true);
      setPermissionMode('docs_only');
      setAllowedFolderIds([]);
    }
    setBuilderOpen(true);
  };

  const handleSaveAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSavingAgent(true);
    setError(null);
    const body = {
      name: name.trim(),
      description: description.trim(),
      icon,
      instructions,
      personality,
      objective,
      responseStyle,
      depthLevel,
      toolsEnabled,
      memoryEnabled,
      permissionMode,
      allowedFolderIds: permissionMode === 'docs_and_selected_folders' ? allowedFolderIds : [],
    };
    try {
      let saved: AgentItem;
      if (editingAgentId) {
        saved = await apiRequest<AgentItem>(`/api/agents/${editingAgentId}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        });
      } else {
        saved = await apiRequest<AgentItem>('/api/agents', {
          method: 'POST',
          body: JSON.stringify(body),
        });
      }
      setBuilderOpen(false);
      await loadAgents();
      setSelectedAgent(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar el agente.');
    } finally {
      setSavingAgent(false);
    }
  };

  const handleDuplicate = async (ag: AgentItem) => {
    try {
      const copy = await apiRequest<AgentItem>(`/api/agents/${ag.id}/duplicate`, {
        method: 'POST',
      });
      await loadAgents();
      setSelectedAgent(copy);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al duplicar agente.');
    }
  };

  const handleArchiveToggle = async (ag: AgentItem) => {
    try {
      await apiRequest(`/api/agents/${ag.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isArchived: !ag.isArchived }),
      });
      await loadAgents();
      if (selectedAgent?.id === ag.id && !showArchived) {
        setSelectedAgent(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al archivar agente.');
    }
  };

  const handleDeleteAgent = async (id: number) => {
    try {
      await apiRequest(`/api/agents/${id}`, { method: 'DELETE' });
      if (selectedAgent?.id === id) setSelectedAgent(null);
      await loadAgents();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al eliminar agente.');
    }
  };

  const handleUploadAgentDocument = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!selectedAgent) return;
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      setError('El documento supera el límite de 20 MB.');
      return;
    }

    setUploadingSource(true);
    setError(null);
    try {
      const base64Data = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = typeof reader.result === 'string' ? reader.result : '';
          resolve(result.includes(',') ? result.split(',')[1] : result);
        };
        reader.readAsDataURL(file);
      });

      await apiRequest(`/api/agents/${selectedAgent.id}/sources`, {
        method: 'POST',
        body: JSON.stringify({
          name: file.name,
          mimeType: file.type || 'application/octet-stream',
          base64Data,
        }),
      });
      await loadAgentWorkspace(selectedAgent.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo procesar el documento.');
    } finally {
      setUploadingSource(false);
      e.target.value = '';
    }
  };

  const handleDeleteSource = async (sourceId: number) => {
    if (!selectedAgent) return;
    try {
      await apiRequest(`/api/agents/${selectedAgent.id}/sources/${sourceId}`, {
        method: 'DELETE',
      });
      setSources((prev) => prev.filter((s) => s.id !== sourceId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo quitar el documento.');
    }
  };

  const handleSendAgentChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAgent || !chatInput.trim() || sendingChat) return;
    setSendingChat(true);
    setError(null);
    try {
      const res = await apiRequest<{
        conversationId: number;
        userMessage: AgentMessage;
        assistantMessage: AgentMessage;
      }>(`/api/agents/${selectedAgent.id}/chat`, {
        method: 'POST',
        body: JSON.stringify({
          conversationId: activeConvId,
          message: chatInput.trim(),
        }),
      });
      setChatInput('');
      setActiveConvId(res.conversationId);
      const msgs = await apiRequest<AgentMessage[]>(
        `/api/agents/${selectedAgent.id}/conversations/${res.conversationId}/messages`
      );
      setMessages(msgs);
      const mems = await apiRequest<AgentMemory[]>(`/api/agents/${selectedAgent.id}/memories`);
      setAgentMemories(mems);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al conversar con el agente.');
    } finally {
      setSendingChat(false);
    }
  };

  const renderIcon = (iconId: string) => {
    const found = AGENT_ICONS.find((i) => i.id === iconId) || AGENT_ICONS[0];
    const Comp = found.Icon;
    return <Comp className="w-4 h-4 text-violet-600 dark:text-violet-400 shrink-0" />;
  };

  const visibleAgents = agents.filter((a) => (showArchived ? true : !a.isArchived));

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Mis agentes
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Creá asistentes especializados con documentos propios y aislamiento estricto de datos por defecto.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowArchived((v) => !v)}
            className="px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 text-xs font-medium text-zinc-600 dark:text-zinc-300 cursor-pointer whitespace-nowrap"
          >
            {showArchived ? 'Solo activos' : 'Ver archivados'}
          </button>
          <button
            type="button"
            onClick={() => openBuilder()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium cursor-pointer whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>Crear agente</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3.5 rounded-lg border border-red-300 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 text-sm text-red-700 dark:text-red-300 flex items-center justify-between">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} className="cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Library List */}
        <aside className="lg:col-span-4 space-y-3">
          {loading ? (
            <div className="space-y-3">
              {[1, 2].map((i) => (
                <div key={i} className="h-24 rounded-xl bg-zinc-200/70 dark:bg-zinc-900 animate-pulse" />
              ))}
            </div>
          ) : visibleAgents.length === 0 ? (
            <div className="glass-panel rounded-2xl p-8 text-center space-y-3">
              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                Todavía no creaste agentes
              </p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Creá tutores de estudio, analistas financieros o asistentes de proyectos con sus propios documentos.
              </p>
              <button
                type="button"
                onClick={() => openBuilder()}
                className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium cursor-pointer"
              >
                Crear primer agente
              </button>
            </div>
          ) : (
            visibleAgents.map((ag) => {
              const active = selectedAgent?.id === ag.id;
              return (
                <div
                  key={ag.id}
                  onClick={() => setSelectedAgent(ag)}
                  className={`rounded-2xl p-4 cursor-pointer transition-colors space-y-2.5 ${
                    active
                      ? 'glass-panel border-violet-500 bg-violet-600/10 dark:bg-violet-500/10'
                      : 'glass-panel hover:border-zinc-300 dark:hover:border-white/20'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      {renderIcon(ag.icon)}
                      <h2 className="font-display text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                        {ag.name}
                      </h2>
                    </div>
                    <div
                      className="flex items-center gap-1 shrink-0"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={() => openBuilder(ag)}
                        title="Editar"
                        className="p-1.5 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 cursor-pointer"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDuplicate(ag)}
                        title="Duplicar"
                        className="p-1.5 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 cursor-pointer"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleArchiveToggle(ag)}
                        title={ag.isArchived ? 'Desarchivar' : 'Archivar'}
                        className="p-1.5 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 cursor-pointer"
                      >
                        <Archive className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteAgent(ag.id)}
                        title="Eliminar"
                        className="p-1.5 text-zinc-400 hover:text-red-500 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  {ag.description && (
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 line-clamp-2">
                      {ag.description}
                    </p>
                  )}
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    {ag.permissionMode === 'docs_only'
                      ? 'Aislado: solo documentos'
                      : ag.permissionMode === 'docs_and_agent_memory'
                        ? 'Documentos + memoria propia'
                        : ag.permissionMode === 'docs_and_selected_folders'
                          ? 'Documentos + carpetas autorizadas'
                          : 'Acceso completo autorizado'}
                    {ag.isArchived ? ' · Archivado' : ''}
                  </p>
                </div>
              );
            })
          )}
        </aside>

        {/* Selected Agent Workspace */}
        <section className="lg:col-span-8 glass-panel rounded-2xl flex flex-col min-h-[540px] overflow-hidden">
          {!selectedAgent ? (
            <div className="m-auto p-8 text-center max-w-md space-y-2">
              <p className="font-display text-base font-medium text-zinc-900 dark:text-zinc-100">
                Seleccioná o creá un agente
              </p>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                Cargale sus propios PDFs, documentos o apuntes y probalo en su propio chat aislado.
              </p>
            </div>
          ) : (
            <>
              <div className="px-5 py-4 border-b border-zinc-200 dark:border-zinc-800/80 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  {renderIcon(selectedAgent.icon)}
                  <div className="min-w-0">
                    <h2 className="font-display text-base font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                      {selectedAgent.name}
                    </h2>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                      {PERMISSION_LABELS[selectedAgent.permissionMode]?.title}
                    </p>
                  </div>
                </div>

                <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
                  <button
                    type="button"
                    onClick={() => setWorkspaceTab('chat')}
                    className={`px-3 py-1 rounded-md text-xs font-medium cursor-pointer ${
                      workspaceTab === 'chat'
                        ? 'bg-white dark:bg-[#1A1A1F] text-zinc-900 dark:text-zinc-100'
                        : 'text-zinc-500 dark:text-zinc-400'
                    }`}
                  >
                    Chat
                  </button>
                  <button
                    type="button"
                    onClick={() => setWorkspaceTab('knowledge')}
                    className={`px-3 py-1 rounded-md text-xs font-medium cursor-pointer ${
                      workspaceTab === 'knowledge'
                        ? 'bg-white dark:bg-[#1A1A1F] text-zinc-900 dark:text-zinc-100'
                        : 'text-zinc-500 dark:text-zinc-400'
                    }`}
                  >
                    Documentos ({sources.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setWorkspaceTab('memories')}
                    className={`px-3 py-1 rounded-md text-xs font-medium cursor-pointer ${
                      workspaceTab === 'memories'
                        ? 'bg-white dark:bg-[#1A1A1F] text-zinc-900 dark:text-zinc-100'
                        : 'text-zinc-500 dark:text-zinc-400'
                    }`}
                  >
                    Memoria ({agentMemories.length})
                  </button>
                </div>
              </div>

              {workspaceTab === 'chat' && (
                <div className="flex-1 flex flex-col overflow-hidden">
                  <div className="px-5 py-2 border-b border-zinc-200 dark:border-zinc-800/80 flex items-center justify-between text-xs text-zinc-500">
                    <span>
                      Sesión:{' '}
                      {conversations.find((c) => c.id === activeConvId)?.title || 'Nueva sesión'}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveConvId(null);
                        setMessages([]);
                      }}
                      className="text-violet-600 dark:text-violet-400 hover:underline cursor-pointer"
                    >
                      + Nueva conversación
                    </button>
                  </div>

                  <div className="flex-1 overflow-y-auto p-5 space-y-4">
                    {messages.length === 0 ? (
                      <div className="py-10 text-center space-y-2 max-w-md mx-auto">
                        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                          Probá a {selectedAgent.name}
                        </p>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">
                          Este agente responde según sus instrucciones y únicamente accede a las fuentes que autorizaste ({sources.length} documentos propios cargados).
                        </p>
                      </div>
                    ) : (
                      messages.map((m) => (
                        <div
                          key={m.id}
                          className={`flex flex-col ${
                            m.role === 'user' ? 'items-end' : 'items-start'
                          } space-y-1.5`}
                        >
                          <div
                            className={`max-w-xl rounded-xl px-4 py-3 text-sm leading-relaxed ${
                              m.role === 'user'
                                ? 'bg-violet-600 text-white'
                                : 'border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#16161A] text-zinc-900 dark:text-zinc-100'
                            }`}
                          >
                            <p className="whitespace-pre-wrap">{m.content}</p>
                          </div>
                          {m.role === 'assistant' && m.citations && m.citations.length > 0 && (
                            <p className="text-xs text-zinc-500 dark:text-zinc-400 px-1">
                              Fuentes citadas: {m.citations.map((c) => c.title).join(' · ')}
                            </p>
                          )}
                        </div>
                      ))
                    )}
                    {sendingChat && (
                      <p className="text-xs text-zinc-500">{selectedAgent.name} está pensando...</p>
                    )}
                  </div>

                  <form
                    onSubmit={handleSendAgentChat}
                    className="p-4 border-t border-zinc-200 dark:border-zinc-800/80 flex items-center gap-2 bg-zinc-50/70 dark:bg-[#0D0D10]"
                  >
                    <input
                      type="text"
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      placeholder={`Escribile a ${selectedAgent.name}...`}
                      className="flex-1 px-4 py-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#16161A] text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none"
                    />
                    <button
                      type="submit"
                      disabled={sendingChat || !chatInput.trim()}
                      className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white text-sm font-medium cursor-pointer"
                    >
                      <Send className="w-4 h-4" />
                    </button>
                  </form>
                </div>
              )}

              {workspaceTab === 'knowledge' && (
                <div className="p-5 space-y-4 overflow-y-auto flex-1">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                        Base de conocimiento propia del agente
                      </p>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        Subí PDFs, imágenes, archivos de texto o documentos exclusivos para este agente.
                      </p>
                    </div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*,application/pdf,text/*,.md,.csv,.json"
                      onChange={handleUploadAgentDocument}
                      className="hidden"
                    />
                    <button
                      type="button"
                      disabled={uploadingSource}
                      onClick={() => fileInputRef.current?.click()}
                      className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-60 text-white text-xs font-medium cursor-pointer shrink-0"
                    >
                      <FileUp className="w-4 h-4" />
                      <span>{uploadingSource ? 'Analizando...' : 'Subir documento'}</span>
                    </button>
                  </div>

                  {sources.length === 0 ? (
                    <p className="text-sm text-zinc-500 py-8 text-center">
                      Este agente aún no tiene documentos cargados.
                    </p>
                  ) : (
                    <ul className="divide-y divide-zinc-200 dark:divide-zinc-800/80 border border-zinc-200 dark:border-zinc-800 rounded-xl">
                      {sources.map((src) => (
                        <li key={src.id} className="p-4 flex items-start justify-between gap-4">
                          <div className="min-w-0 space-y-1">
                            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                              {src.fileName}
                            </p>
                            <p className="text-xs text-zinc-500 dark:text-zinc-400 tabular-nums">
                              {src.mimeType} · {(src.sizeBytes / 1024).toFixed(0)} KB
                            </p>
                            {src.aiSummary && (
                              <p className="text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed pt-1">
                                {src.aiSummary}
                              </p>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => handleDeleteSource(src.id)}
                            className="p-1.5 text-zinc-400 hover:text-red-500 cursor-pointer shrink-0"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {workspaceTab === 'memories' && (
                <div className="p-5 space-y-3 overflow-y-auto flex-1">
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Memorias aprendidas exclusivamente dentro de las sesiones de {selectedAgent.name}.
                  </p>
                  {agentMemories.length === 0 ? (
                    <p className="text-sm text-zinc-500 py-8 text-center">
                      Este agente todavía no acumuló recuerdos propios.
                    </p>
                  ) : (
                    <ul className="divide-y divide-zinc-200 dark:divide-zinc-800/80 border border-zinc-200 dark:border-zinc-800 rounded-xl">
                      {agentMemories.map((m) => (
                        <li key={m.id} className="p-4 text-sm text-zinc-800 dark:text-zinc-200">
                          <p>{m.content}</p>
                          <p className="text-xs text-zinc-500 mt-1 tabular-nums">
                            {new Date(m.createdAt).toLocaleString('es-UY')}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </>
          )}
        </section>
      </div>

      {/* Visual Agent Builder Modal */}
      {builderOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setBuilderOpen(false)}
        >
          <form
            onSubmit={handleSaveAgent}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-2xl glass-elevated rounded-2xl p-6 space-y-5 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                {editingAgentId ? 'Editar agente personalizado' : 'Nuevo agente personalizado'}
              </h2>
              <button
                type="button"
                onClick={() => setBuilderOpen(false)}
                className="text-zinc-400 hover:text-zinc-200 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-12 gap-4">
              <div className="sm:col-span-8">
                <label className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">
                  Nombre del agente
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ej: Tutor de Algoritmos, Auditor Legal..."
                  className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#09090B] text-sm text-zinc-900 dark:text-zinc-100"
                />
              </div>
              <div className="sm:col-span-4">
                <label className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">Ícono</label>
                <select
                  value={icon}
                  onChange={(e) => setIcon(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#09090B] text-sm text-zinc-900 dark:text-zinc-100"
                >
                  {AGENT_ICONS.map((ic) => (
                    <option key={ic.id} value={ic.id}>
                      {ic.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">
                Descripción y objetivo principal
              </label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Qué hace este agente y para qué lo creaste..."
                className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#09090B] text-sm text-zinc-900 dark:text-zinc-100"
              />
            </div>

            <div>
              <label className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">
                Instrucciones del sistema (System prompt)
              </label>
              <textarea
                rows={3}
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                placeholder="Reglas detalladas de comportamiento, metodología y límites..."
                className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#09090B] text-sm text-zinc-900 dark:text-zinc-100"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">
                  Personalidad
                </label>
                <input
                  type="text"
                  value={personality}
                  onChange={(e) => setPersonality(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#09090B] text-xs text-zinc-900 dark:text-zinc-100"
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">
                  Estilo de respuesta
                </label>
                <input
                  type="text"
                  value={responseStyle}
                  onChange={(e) => setResponseStyle(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#09090B] text-xs text-zinc-900 dark:text-zinc-100"
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">
                  Profundidad
                </label>
                <select
                  value={depthLevel}
                  onChange={(e) =>
                    setDepthLevel(e.target.value as 'concise' | 'balanced' | 'deep')
                  }
                  className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#09090B] text-xs text-zinc-900 dark:text-zinc-100"
                >
                  <option value="concise">Conciso</option>
                  <option value="balanced">Equilibrado</option>
                  <option value="deep">Profundo y exhaustivo</option>
                </select>
              </div>
            </div>

            {/* Strict Permissions & Isolation */}
            <div className="space-y-2 pt-2 border-t border-zinc-200 dark:border-zinc-800">
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                Nivel de acceso a tu información (Aislamiento estricto)
              </label>
              <div className="space-y-2">
                {(Object.keys(PERMISSION_LABELS) as AgentPermissionMode[]).map((mode) => (
                  <label
                    key={mode}
                    className={`flex items-start gap-2.5 p-3 rounded-lg border cursor-pointer ${
                      permissionMode === mode
                        ? 'border-violet-500 bg-violet-600/5'
                        : 'border-zinc-200 dark:border-zinc-800'
                    }`}
                  >
                    <input
                      type="radio"
                      name="permMode"
                      checked={permissionMode === mode}
                      onChange={() => setPermissionMode(mode)}
                      className="mt-0.5 accent-violet-600"
                    />
                    <div className="text-xs">
                      <p className="font-medium text-zinc-900 dark:text-zinc-100">
                        {PERMISSION_LABELS[mode].title}
                      </p>
                      <p className="text-zinc-500 dark:text-zinc-400">
                        {PERMISSION_LABELS[mode].desc}
                      </p>
                    </div>
                  </label>
                ))}
              </div>

              {permissionMode === 'docs_and_selected_folders' && (
                <div className="p-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#09090B] space-y-2">
                  <p className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
                    Seleccioná carpetas autorizadas:
                  </p>
                  <div className="grid grid-cols-2 gap-1.5 max-h-32 overflow-y-auto">
                    {folders.map((f) => {
                      const checked = allowedFolderIds.includes(f.id);
                      return (
                        <label
                          key={f.id}
                          className="flex items-center gap-2 text-xs text-zinc-700 dark:text-zinc-300 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              setAllowedFolderIds((prev) =>
                                e.target.checked
                                  ? [...prev, f.id]
                                  : prev.filter((id) => id !== f.id)
                              );
                            }}
                            className="accent-violet-600"
                          />
                          <span className="truncate">{f.name}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Tools & Memory */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-zinc-200 dark:border-zinc-800">
              <div className="space-y-2">
                <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  Herramientas habilitadas
                </p>
                {AVAILABLE_TOOLS.map((tool) => (
                  <label
                    key={tool.id}
                    className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={toolsEnabled.includes(tool.id)}
                      onChange={(e) =>
                        setToolsEnabled((prev) =>
                          e.target.checked
                            ? [...prev, tool.id]
                            : prev.filter((t) => t !== tool.id)
                        )
                      }
                      className="accent-violet-600"
                    />
                    <span>{tool.label}</span>
                  </label>
                ))}
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  Memoria del agente
                </p>
                <label className="flex items-start gap-2 text-xs text-zinc-600 dark:text-zinc-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={memoryEnabled}
                    onChange={(e) => setMemoryEnabled(e.target.checked)}
                    className="mt-0.5 accent-violet-600"
                  />
                  <span>
                    Permitir que este agente guarde recuerdos propios aislados de sus sesiones.
                  </span>
                </label>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setBuilderOpen(false)}
                className="px-4 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 text-xs font-medium text-zinc-600 dark:text-zinc-300 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={savingAgent || !name.trim()}
                className="px-5 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium cursor-pointer"
              >
                {savingAgent ? 'Guardando...' : editingAgentId ? 'Guardar cambios' : 'Crear agente'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
