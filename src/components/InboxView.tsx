import { useEffect, useRef, useState } from 'react';
import {
  Archive,
  ArchiveRestore,
  BookHeart,
  Check,
  Copy,
  Download,
  Eye,
  Edit3,
  Link2,
  Mic,
  MoreHorizontal,
  PanelLeft,
  Paperclip,
  Plus,
  RotateCw,
  Search,
  Send,
  Square,
  StickyNote,
  Trash2,
  X,
} from 'lucide-react';
import {
  apiRequest,
  deletePrivateStorageFile,
  fetchPrivateFileBlobUrl,
  uploadPrivateChatAttachment,
  type ConversationItem,
  type MessageItem,
  type ProjectItem,
} from '../lib/api';
import { MarkdownRenderer } from './MarkdownRenderer';
import { PrivateImagePreview } from './PrivateImagePreview';

interface InboxViewProps {
  projects: ProjectItem[];
  initialQuickText?: string | null;
  initialConversationId?: number | null;
  onClearQuickText: () => void;
  onDataChanged: () => void;
  mobileKeyboardOpen: boolean;
}

interface PendingAttachment {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  base64Data?: string;
  storagePath?: string;
  file?: File;
  previewUrl?: string;
}

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_UPLOAD_BYTES = 3 * 1024 * 1024;

async function prepareImageForUpload(file: File): Promise<File> {
  if (file.size <= MAX_IMAGE_UPLOAD_BYTES) return file;
  if (file.type === 'image/gif' || file.type === 'image/svg+xml') {
    throw new Error('Esta imagen supera 3 MB y no se puede optimizar automáticamente.');
  }

  let image: ImageBitmap;
  try {
    image = await createImageBitmap(file);
  } catch {
    throw new Error('No se pudo optimizar esta imagen. Elegí una versión más liviana.');
  }

  try {
    const outputType = file.type === 'image/png' || file.type === 'image/webp' ? 'image/webp' : 'image/jpeg';
    let scale = Math.min(1, 2560 / Math.max(image.width, image.height));

    for (let resizeAttempt = 0; resizeAttempt < 7; resizeAttempt += 1) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('No se pudo optimizar esta imagen.');
      context.drawImage(image, 0, 0, canvas.width, canvas.height);

      for (const quality of [0.84, 0.76, 0.68, 0.6]) {
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, outputType, quality));
        if (!blob) continue;
        if (blob.size <= MAX_IMAGE_UPLOAD_BYTES) {
          const mimeType = blob.type || outputType;
          const extension = mimeType === 'image/webp' ? '.webp' : mimeType === 'image/png' ? '.png' : '.jpg';
          const name = `${file.name.replace(/\.[^.]+$/, '')}${extension}`;
          return new File([blob], name, { type: mimeType, lastModified: file.lastModified });
        }
      }
      scale *= 0.8;
    }
  } finally {
    image.close();
  }

  throw new Error('No se pudo reducir la imagen al tamaño máximo de carga.');
}

const STATUS_LABELS: Record<string, string> = {
  received: 'Recibido',
  processing: 'Procesando',
  analyzed: 'Analizado',
  organized: 'Organizado',
  pending_confirmation: 'Pendiente de confirmación',
  error: 'Error',
};

export function InboxView({
  projects,
  initialQuickText,
  initialConversationId,
  onClearQuickText,
  onDataChanged,
  mobileKeyboardOpen,
}: InboxViewProps) {
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [convSearch, setConvSearch] = useState('');
  const [activeConvId, setActiveConvId] = useState<number | null>(null);
  const [renamingConvId, setRenamingConvId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // Drawer collapsible on desktop + slide-over on mobile
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showMetadataDetails, setShowMetadataDetails] = useState(true);

  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [inputText, setInputText] = useState('');
  const [linkInput, setLinkInput] = useState('');
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [sending, setSending] = useState(false);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [resolvingActionId, setResolvingActionId] = useState<number | null>(null);
  const [copiedMsgId, setCopiedMsgId] = useState<number | null>(null);
  const [editingMsgId, setEditingMsgId] = useState<number | null>(null);
  const [openImageAttachmentId, setOpenImageAttachmentId] = useState<string | null>(null);
  const [editMsgContent, setEditMsgContent] = useState('');
  const [regenerating, setRegenerating] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewUrlsRef = useRef(new Set<string>());
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const skipNextLoadConvIdRef = useRef<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const loadConversations = async (includeArchived = showArchived) => {
    try {
      const list = await apiRequest<ConversationItem[]>(
        `/api/conversations?archived=${includeArchived ? 'true' : 'false'}`,
      );
      setConversations(list);
      if (initialConversationId && list.some((c) => c.id === initialConversationId)) {
        setActiveConvId(initialConversationId);
      } else if (list.length > 0) {
        setActiveConvId((prev) => prev ?? list[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar conversaciones.');
    }
  };

  const loadMessages = async (convId: number) => {
    setLoadingMsgs(true);
    try {
      const res = await apiRequest<{ messages: MessageItem[] }>(
        `/api/conversations/${convId}/messages`,
      );
      setMessages(res.messages);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar mensajes.');
    } finally {
      setLoadingMsgs(false);
    }
  };

  useEffect(() => {
    loadConversations(showArchived);
  }, [showArchived]);

  useEffect(
    () => () => {
      for (const previewUrl of previewUrlsRef.current) URL.revokeObjectURL(previewUrl);
      previewUrlsRef.current.clear();
    },
    [],
  );

  useEffect(() => {
    if (initialConversationId) {
      setActiveConvId(initialConversationId);
    }
  }, [initialConversationId]);

  useEffect(() => {
    if (activeConvId) {
      if (skipNextLoadConvIdRef.current === activeConvId) {
        skipNextLoadConvIdRef.current = null;
        return;
      }
      loadMessages(activeConvId);
    } else {
      setMessages([]);
    }
  }, [activeConvId]);

  useEffect(() => {
    if (!sending && !regenerating) {
      setElapsedSeconds(0);
      return;
    }
    const start = Date.now();
    const id = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [sending, regenerating]);

  useEffect(() => {
    if (initialQuickText) {
      setInputText(initialQuickText);
      onClearQuickText();
    }
  }, [initialQuickText]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, sending, regenerating]);

  const handleNewConversation = async () => {
    try {
      setShowArchived(false);
      const created = await apiRequest<ConversationItem>('/api/conversations', {
        method: 'POST',
        body: JSON.stringify({
          title: `Conversación ${new Date().toLocaleDateString('es-UY')}`,
          projectId: selectedProjectId,
        }),
      });
      setConversations((prev) => [created, ...prev]);
      setActiveConvId(created.id);
      setMessages([]);
      setDrawerOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear la conversación.');
    }
  };

  const handleRenameConversation = async (convId: number) => {
    const trimmed = renameValue.trim();
    if (!trimmed) {
      setRenamingConvId(null);
      return;
    }
    try {
      const updated = await apiRequest<ConversationItem>(`/api/conversations/${convId}`, {
        method: 'PATCH',
        body: JSON.stringify({ title: trimmed }),
      });
      setConversations((prev) => prev.map((c) => (c.id === convId ? updated : c)));
      setRenamingConvId(null);
      onDataChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo renombrar.');
    }
  };

  const handleArchiveConversation = async (conv: ConversationItem) => {
    try {
      await apiRequest<ConversationItem>(`/api/conversations/${conv.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isArchived: !conv.isArchived }),
      });
      await loadConversations(showArchived);
      if (!showArchived && activeConvId === conv.id) {
        setActiveConvId(null);
      }
      setMenuOpen(false);
      onDataChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo archivar.');
    }
  };

  const handleDeleteConversation = async (convId: number) => {
    try {
      await apiRequest(`/api/conversations/${convId}`, { method: 'DELETE' });
      const remaining = conversations.filter((c) => c.id !== convId);
      setConversations(remaining);
      if (activeConvId === convId) {
        setActiveConvId(remaining[0]?.id ?? null);
      }
      setMenuOpen(false);
      onDataChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo eliminar la conversación.');
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = Array.from(e.target.files || []);
    if (fileList.length === 0) return;
    setError(null);

    for (const file of fileList) {
      if (file.size > MAX_UPLOAD_BYTES) {
        setError(`"${file.name}" supera el límite de 20 MB.`);
        continue;
      }

      try {
        if (file.type.startsWith('image/')) {
          const optimizedFile = await prepareImageForUpload(file);
          const previewUrl = URL.createObjectURL(optimizedFile);
          previewUrlsRef.current.add(previewUrl);
          setAttachments((prev) => [
            ...prev,
            {
              id: `${file.name}-${Date.now()}-${Math.random()}`,
              name: optimizedFile.name,
              mimeType: optimizedFile.type || file.type,
              sizeBytes: optimizedFile.size,
              file: optimizedFile,
              previewUrl,
            },
          ]);
          continue;
        }

        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const result = typeof reader.result === 'string' ? reader.result : '';
            resolve(result.includes(',') ? result.split(',')[1] : result);
          };
          reader.onerror = () => reject(new Error(`No se pudo leer "${file.name}".`));
          reader.readAsDataURL(file);
        });

        setAttachments((prev) => [
          ...prev,
          {
            id: `${file.name}-${Date.now()}-${Math.random()}`,
            name: file.name,
            mimeType: file.type || 'application/octet-stream',
            sizeBytes: file.size,
            base64Data: base64,
          },
        ]);
      } catch (err) {
        setError(err instanceof Error ? err.message : `No se pudo preparar "${file.name}".`);
      }
    }
    e.target.value = '';
  };

  const handleRemoveAttachment = (attachment: PendingAttachment) => {
    setAttachments((prev) => prev.filter((item) => item.id !== attachment.id));
    if (attachment.previewUrl) {
      URL.revokeObjectURL(attachment.previewUrl);
      previewUrlsRef.current.delete(attachment.previewUrl);
    }
    if (attachment.storagePath) {
      void deletePrivateStorageFile(attachment.storagePath).catch(() => {});
    }
  };

  const handleToggleRecording = async () => {
    if (recording && mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      setRecording(false);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) audioChunksRef.current.push(ev.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        const reader = new FileReader();
        reader.onload = () => {
          const result = typeof reader.result === 'string' ? reader.result : '';
          const base64 = result.includes(',') ? result.split(',')[1] : result;
          setAttachments((prev) => [
            ...prev,
            {
              id: `audio-${Date.now()}`,
              name: `nota-de-voz-${Date.now()}.webm`,
              mimeType: blob.type || 'audio/webm',
              sizeBytes: blob.size,
              base64Data: base64,
            },
          ]);
        };
        reader.readAsDataURL(blob);
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setRecording(true);
      setError(null);
    } catch {
      setError('No se pudo acceder al micrófono. Verificá los permisos del navegador.');
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sending) return;
    if (!inputText.trim() && attachments.length === 0 && !linkInput.trim()) return;

    const trimmedText = inputText.trim();
    const trimmedLink = linkInput.trim() || undefined;
    const currentAtts = [...attachments];
    const preparedAtts = [...currentAtts];

    const optimisticId = -Date.now();
    const optimisticMsg: MessageItem = {
      id: optimisticId,
      conversationId: activeConvId || 0,
      role: 'user',
      content:
        trimmedText ||
        (currentAtts.length > 0
          ? `Adjuntos (${currentAtts.length}): ${currentAtts.map((a) => a.name).join(', ')}`
          : `Enlace: ${trimmedLink}`),
      processingStatus: 'processing',
      errorMessage: null,
      metadata: trimmedLink ? { linkUrl: trimmedLink } : {},
      attachments: currentAtts.map((att, index) => ({
        id: -(index + 1),
        fileId: null,
        attachmentType: att.mimeType.startsWith('image/') ? 'image' : 'other',
        externalUrl: null,
        fileName: att.name,
        mimeType: att.mimeType,
        aiSummary: null,
        detectedCategory: null,
        previewUrl: att.previewUrl,
      })),
      createdAt: new Date().toISOString(),
    };

    setSending(true);
    setError(null);
    setOpenImageAttachmentId(null);
    setMessages((prev) => [...prev, optimisticMsg]);
    setInputText('');
    setLinkInput('');
    setShowLinkInput(false);
    setAttachments([]);

    try {
      for (let index = 0; index < preparedAtts.length; index += 1) {
        const attachment = preparedAtts[index];
        if (!attachment.file) continue;
        const stored = await uploadPrivateChatAttachment(attachment.file);
        preparedAtts[index] = { ...attachment, ...stored, file: undefined };
      }

      const payload = {
        conversationId: activeConvId,
        projectId: selectedProjectId,
        text: trimmedText,
        linkUrl: trimmedLink,
        attachments: preparedAtts.map(({ name, mimeType, base64Data, storagePath }) => ({
          name,
          mimeType,
          ...(base64Data ? { base64Data } : {}),
          ...(storagePath ? { storagePath } : {}),
        })),
      };
      const res = await apiRequest<{
        conversationId: number;
        userMessage: MessageItem;
        assistantMessage: MessageItem;
      }>('/api/inbox/send', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      setMessages((prev) => [
        ...prev.filter((m) => m.id !== optimisticId),
        res.userMessage,
        res.assistantMessage,
      ]);

      for (const attachment of preparedAtts) {
        if (attachment.previewUrl) {
          URL.revokeObjectURL(attachment.previewUrl);
          previewUrlsRef.current.delete(attachment.previewUrl);
        }
      }

      if (!activeConvId) {
        skipNextLoadConvIdRef.current = res.conversationId;
        setActiveConvId(res.conversationId);
      }

      void loadConversations(showArchived);
      void onDataChanged();
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Error al procesar con SILVV MEMORY.';
      setAttachments(preparedAtts);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === optimisticId
            ? { ...m, processingStatus: 'error', errorMessage: errMsg }
            : m,
        ),
      );
      setError(errMsg);
    } finally {
      setSending(false);
    }
  };

  const handleCopyMessage = async (msgId: number, content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedMsgId(msgId);
      setTimeout(() => setCopiedMsgId(null), 1800);
    } catch {
      setError('No se pudo copiar al portapapeles.');
    }
  };

  const handleEditAndRegenerate = async (msgId: number) => {
    const trimmed = editMsgContent.trim();
    if (!trimmed || regenerating) return;
    setRegenerating(true);
    setError(null);
    try {
      await apiRequest(`/api/messages/${msgId}/regenerate`, {
        method: 'PATCH',
        body: JSON.stringify({ content: trimmed }),
      });
      setEditingMsgId(null);
      setEditMsgContent('');
      if (activeConvId) await loadMessages(activeConvId);
      onDataChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al regenerar respuesta.');
    } finally {
      setRegenerating(false);
    }
  };

  const handleResolveAction = async (
    messageId: number,
    actionLogId: number,
    decision: 'confirm' | 'reject',
  ) => {
    setResolvingActionId(actionLogId);
    try {
      await apiRequest(`/api/actions/${actionLogId}/resolve`, {
        method: 'POST',
        body: JSON.stringify({ decision }),
      });

      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== messageId || !m.metadata?.actions) return m;
          return {
            ...m,
            metadata: {
              ...m.metadata,
              actions: m.metadata.actions.map((a) =>
                a.actionLogId === actionLogId
                  ? { ...a, status: decision === 'confirm' ? 'executed' : 'rejected' }
                  : a,
              ),
            },
          };
        }),
      );
      onDataChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo resolver la acción.');
    } finally {
      setResolvingActionId(null);
    }
  };

  const handleDownloadAttachment = async (fileId: number, fileName: string) => {
    try {
      const url = await fetchPrivateFileBlobUrl(fileId);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo abrir el adjunto.');
    }
  };

  const filteredConversations = conversations.filter((c) => {
    if (!convSearch.trim()) return true;
    return c.title.toLowerCase().includes(convSearch.toLowerCase());
  });

  const activeConv = conversations.find((c) => c.id === activeConvId);

  return (
    <div className="relative h-full flex overflow-hidden">
      {/* Collapsible Conversations Drawer (Overlay on mobile, side panel on desktop when open) */}
      {drawerOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/45 lg:hidden animate-silvv-overlay-in"
            onClick={() => setDrawerOpen(false)}
          />
          <aside className="fixed inset-y-0 left-0 z-50 w-72 lg:static lg:z-10 lg:w-80 glass-elevated lg:glass-panel border-r border-zinc-200/70 dark:border-white/10 p-4 flex flex-col gap-3 overflow-hidden shrink-0 animate-silvv-panel-in">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-display text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                Conversaciones
              </h2>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleNewConversation}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium cursor-pointer whitespace-nowrap"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Nueva</span>
                </button>
                <button
                  type="button"
                  onClick={() => setDrawerOpen(false)}
                  className="p-1.5 rounded-xl glass-subtle text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 cursor-pointer"
                  aria-label="Cerrar panel de conversaciones"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="relative">
              <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={convSearch}
                onChange={(e) => setConvSearch(e.target.value)}
                placeholder="Buscar chat..."
                className="w-full pl-8 pr-2.5 py-1.5 rounded-xl border border-zinc-200/80 dark:border-white/10 bg-white/70 dark:bg-black/30 text-xs focus:outline-none"
              />
            </div>

            <div className="flex items-center justify-between text-xs px-1">
              <button
                type="button"
                onClick={() => setShowArchived((v) => !v)}
                className="text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 cursor-pointer"
              >
                {showArchived ? 'Ocultar archivadas' : 'Ver archivadas'}
              </button>
              <span className="text-zinc-400 tabular-nums">{filteredConversations.length}</span>
            </div>

            <div className="space-y-1 overflow-y-auto flex-1 pr-1">
              {filteredConversations.map((c) => {
                const active = c.id === activeConvId;
                const isRenaming = renamingConvId === c.id;
                return (
                  <div
                    key={c.id}
                    className={`group rounded-xl px-3 py-2 transition-colors ${
                      active
                        ? 'bg-violet-600/15 text-violet-700 dark:text-violet-200'
                        : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200/50 dark:hover:bg-white/5'
                    }`}
                  >
                    {isRenaming ? (
                      <div className="flex items-center gap-1 animate-silvv-in">
                        <input
                          type="text"
                          autoFocus
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleRenameConversation(c.id);
                            if (e.key === 'Escape') setRenamingConvId(null);
                          }}
                          className="flex-1 min-w-0 px-2 py-1 rounded border border-violet-500 bg-white dark:bg-[#09090B] text-xs"
                        />
                        <button
                          type="button"
                          onClick={() => handleRenameConversation(c.id)}
                          className="p-1 text-emerald-500 cursor-pointer"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setActiveConvId(c.id);
                            setDrawerOpen(false);
                          }}
                          className="flex-1 min-w-0 text-left cursor-pointer"
                        >
                          <p className="text-xs font-medium truncate">
                            {c.title}
                            {c.isArchived ? ' (Archivada)' : ''}
                          </p>
                          <p className="text-[11px] text-zinc-500 tabular-nums mt-0.5">
                            {new Date(c.lastMessageAt).toLocaleDateString('es-UY', {
                              day: '2-digit',
                              month: 'short',
                            })}
                          </p>
                        </button>

                        <div className="flex items-center gap-0.5 opacity-80 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity shrink-0">
                          <button
                            type="button"
                            onClick={() => {
                              setRenamingConvId(c.id);
                              setRenameValue(c.title);
                            }}
                            title="Renombrar"
                            className="p-1 text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-100 cursor-pointer"
                          >
                            <Edit3 className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleArchiveConversation(c)}
                            title={c.isArchived ? 'Desarchivar' : 'Archivar'}
                            className="p-1 text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-100 cursor-pointer"
                          >
                            {c.isArchived ? (
                              <ArchiveRestore className="w-3 h-3" />
                            ) : (
                              <Archive className="w-3 h-3" />
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteConversation(c.id)}
                            title="Eliminar"
                            className="p-1 text-zinc-400 hover:text-red-500 cursor-pointer"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </aside>
        </>
      )}

      {/* Full-screen Main Chat Column */}
      <section className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        {/* Discrete Top Bar */}
        <div className="px-4 sm:px-6 py-2.5 border-b border-zinc-200/70 dark:border-white/10 glass-panel flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={() => setDrawerOpen((v) => !v)}
              title="Mostrar historial de conversaciones"
              aria-expanded={drawerOpen}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl glass-subtle text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:border-violet-500/40 cursor-pointer whitespace-nowrap shrink-0"
            >
              <PanelLeft className="w-4 h-4" />
              <span className="hidden sm:inline">Chats ({conversations.length})</span>
            </button>

            <div className="min-w-0">
              <h1 className="font-display text-sm sm:text-base font-semibold text-zinc-900 dark:text-zinc-50 truncate">
                {activeConv ? activeConv.title : 'Chat general de SILVV MEMORY'}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0 relative">
            <button
              type="button"
              onClick={handleNewConversation}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium cursor-pointer whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Nuevo chat</span>
            </button>

            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="Opciones de conversación"
              aria-expanded={menuOpen}
              className="p-2 rounded-xl glass-subtle text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-zinc-50 cursor-pointer"
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>

            {menuOpen && (
              <div className="absolute right-0 top-11 z-40 w-64 glass-elevated rounded-2xl p-3 space-y-3 text-xs animate-silvv-popover-in">
                <div className="space-y-1">
                  <label className="block text-[11px] text-zinc-500 dark:text-zinc-400">
                    Vincular a proyecto
                  </label>
                  <select
                    value={selectedProjectId ?? ''}
                    onChange={(e) =>
                      setSelectedProjectId(e.target.value ? Number(e.target.value) : null)
                    }
                    className="w-full px-2.5 py-1.5 rounded-lg border border-zinc-200/80 dark:border-white/10 bg-white/80 dark:bg-black/40 text-xs"
                  >
                    <option value="">General (sin proyecto)</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>

                <label className="flex items-center justify-between gap-2 cursor-pointer text-zinc-700 dark:text-zinc-200">
                  <span>Ver análisis y memorias guardadas</span>
                  <input
                    type="checkbox"
                    checked={showMetadataDetails}
                    onChange={(e) => setShowMetadataDetails(e.target.checked)}
                    className="accent-violet-600"
                  />
                </label>

                {activeConv && (
                  <div className="pt-2 border-t border-zinc-200/70 dark:border-white/10 space-y-1">
                    <button
                      type="button"
                      onClick={() => handleArchiveConversation(activeConv)}
                      className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-zinc-200/50 dark:hover:bg-white/10 text-left cursor-pointer"
                    >
                      <Archive className="w-3.5 h-3.5" />
                      <span>
                        {activeConv.isArchived ? 'Desarchivar chat' : 'Archivar chat'}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteConversation(activeConv.id)}
                      className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-red-500/10 text-red-500 text-left cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Eliminar chat</span>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {error && (
          <div className="mx-4 sm:mx-8 mt-3 p-3 rounded-xl border border-red-300 dark:border-red-900/60 bg-red-50/80 dark:bg-red-950/30 text-xs text-red-700 dark:text-red-300 flex items-center justify-between gap-3 shrink-0 animate-silvv-in">
            <span>{error}</span>
            <button type="button" onClick={() => setError(null)} className="cursor-pointer">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Scrollable Message Stream */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-8 py-6">
          <div className="max-w-4xl mx-auto space-y-6">
            {loadingMsgs ? (
              <div className="space-y-4">
                <div className="h-16 w-2/3 rounded-2xl bg-zinc-200/60 dark:bg-white/5 animate-pulse" />
                <div className="h-24 w-3/4 rounded-2xl bg-zinc-200/60 dark:bg-white/5 animate-pulse" />
              </div>
            ) : messages.length === 0 ? (
              <div className="max-w-xl mx-auto py-16 text-center space-y-3">
                <h2 className="font-display text-xl font-semibold text-zinc-900 dark:text-zinc-50">
                  Conversá libremente con SILVV MEMORY
                </h2>
                <p className="text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed">
                  Preguntá sobre cualquier tema, analizá PDFs, imágenes o audios, pedí guardar o actualizar notas y contá vivencias cotidianas para que se organicen en tu memoria permanente y Agenda Memoria.
                </p>
              </div>
            ) : (
              messages.map((m) => {
                const isUser = m.role === 'user';
                const isEditing = editingMsgId === m.id;
                return (
                  <div
                    key={m.id}
                    className={`flex flex-col ${
                      isUser ? 'items-end' : 'items-start'
                    } space-y-2 animate-silvv-message-in`}
                  >
                    {isEditing ? (
                      <div className="max-w-3xl w-full glass-panel border border-violet-500/60 rounded-2xl p-3.5 space-y-2">
                        <textarea
                          rows={3}
                          value={editMsgContent}
                          onChange={(e) => setEditMsgContent(e.target.value)}
                          className="w-full resize-none bg-transparent text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none"
                        />
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setEditingMsgId(null)}
                            className="px-3 py-1 rounded-xl glass-subtle text-xs text-zinc-500 cursor-pointer"
                          >
                            Cancelar
                          </button>
                          <button
                            type="button"
                            disabled={regenerating}
                            onClick={() => handleEditAndRegenerate(m.id)}
                            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-violet-600 text-white text-xs font-medium cursor-pointer"
                          >
                            <RotateCw className={`w-3 h-3 ${regenerating ? 'animate-spin' : ''}`} />
                            <span>{regenerating ? 'Regenerando...' : 'Guardar y regenerar'}</span>
                          </button>
                        </div>
                      </div>
                    ) : (
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

                        {m.attachments && m.attachments.length > 0 && (
                          <div className="mt-2.5 pt-2 border-t border-white/20 dark:border-white/10 space-y-1 text-xs opacity-90">
                            {m.attachments.some(
                              (att) => att.mimeType?.startsWith('image/') && (att.fileId || att.previewDataUrl || att.previewUrl),
                            ) && (
                              <div className="mb-2 flex flex-wrap gap-2">
                                {m.attachments
                                  .filter(
                                    (att) => att.mimeType?.startsWith('image/') && (att.fileId || att.previewDataUrl || att.previewUrl),
                                  )
                                  .map((att) => {
                                    const imagePreviewKey = `${m.id}:${att.id}`;
                                    return (
                                      <PrivateImagePreview
                                        key={imagePreviewKey}
                                        fileId={att.fileId ?? undefined}
                                        src={att.previewUrl || att.previewDataUrl}
                                        alt={att.fileName || 'Imagen adjunta al mensaje'}
                                        lazy={!att.previewDataUrl && !att.previewUrl}
                                        open={openImageAttachmentId === imagePreviewKey}
                                        onOpenChange={(isOpen) =>
                                          setOpenImageAttachmentId(isOpen ? imagePreviewKey : null)
                                        }
                                        className="max-h-64 max-w-full rounded-xl object-contain bg-black/10"
                                      />
                                    );
                                  })}
                              </div>
                            )}
                            {m.attachments.map((att) => (
                              <div key={att.id} className="flex items-center justify-between gap-3">
                                <span className="truncate">
                                  {att.fileName
                                    ? `Adjunto: ${att.fileName} · ${att.detectedCategory || att.attachmentType}`
                                    : `Enlace: ${att.externalUrl}`}
                                </span>
                                {att.fileId && att.fileName && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      att.mimeType?.startsWith('image/')
                                        ? setOpenImageAttachmentId(`${m.id}:${att.id}`)
                                        : handleDownloadAttachment(att.fileId!, att.fileName!)
                                    }
                                    aria-label={
                                      att.mimeType?.startsWith('image/')
                                        ? `Ver ${att.fileName}`
                                        : `Descargar ${att.fileName}`
                                    }
                                    className="inline-flex items-center gap-1 underline shrink-0 cursor-pointer"
                                  >
                                    {att.mimeType?.startsWith('image/') ? (
                                      <Eye className="w-3 h-3" />
                                    ) : (
                                      <Download className="w-3 h-3" />
                                    )}
                                    <span>{att.mimeType?.startsWith('image/') ? 'Ver' : 'Descargar'}</span>
                                  </button>
                                )}
                              </div>
                            ))}
                          </div>
                        )}

                        {m.errorMessage && (
                          <p className="mt-2 text-xs text-red-200 dark:text-red-400">
                            {m.errorMessage}
                          </p>
                        )}
                      </div>
                    )}

                    {/* Metadata & Actions */}
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-500 dark:text-zinc-400 px-1 tabular-nums">
                      <span>{isUser ? 'Vos' : 'SILVV MEMORY'}</span>
                      <span aria-hidden="true">·</span>
                      <span>
                        {new Date(m.createdAt).toLocaleTimeString('es-UY', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                      {m.editedAt && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>Editado</span>
                        </>
                      )}
                      {showMetadataDetails && m.processingStatus && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>{STATUS_LABELS[m.processingStatus] || m.processingStatus}</span>
                        </>
                      )}
                      {!isUser && (
                        <button
                          type="button"
                          onClick={() => handleCopyMessage(m.id, m.content)}
                          className="inline-flex items-center gap-1 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 cursor-pointer ml-1"
                        >
                          {copiedMsgId === m.id ? (
                            <>
                              <Check className="w-3 h-3 text-emerald-500" />
                              <span className="text-emerald-500">Copiado</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3" />
                              <span>Copiar</span>
                            </>
                          )}
                        </button>
                      )}
                      {isUser && !isEditing && (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingMsgId(m.id);
                            setEditMsgContent(m.content);
                          }}
                          className="inline-flex items-center gap-1 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 cursor-pointer ml-1"
                        >
                          <Edit3 className="w-3 h-3" />
                          <span>Editar</span>
                        </button>
                      )}
                    </div>

                    {/* Auto-saved Notes / Agenda Memoria / Memories cards */}
                    {!isUser &&
                      showMetadataDetails &&
                      ((m.metadata?.createdNotes && m.metadata.createdNotes.length > 0) ||
                        (m.metadata?.createdMemoryEvents &&
                          m.metadata.createdMemoryEvents.length > 0) ||
                        (m.metadata?.savedMemories && m.metadata.savedMemories.length > 0)) && (
                        <div className="max-w-3xl w-full glass-subtle rounded-xl px-4 py-2.5 text-xs text-zinc-600 dark:text-zinc-300 space-y-1.5">
                          {m.metadata.createdNotes?.map((note) => (
                            <p key={`note-${note.id}`} className="flex items-center gap-1.5">
                              <StickyNote className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                              <span>
                                Nota guardada automáticamente: <strong>{note.title}</strong>
                              </span>
                            </p>
                          ))}
                          {m.metadata.createdMemoryEvents?.map((mev) => (
                            <p key={`mev-${mev.id}`} className="flex items-center gap-1.5">
                              <BookHeart className="w-3.5 h-3.5 text-violet-500 shrink-0" />
                              <span>
                                Registrado en Agenda Memoria: <strong>{mev.title}</strong> ·{' '}
                                {mev.category}
                                {mev.dateLabel ? ` · ${mev.dateLabel}` : ''}
                                {mev.people.length > 0 ? ` · ${mev.people.join(', ')}` : ''}
                              </span>
                            </p>
                          ))}
                          {m.metadata.savedMemories?.map((mem) => (
                            <p key={`mem-${mem.id}`}>
                              Memoria ({mem.layer} · {mem.category}): {mem.content}
                            </p>
                          ))}
                        </div>
                      )}

                    {/* Proposed / executed confirmation actions */}
                    {!isUser && m.metadata?.actions && m.metadata.actions.length > 0 && (
                      <div className="max-w-3xl w-full space-y-2">
                        {m.metadata.actions.map((act) => (
                          <div
                            key={act.actionLogId}
                            className="glass-panel rounded-xl px-4 py-3 flex items-center justify-between gap-4"
                          >
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                                {act.summary}
                              </p>
                              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                                {act.status === 'requested'
                                  ? 'Requiere tu confirmación'
                                  : act.status === 'executed'
                                    ? 'Ejecutado y guardado'
                                    : 'Descartado'}
                              </p>
                            </div>

                            {act.status === 'requested' && (
                              <div className="flex items-center gap-2 shrink-0">
                                <button
                                  type="button"
                                  disabled={resolvingActionId === act.actionLogId}
                                  onClick={() =>
                                    handleResolveAction(m.id, act.actionLogId, 'confirm')
                                  }
                                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium cursor-pointer whitespace-nowrap"
                                >
                                  <Check className="w-3.5 h-3.5" />
                                  <span>Confirmar</span>
                                </button>
                                <button
                                  type="button"
                                  disabled={resolvingActionId === act.actionLogId}
                                  onClick={() =>
                                    handleResolveAction(m.id, act.actionLogId, 'reject')
                                  }
                                  className="px-3 py-1.5 rounded-xl glass-subtle text-xs font-medium text-zinc-600 dark:text-zinc-300 cursor-pointer whitespace-nowrap"
                                >
                                  Descartar
                                </button>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}

            {(sending || regenerating) && (
              <div role="status" aria-live="polite" className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400 animate-silvv-message-in">
                <span aria-hidden="true" className="inline-flex items-center gap-1 px-1">
                  <span className="silvv-typing-dot h-1.5 w-1.5 rounded-full bg-violet-500" />
                  <span className="silvv-typing-dot h-1.5 w-1.5 rounded-full bg-violet-500" />
                  <span className="silvv-typing-dot h-1.5 w-1.5 rounded-full bg-violet-500" />
                </span>
                <span>SILVV MEMORY está analizando tu contexto</span>
                {elapsedSeconds > 0 && <span aria-hidden="true">({elapsedSeconds}s)</span>}
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        </div>

        {/* Sticky Docked Composer */}
        <form
          onSubmit={handleSend}
          className={`silvv-compose-dock px-4 sm:px-8 pt-3 ${mobileKeyboardOpen ? 'pb-3' : 'mb-4 pb-[max(0.75rem,env(safe-area-inset-bottom))]'} border-t border-zinc-200/70 dark:border-white/10 glass-panel shrink-0 lg:mb-0`}
        >
          <div className="max-w-4xl mx-auto space-y-2.5">
            {(attachments.length > 0 || showLinkInput) && (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                {attachments.map((att) => (
                  <div
                    key={att.id}
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl glass-subtle text-zinc-800 dark:text-zinc-200 animate-silvv-message-in"
                  >
                    {att.mimeType.startsWith('image/') && att.previewUrl && (
                      <img
                        src={att.previewUrl}
                        alt={`Vista previa de ${att.name}`}
                        className="h-12 w-12 rounded-lg object-cover"
                      />
                    )}
                    <span className="truncate max-w-[180px]">
                      {att.name} · {(att.sizeBytes / 1024).toFixed(0)} KB
                    </span>
                    <button
                      type="button"
                      onClick={() => handleRemoveAttachment(att)}
                      disabled={sending}
                      aria-label={`Quitar ${att.name}`}
                      className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 disabled:opacity-40 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}

                {showLinkInput && (
                  <div className="flex-1 min-w-[200px] flex items-center gap-2">
                    <input
                      type="url"
                      value={linkInput}
                      onChange={(e) => setLinkInput(e.target.value)}
                      placeholder="https://..."
                      className="flex-1 px-3 py-1.5 rounded-xl border border-zinc-200/80 dark:border-white/10 bg-white/80 dark:bg-black/30 text-xs focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setShowLinkInput(false);
                        setLinkInput('');
                      }}
                      className="text-zinc-400 hover:text-zinc-200 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            )}

            <div className="flex items-end gap-2">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*,application/pdf,audio/*,text/*,.md,.csv,.json"
                onChange={handleFileChange}
                disabled={sending}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                title="Adjuntar múltiples archivos (imágenes, PDF, documentos o audios)"
                aria-label="Adjuntar archivos"
                disabled={sending}
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl glass-subtle text-zinc-600 dark:text-zinc-300 hover:border-violet-500/40 disabled:opacity-40 transition-colors cursor-pointer shrink-0"
              >
                <Paperclip className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={handleToggleRecording}
                title={recording ? 'Detener grabación' : 'Grabar nota de voz'}
                className={`min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl transition-colors cursor-pointer shrink-0 ${
                  recording
                    ? 'bg-red-600 text-white'
                    : 'glass-subtle text-zinc-600 dark:text-zinc-300 hover:border-violet-500/40'
                }`}
              >
                {recording ? <Square className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              </button>
              <button
                type="button"
                onClick={() => setShowLinkInput((v) => !v)}
                title="Adjuntar enlace"
                className="hidden sm:flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl glass-subtle text-zinc-600 dark:text-zinc-300 hover:border-violet-500/40 transition-colors cursor-pointer shrink-0"
              >
                <Link2 className="w-4 h-4" />
              </button>

              <textarea
                rows={1}
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                    e.preventDefault();
                    handleSend(e);
                  }
                }}
                placeholder="Escribí a SILVV MEMORY..."
                className="flex-1 min-w-0 resize-none px-4 py-2.5 min-h-[44px] max-h-36 rounded-xl border border-zinc-200/80 dark:border-white/10 bg-white/80 dark:bg-black/35 text-base text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-violet-500/40 sm:text-sm"
              />

              <button
                type="submit"
                disabled={
                  sending || (!inputText.trim() && attachments.length === 0 && !linkInput.trim())
                }
                className="inline-flex items-center justify-center gap-2 px-4 min-h-[44px] rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white text-sm font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <Send className="w-4 h-4" />
                <span className="hidden sm:inline">Enviar</span>
              </button>
            </div>
          </div>
        </form>
      </section>
    </div>
  );
}
