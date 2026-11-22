import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  ArchiveRestore,
  Check,
  Download,
  Edit3,
  Eye,
  FileText,
  Folder,
  FolderPlus,
  Image as ImageIcon,
  MessageSquare,
  Paperclip,
  Pin,
  PinOff,
  Plus,
  Search,
  Sparkles,
  StickyNote,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import {
  apiRequest,
  fetchPrivateStorageBlobUrl,
  type NoteAttachment,
  type NoteFolderItem,
  type NoteItem,
  type NoteOrganization,
} from '../lib/api';
import { MarkdownRenderer } from './MarkdownRenderer';

interface NotesViewProps {
  onDataChanged: () => void;
  onAskInChat?: (prompt: string) => void;
}

type NoteFilterMode = 'all' | 'pinned' | 'quick' | 'archived';
type SmartNoteCategory = 'Estudios' | 'Vida diaria';

const SMART_NOTE_ROOTS: SmartNoteCategory[] = ['Estudios', 'Vida diaria'];

function normalizeFolderName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function isSmartRootFolder(folder: NoteFolderItem): boolean {
  return (
    folder.parentId == null &&
    SMART_NOTE_ROOTS.some((category) => normalizeFolderName(category) === normalizeFolderName(folder.name))
  );
}

function getFolderPathLabel(folders: NoteFolderItem[], folderId: number | null): string {
  if (folderId === null) return '';
  const folder = folders.find((item) => item.id === folderId);
  if (!folder) return '';
  const parent = folder.parentId === null ? undefined : folders.find((item) => item.id === folder.parentId);
  return parent ? `${parent.name} / ${folder.name}` : folder.name;
}

async function ensureSmartRootFolders(folders: NoteFolderItem[]): Promise<NoteFolderItem[]> {
  let next = [...folders];
  for (const category of SMART_NOTE_ROOTS) {
    const exists = next.some(
      (folder) => folder.parentId == null && normalizeFolderName(folder.name) === normalizeFolderName(category),
    );
    if (exists) continue;
    const created = await apiRequest<NoteFolderItem>('/api/note-folders', {
      method: 'POST',
      body: JSON.stringify({
        name: category,
        parentId: null,
        color: category === 'Estudios' ? '#8B5CF6' : '#3B82F6',
      }),
    });
    next = [...next, created];
  }
  return next.sort((a, b) => {
    const aRootIndex = SMART_NOTE_ROOTS.findIndex(
      (category) => isSmartRootFolder(a) && normalizeFolderName(category) === normalizeFolderName(a.name),
    );
    const bRootIndex = SMART_NOTE_ROOTS.findIndex(
      (category) => isSmartRootFolder(b) && normalizeFolderName(category) === normalizeFolderName(b.name),
    );
    if (aRootIndex >= 0 || bRootIndex >= 0) {
      if (aRootIndex < 0) return 1;
      if (bRootIndex < 0) return -1;
      return aRootIndex - bRootIndex;
    }
    return a.name.localeCompare(b.name);
  });
}

function getSmartCategoryForFolder(
  folders: NoteFolderItem[],
  folderId: number,
): SmartNoteCategory | null {
  let current = folders.find((folder) => folder.id === folderId);
  while (current) {
    if (current.parentId == null) {
      const rootName = current.name;
      return SMART_NOTE_ROOTS.find(
        (category) => normalizeFolderName(category) === normalizeFolderName(rootName),
      ) || null;
    }
    const parentId = current.parentId;
    current = folders.find((folder) => folder.id === parentId);
  }
  return null;
}

async function ensureSmartFolderPath(
  folders: NoteFolderItem[],
  category: SmartNoteCategory,
  requestedSubfolder: string,
): Promise<{ folders: NoteFolderItem[]; folderId: number }> {
  let next = [...folders];
  let root = next.find(
    (folder) => folder.parentId == null && normalizeFolderName(folder.name) === normalizeFolderName(category),
  );
  if (!root) {
    root = await apiRequest<NoteFolderItem>('/api/note-folders', {
      method: 'POST',
      body: JSON.stringify({
        name: category,
        parentId: null,
        color: category === 'Estudios' ? '#8B5CF6' : '#3B82F6',
      }),
    });
    next = [...next, root];
  }

  const subfolderName = requestedSubfolder.split(/[\\/]/).pop()?.trim().replace(/\s+/g, ' ').slice(0, 48) || '';
  if (!subfolderName || normalizeFolderName(subfolderName) === normalizeFolderName(category)) {
    return { folders: next, folderId: root.id };
  }

  let subfolder = next.find(
    (folder) =>
      folder.parentId === root.id && normalizeFolderName(folder.name) === normalizeFolderName(subfolderName),
  );
  if (!subfolder) {
    subfolder = await apiRequest<NoteFolderItem>('/api/note-folders', {
      method: 'POST',
      body: JSON.stringify({
        name: subfolderName,
        parentId: root.id,
        color: category === 'Estudios' ? '#8B5CF6' : '#3B82F6',
      }),
    });
    next = [...next, subfolder];
  }

  return { folders: next, folderId: subfolder.id };
}

function AttachmentThumb({
  attachment,
  onDownload,
  onRemove,
}: {
  attachment: NoteAttachment;
  onDownload: (att: NoteAttachment) => void;
  onRemove: (attId: number) => void;
}) {
  const [imgUrl, setImgUrl] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    let objectUrl: string | null = null;
    if (attachment.fileKind === 'image') {
      fetchPrivateStorageBlobUrl({
        storagePath: attachment.storagePath,
        mimeType: attachment.mimeType,
        displayName: attachment.fileName,
      })
        .then((url) => {
          if (mounted) {
            objectUrl = url;
            setImgUrl(url);
          } else {
            URL.revokeObjectURL(url);
          }
        })
        .catch(() => {
          if (mounted) setImgUrl(null);
        });
    }
    return () => {
      mounted = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachment.storagePath, attachment.mimeType, attachment.fileName, attachment.fileKind]);

  return (
    <div className="glass-subtle rounded-xl p-2.5 flex items-center justify-between gap-3">
      <div className="flex items-center gap-2.5 min-w-0">
        {attachment.fileKind === 'image' && imgUrl ? (
          <img
            src={imgUrl}
            alt={attachment.fileName}
            referrerPolicy="no-referrer"
            className="w-10 h-10 rounded-lg object-cover border border-zinc-200 dark:border-zinc-800 shrink-0"
          />
        ) : attachment.fileKind === 'image' ? (
          <div className="w-10 h-10 rounded-lg bg-zinc-200/70 dark:bg-zinc-800 flex items-center justify-center shrink-0">
            <ImageIcon className="w-4 h-4 text-zinc-500" />
          </div>
        ) : (
          <div className="w-10 h-10 rounded-lg bg-zinc-200/70 dark:bg-zinc-800 flex items-center justify-center shrink-0">
            <FileText className="w-4 h-4 text-zinc-500" />
          </div>
        )}
        <div className="min-w-0">
          <p className="text-xs font-medium text-zinc-900 dark:text-zinc-100 truncate">
            {attachment.fileName}
          </p>
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400 tabular-nums">
            {attachment.fileKind} · {(attachment.sizeBytes / 1024).toFixed(0)} KB
          </p>
        </div>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        <button
          type="button"
          onClick={() => onDownload(attachment)}
          title="Descargar adjunto"
          className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 cursor-pointer"
        >
          <Download className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => onRemove(attachment.id)}
          title="Quitar adjunto"
          className="p-1.5 rounded-lg text-zinc-500 hover:text-red-500 cursor-pointer"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

export function NotesView({ onDataChanged, onAskInChat }: NotesViewProps) {
  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [folders, setFolders] = useState<NoteFolderItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [filterMode, setFilterMode] = useState<NoteFilterMode>('all');
  const [selectedFolderId, setSelectedFolderId] = useState<number | 'all'>('all');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);

  const [selectedNoteId, setSelectedNoteId] = useState<number | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [organizingNote, setOrganizingNote] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftContent, setDraftContent] = useState('');
  const [draftTagsText, setDraftTagsText] = useState('');
  const [draftFolderId, setDraftFolderId] = useState<number | null>(null);
  const [previewMode, setPreviewMode] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [uploadingAtt, setUploadingAtt] = useState(false);

  const [quickOpen, setQuickOpen] = useState(false);
  const [quickText, setQuickText] = useState('');
  const [creatingNote, setCreatingNote] = useState(false);

  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [newFolderParentId, setNewFolderParentId] = useState<number | ''>('');
  const [renamingFolderId, setRenamingFolderId] = useState<number | null>(null);
  const [renameFolderVal, setRenameFolderVal] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hydratingRef = useRef(false);
  const foldersRef = useRef<NoteFolderItem[]>([]);
  const smartRootFoldersPromiseRef = useRef<Promise<NoteFolderItem[]> | null>(null);

  const loadAll = async (q = searchQuery) => {
    if (!q.trim()) setLoading(true);
    else setSearching(true);
    setError(null);
    try {
      const notesUrl = q.trim().length >= 2 ? `/api/notes?q=${encodeURIComponent(q.trim())}` : '/api/notes';
      const [noteList, folderList] = await Promise.all([
        apiRequest<NoteItem[]>(notesUrl),
        apiRequest<NoteFolderItem[]>('/api/note-folders'),
      ]);
      let rootFoldersPromise = smartRootFoldersPromiseRef.current;
      if (!rootFoldersPromise) {
        rootFoldersPromise = ensureSmartRootFolders(folderList);
        smartRootFoldersPromiseRef.current = rootFoldersPromise;
      }
      let initializedFolders = folderList;
      try {
        initializedFolders = await rootFoldersPromise;
      } catch {
        setError('No se pudieron preparar las carpetas inteligentes. Podés seguir usando tus notas.');
      } finally {
        if (smartRootFoldersPromiseRef.current === rootFoldersPromise) {
          smartRootFoldersPromiseRef.current = null;
        }
      }
      foldersRef.current = initializedFolders;
      setNotes(noteList);
      setFolders(initializedFolders);
      setSelectedNoteId((prev) => {
        if (prev && noteList.some((n) => n.id === prev)) return prev;
        return noteList[0]?.id ?? null;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar tus notas.');
    } finally {
      setLoading(false);
      setSearching(false);
    }
  };

  useEffect(() => {
    loadAll('');
  }, []);

  useEffect(() => {
    foldersRef.current = folders;
  }, [folders]);

  useEffect(() => {
    const handle = setTimeout(() => {
      if (searchQuery.trim().length === 0 || searchQuery.trim().length >= 2) {
        void loadAll(searchQuery);
      }
    }, 280);
    return () => clearTimeout(handle);
  }, [searchQuery]);

  const activeNote = useMemo(
    () => notes.find((n) => n.id === selectedNoteId) || null,
    [notes, selectedNoteId],
  );

  // Sync draft state when switching selected note
  useEffect(() => {
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    hydratingRef.current = true;
    if (activeNote) {
      setDraftTitle(activeNote.title);
      setDraftContent(activeNote.content);
      setDraftTagsText((activeNote.tags || []).join(', '));
      setDraftFolderId(activeNote.folderId ?? null);
      setSaveState('idle');
    } else {
      setDraftTitle('');
      setDraftContent('');
      setDraftTagsText('');
      setDraftFolderId(null);
    }
    const t = setTimeout(() => {
      hydratingRef.current = false;
    }, 30);
    return () => clearTimeout(t);
  }, [activeNote?.id]);

  // Debounced auto-save
  useEffect(() => {
    if (hydratingRef.current || !activeNote) return;

    const parsedTags = draftTagsText
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const originalTags = activeNote.tags || [];
    const tagsChanged =
      parsedTags.length !== originalTags.length ||
      parsedTags.some((t, i) => t !== originalTags[i]);

    const changed =
      draftTitle !== activeNote.title ||
      draftContent !== activeNote.content ||
      draftFolderId !== (activeNote.folderId ?? null) ||
      tagsChanged;

    if (!changed) return;

    setSaveState('saving');
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    const targetId = activeNote.id;

    autoSaveTimerRef.current = setTimeout(async () => {
      try {
        const updated = await apiRequest<NoteItem>(`/api/notes/${targetId}`, {
          method: 'PATCH',
          body: JSON.stringify({
            title: draftTitle.trim() || 'Nota sin título',
            content: draftContent,
            folderId: draftFolderId,
            tags: parsedTags,
            recomputeEmbedding: true,
          }),
        });
        setNotes((prev) => prev.map((n) => (n.id === targetId ? updated : n)));
        setSaveState('saved');
        onDataChanged();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error al autoguardar nota.');
        setSaveState('idle');
      }
    }, 750);

    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, [draftTitle, draftContent, draftTagsText, draftFolderId]);

  useEffect(() => {
    if (!editorOpen || !activeNote || !draftContent.trim()) return;
    const content = draftContent.trim();
    const waitingForInitialTitle = activeNote.title === 'Generando título…';
    const alreadyOrganized =
      activeNote.folderId !== null &&
      getSmartCategoryForFolder(foldersRef.current, activeNote.folderId) !== null &&
      !waitingForInitialTitle;
    if (content === activeNote.content.trim() && alreadyOrganized) return;

    let cancelled = false;
    const timer = setTimeout(async () => {
      setOrganizingNote(true);
      try {
        const organization = await apiRequest<NoteOrganization>('/api/ai/note-organization', {
          method: 'POST',
          body: JSON.stringify({ content }),
        });
        if (cancelled) return;

        const folderPath = await ensureSmartFolderPath(
          foldersRef.current,
          organization.category,
          organization.subfolderName,
        );
        if (cancelled) return;

        foldersRef.current = folderPath.folders;
        setFolders(folderPath.folders);
        setDraftTitle(organization.title);
        setDraftFolderId(folderPath.folderId);
      } catch (err) {
        if (!cancelled) {
          if (draftTitle === 'Generando título…') setDraftTitle('Nota nueva');
          setError(err instanceof Error ? err.message : 'No se pudo organizar la nota automáticamente.');
        }
      } finally {
        if (!cancelled) setOrganizingNote(false);
      }
    }, 1000);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      setOrganizingNote(false);
    };
  }, [activeNote?.id, activeNote?.title, draftContent, editorOpen]);

  const handleCloseEditor = async () => {
    if (!activeNote) {
      setEditorOpen(false);
      return;
    }

    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }

    const parsedTags = draftTagsText.split(',').map((tag) => tag.trim()).filter(Boolean);
    const titleToSave = draftContent.trim() ? draftTitle.trim() || 'Nota nueva' : 'Nueva nota';
    const originalTags = activeNote.tags || [];
    const changed =
      titleToSave !== activeNote.title ||
      draftContent !== activeNote.content ||
      draftFolderId !== (activeNote.folderId ?? null) ||
      parsedTags.length !== originalTags.length ||
      parsedTags.some((tag, index) => tag !== originalTags[index]);

    if (changed) {
      setSaveState('saving');
      try {
        const updated = await apiRequest<NoteItem>(`/api/notes/${activeNote.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            title: titleToSave,
            content: draftContent,
            folderId: draftFolderId,
            tags: parsedTags,
            recomputeEmbedding: true,
          }),
        });
        setNotes((previous) => previous.map((note) => (note.id === updated.id ? updated : note)));
        setDraftTitle(titleToSave);
        setSaveState('saved');
        onDataChanged();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'No se pudieron guardar los últimos cambios.');
        setSaveState('idle');
        return;
      }
    }

    setEditorOpen(false);
  };

  const handleCreateNote = async (isQuick = false, customText?: string) => {
    if (creatingNote) return;
    setCreatingNote(true);
    setError(null);
    try {
      const content = isQuick ? (customText || '').trim() : '';
      const selectedFolder =
        typeof selectedFolderId === 'number'
          ? foldersRef.current.find((folder) => folder.id === selectedFolderId)
          : undefined;
      const selectedCategory =
        typeof selectedFolderId === 'number'
          ? getSmartCategoryForFolder(foldersRef.current, selectedFolderId)
          : null;
      const category = selectedCategory || 'Vida diaria';
      const defaultPath = await ensureSmartFolderPath(foldersRef.current, category, '');
      const folderId = selectedCategory && selectedFolder ? selectedFolder.id : defaultPath.folderId;
      foldersRef.current = defaultPath.folders;
      setFolders(defaultPath.folders);

      const title = 'Generando título…';
      const created = await apiRequest<NoteItem>('/api/notes', {
        method: 'POST',
        body: JSON.stringify({
          title,
          content,
          folderId,
          tags: selectedTag ? [selectedTag] : [],
          isQuick,
        }),
      });
      setNotes((prev) => [created, ...prev]);
      setSelectedNoteId(created.id);
      setEditorOpen(true);
      setPreviewMode(false);
      if (filterMode === 'archived') setFilterMode('all');
      if (isQuick) {
        setQuickText('');
        setQuickOpen(false);
      }
      onDataChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear la nota.');
    } finally {
      setCreatingNote(false);
    }
  };

  const handleTogglePin = async (note: NoteItem) => {
    try {
      const updated = await apiRequest<NoteItem>(`/api/notes/${note.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isPinned: !note.isPinned }),
      });
      setNotes((prev) => prev.map((n) => (n.id === note.id ? updated : n)));
      onDataChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo fijar la nota.');
    }
  };

  const handleToggleArchive = async (note: NoteItem) => {
    try {
      const updated = await apiRequest<NoteItem>(`/api/notes/${note.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isArchived: !note.isArchived }),
      });
      setNotes((prev) => prev.map((n) => (n.id === note.id ? updated : n)));
      if (selectedNoteId === note.id && !note.isArchived) setEditorOpen(false);
      onDataChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo archivar la nota.');
    }
  };

  const handleDeleteNote = async (id: number) => {
    try {
      await apiRequest(`/api/notes/${id}`, { method: 'DELETE' });
      const remaining = notes.filter((n) => n.id !== id);
      setNotes(remaining);
      if (selectedNoteId === id) {
        setSelectedNoteId(remaining[0]?.id ?? null);
        setEditorOpen(false);
      }
      onDataChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo enviar a la papelera.');
    }
  };

  const handleUploadAttachment = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!activeNote) return;
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setUploadingAtt(true);
    setError(null);
    try {
      for (const file of files) {
        if (file.size > 20 * 1024 * 1024) {
          setError(`"${file.name}" supera el límite de 20 MB.`);
          continue;
        }
        const base64Data = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => {
            const result = typeof reader.result === 'string' ? reader.result : '';
            resolve(result.includes(',') ? result.split(',')[1] : result);
          };
          reader.readAsDataURL(file);
        });
        const res = await apiRequest<{ attachment: NoteAttachment; attachments: NoteAttachment[] }>(
          `/api/notes/${activeNote.id}/attachments`,
          {
            method: 'POST',
            body: JSON.stringify({
              name: file.name,
              mimeType: file.type || 'application/octet-stream',
              base64Data,
            }),
          },
        );
        setNotes((prev) =>
          prev.map((n) => (n.id === activeNote.id ? { ...n, attachments: res.attachments } : n)),
        );
      }
      onDataChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo adjuntar el archivo.');
    } finally {
      setUploadingAtt(false);
      e.target.value = '';
    }
  };

  const handleRemoveAttachment = async (attId: number) => {
    if (!activeNote) return;
    const nextAttachments = (activeNote.attachments || []).filter((a) => a.id !== attId);
    try {
      const updated = await apiRequest<NoteItem>(`/api/notes/${activeNote.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ attachments: nextAttachments }),
      });
      setNotes((prev) => prev.map((n) => (n.id === activeNote.id ? updated : n)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo quitar el adjunto.');
    }
  };

  const handleDownloadAttachment = async (att: NoteAttachment) => {
    try {
      const url = await fetchPrivateStorageBlobUrl({
        storagePath: att.storagePath,
        mimeType: att.mimeType,
        displayName: att.fileName,
      });
      const a = document.createElement('a');
      a.href = url;
      a.download = att.fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo descargar el adjunto.');
    }
  };

  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;
    const parentId = newFolderParentId === '' ? null : Number(newFolderParentId);
    const reservedRoot =
      parentId === null &&
      SMART_NOTE_ROOTS.some(
        (category) => normalizeFolderName(category) === normalizeFolderName(newFolderName),
      );
    if (reservedRoot) {
      setError('Estudios y Vida diaria son categorías principales y no se pueden duplicar.');
      return;
    }
    try {
      const created = await apiRequest<NoteFolderItem>('/api/note-folders', {
        method: 'POST',
        body: JSON.stringify({
          name: newFolderName.trim(),
          parentId,
        }),
      });
      setFolders((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      setNewFolderName('');
      setNewFolderParentId('');
      setShowNewFolder(false);
      onDataChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear la carpeta.');
    }
  };

  const handleRenameFolder = async (folderId: number) => {
    const trimmed = renameFolderVal.trim();
    const folder = folders.find((item) => item.id === folderId);
    if (folder && isSmartRootFolder(folder)) {
      setError('Las categorías principales Estudios y Vida diaria no se pueden renombrar.');
      setRenamingFolderId(null);
      return;
    }
    if (!trimmed) {
      setRenamingFolderId(null);
      return;
    }
    try {
      const updated = await apiRequest<NoteFolderItem>(`/api/note-folders/${folderId}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: trimmed }),
      });
      setFolders((prev) => prev.map((f) => (f.id === folderId ? updated : f)));
      setRenamingFolderId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo renombrar la carpeta.');
    }
  };

  const handleDeleteFolder = async (folderId: number) => {
    const folder = folders.find((item) => item.id === folderId);
    if (folder && isSmartRootFolder(folder)) {
      setError('Las categorías principales Estudios y Vida diaria no se pueden eliminar.');
      return;
    }
    try {
      await apiRequest(`/api/note-folders/${folderId}`, { method: 'DELETE' });
      setFolders((prev) => prev.filter((f) => f.id !== folderId));
      if (selectedFolderId === folderId) setSelectedFolderId('all');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo eliminar la carpeta.');
    }
  };

  const getFolderBranchIds = (rootId: number): number[] => {
    const kids = folders.filter((f) => f.parentId === rootId);
    return [rootId, ...kids.flatMap((k) => getFolderBranchIds(k.id))];
  };

  const allTags = useMemo(() => {
    const map = new Map<string, number>();
    for (const n of notes) {
      if (n.isArchived) continue;
      for (const t of n.tags || []) {
        map.set(t, (map.get(t) || 0) + 1);
      }
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [notes]);

  const visibleNotes = useMemo(() => {
    return notes.filter((n) => {
      if (filterMode === 'archived') {
        if (!n.isArchived) return false;
      } else {
        if (n.isArchived) return false;
        if (filterMode === 'pinned' && !n.isPinned) return false;
        if (filterMode === 'quick' && !n.isQuick) return false;
      }
      if (selectedFolderId !== 'all') {
        const branch = getFolderBranchIds(selectedFolderId);
        if (n.folderId === null || !branch.includes(n.folderId)) return false;
      }
      if (selectedTag && !(n.tags || []).includes(selectedTag)) return false;
      return true;
    });
  }, [notes, filterMode, selectedFolderId, selectedTag, folders]);

  const formatDate = (iso: string) => {
    try {
      return new Intl.DateTimeFormat('es-UY', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(iso));
    } catch {
      return iso;
    }
  };

  const renderFolderTree = (parentId: number | null = null, depth = 0) => {
    const branch = folders.filter((f) => (f.parentId ?? null) === parentId);
    return branch.map((fld) => {
      const branchIds = getFolderBranchIds(fld.id);
      const count = notes.filter(
        (note) => !note.isArchived && note.folderId !== null && branchIds.includes(note.folderId),
      ).length;
      const active = selectedFolderId === fld.id;
      const isSmartRoot = isSmartRootFolder(fld);
      const isRenaming = renamingFolderId === fld.id;
      return (
        <div key={fld.id}>
          <div
            style={{ paddingLeft: `${depth * 14 + 8}px` }}
            className={`group flex items-center justify-between pr-2 py-1.5 rounded-lg text-xs transition-colors ${
              active
                ? 'bg-violet-600/15 text-violet-700 dark:text-violet-300 font-medium'
                : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200/50 dark:hover:bg-white/5'
            }`}
          >
            {isRenaming ? (
              <div className="flex items-center gap-1 flex-1 min-w-0">
                <input
                  type="text"
                  autoFocus
                  value={renameFolderVal}
                  onChange={(e) => setRenameFolderVal(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleRenameFolder(fld.id);
                    if (e.key === 'Escape') setRenamingFolderId(null);
                  }}
                  className="flex-1 min-w-0 px-2 py-1 rounded border border-violet-500 bg-white dark:bg-[#09090B] text-xs"
                />
                <button
                  type="button"
                  onClick={() => handleRenameFolder(fld.id)}
                  className="p-1 text-emerald-500 cursor-pointer"
                >
                  <Check className="w-3 h-3" />
                </button>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setSelectedFolderId(fld.id)}
                  className="flex items-center gap-1.5 flex-1 min-w-0 text-left cursor-pointer"
                >
                  <Folder className="w-3.5 h-3.5 shrink-0 opacity-75" />
                  <span className="truncate">{fld.name}</span>
                </button>
                <div className="flex items-center gap-1 shrink-0">
                  {!isSmartRoot && (
                    <div className="hidden group-hover:flex items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() => {
                        setRenamingFolderId(fld.id);
                        setRenameFolderVal(fld.name);
                      }}
                      title="Renombrar carpeta"
                      className="p-0.5 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 cursor-pointer"
                    >
                      <Edit3 className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteFolder(fld.id)}
                      title="Eliminar carpeta"
                      className="p-0.5 text-zinc-400 hover:text-red-500 cursor-pointer"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                    </div>
                  )}
                  <span className="tabular-nums text-zinc-400">{count}</span>
                </div>
              </>
            )}
          </div>
          {renderFolderTree(fld.id, depth + 1)}
        </div>
      );
    });
  };

  return (
    <div
      className={
        editorOpen
          ? 'fixed inset-0 z-[70] h-[var(--silvv-visual-viewport-height,100dvh)] w-full overflow-hidden bg-zinc-50 dark:bg-[#09090B] silvv-ambient-bg'
          : 'space-y-5 animate-silvv-in'
      }
    >
      {!editorOpen && (
        <>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="font-display text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                Notas
              </h1>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                Tus apuntes e ideas con autoguardado, carpetas, etiquetas, adjuntos y conexión directa con ambos chats.
              </p>
            </div>

            <button
              type="button"
              onClick={() => setQuickOpen((value) => !value)}
              aria-pressed={quickOpen}
              className="inline-flex items-center gap-1.5 self-start sm:self-auto px-3.5 py-2 rounded-xl glass-panel text-xs font-medium text-zinc-800 dark:text-zinc-200 hover:border-violet-500/40 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <Zap className="w-3.5 h-3.5 text-amber-500" />
              <span>Nota rápida</span>
            </button>
          </div>

          <button
            type="button"
            disabled={creatingNote || loading}
            onClick={() => void handleCreateNote(false)}
            aria-label="Crear una nueva nota"
            className="group relative flex w-full items-center gap-4 overflow-hidden rounded-2xl border border-violet-400/30 bg-gradient-to-r from-violet-600 via-violet-600 to-indigo-600 px-5 py-5 text-left text-white shadow-[0_14px_38px_-18px_rgba(124,58,237,0.75)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_18px_44px_-18px_rgba(124,58,237,0.85)] active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-50 disabled:cursor-wait disabled:opacity-70 dark:focus-visible:ring-offset-[#09090B]"
          >
            <span className="absolute -right-8 -top-10 h-32 w-32 rounded-full bg-white/10 blur-2xl transition-transform duration-300 group-hover:scale-125" aria-hidden="true" />
            <span className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/25 shadow-inner">
              <Plus className="h-6 w-6 transition-transform duration-200 group-hover:rotate-90" aria-hidden="true" />
            </span>
            <span className="relative min-w-0 flex-1">
              <span className="block font-display text-lg font-semibold tracking-tight">Nueva nota</span>
              <span className="mt-0.5 block text-sm text-violet-100">Escribí libremente. La IA crea el título y la organiza por vos.</span>
            </span>
            <span className="relative hidden text-sm font-medium text-violet-100 sm:block">Crear</span>
          </button>
        </>
      )}

      {!editorOpen && quickOpen && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (quickText.trim()) void handleCreateNote(true, quickText);
          }}
          className="glass-panel rounded-2xl p-4 flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5"
        >
          <input
            type="text"
            autoFocus
            value={quickText}
            onChange={(e) => setQuickText(e.target.value)}
            placeholder="Escribí una nota rápida (Enter para guardar al instante)..."
            className="flex-1 min-w-0 px-3.5 py-2 rounded-xl border border-zinc-200/80 dark:border-white/10 bg-white/70 dark:bg-black/30 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
          />
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setQuickOpen(false)}
              className="px-3 py-2 rounded-xl text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 cursor-pointer whitespace-nowrap"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!quickText.trim() || creatingNote || loading}
              className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white text-xs font-medium cursor-pointer whitespace-nowrap"
            >
              Guardar rápida
            </button>
          </div>
        </form>
      )}

      {error && (
        <div className="p-3.5 rounded-xl border border-red-300 dark:border-red-900/60 bg-red-50/80 dark:bg-red-950/30 text-sm text-red-700 dark:text-red-300 flex items-center justify-between gap-2">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} className="cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className={editorOpen ? 'h-full min-h-0' : 'grid grid-cols-1 lg:grid-cols-12 gap-5'}>
        {!editorOpen && (
          <aside className="order-2 lg:order-1 lg:col-span-3 glass-panel rounded-2xl p-4 space-y-5 self-start">
          <div className="space-y-1">
            <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400 px-2 pb-1">
              Vistas
            </p>
            {(
              [
                { id: 'all', label: 'Todas las notas', count: notes.filter((n) => !n.isArchived).length },
                { id: 'pinned', label: 'Fijadas', count: notes.filter((n) => !n.isArchived && n.isPinned).length },
                { id: 'quick', label: 'Notas rápidas', count: notes.filter((n) => !n.isArchived && n.isQuick).length },
                { id: 'archived', label: 'Archivadas', count: notes.filter((n) => n.isArchived).length },
              ] as const
            ).map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => setFilterMode(v.id)}
                className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs cursor-pointer transition-colors ${
                  filterMode === v.id
                    ? 'bg-violet-600/15 text-violet-700 dark:text-violet-300 font-medium'
                    : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200/50 dark:hover:bg-white/5'
                }`}
              >
                <span className="truncate">{v.label}</span>
                <span className="tabular-nums text-zinc-400">{v.count}</span>
              </button>
            ))}
          </div>

          <div className="space-y-1.5 pt-3 border-t border-zinc-200/70 dark:border-white/10">
            <div className="flex items-center justify-between px-2">
              <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Carpetas</p>
              <button
                type="button"
                onClick={() => setShowNewFolder((v) => !v)}
                title="Nueva carpeta de notas"
                className="p-1 rounded-md text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 cursor-pointer"
              >
                <FolderPlus className="w-3.5 h-3.5" />
              </button>
            </div>

            {showNewFolder && (
              <form onSubmit={handleCreateFolder} className="p-2 rounded-xl glass-subtle space-y-2">
                <input
                  type="text"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  placeholder="Nombre..."
                  className="w-full px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-white/10 bg-white/80 dark:bg-black/40 text-xs"
                />
                <select
                  value={newFolderParentId}
                  onChange={(e) =>
                    setNewFolderParentId(e.target.value ? Number(e.target.value) : '')
                  }
                  className="w-full px-2 py-1.5 rounded-lg border border-zinc-200 dark:border-white/10 bg-white/80 dark:bg-black/40 text-xs"
                >
                  <option value="">Carpeta raíz</option>
                  {folders.map((f) => (
                    <option key={f.id} value={f.id}>
                      Dentro de: {f.name}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  disabled={!newFolderName.trim()}
                  className="w-full py-1.5 rounded-lg bg-violet-600 text-white text-xs font-medium cursor-pointer"
                >
                  Crear carpeta
                </button>
              </form>
            )}

            <button
              type="button"
              onClick={() => setSelectedFolderId('all')}
              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs cursor-pointer ${
                selectedFolderId === 'all'
                  ? 'bg-violet-600/15 text-violet-700 dark:text-violet-300 font-medium'
                  : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200/50 dark:hover:bg-white/5'
              }`}
            >
              <span>Todas las carpetas</span>
              <span className="tabular-nums text-zinc-400">{folders.length}</span>
            </button>

            {renderFolderTree(null, 0)}
          </div>

          {allTags.length > 0 && (
            <div className="space-y-2 pt-3 border-t border-zinc-200/70 dark:border-white/10">
              <div className="flex items-center justify-between px-2">
                <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Etiquetas</p>
                {selectedTag && (
                  <button
                    type="button"
                    onClick={() => setSelectedTag(null)}
                    className="text-[11px] text-violet-600 dark:text-violet-400 hover:underline cursor-pointer"
                  >
                    Limpiar
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5 px-1">
                {allTags.slice(0, 18).map(([tag, count]) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => setSelectedTag((prev) => (prev === tag ? null : tag))}
                    className={`px-2 py-1 rounded-lg text-xs transition-colors cursor-pointer ${
                      selectedTag === tag
                        ? 'bg-violet-600 text-white'
                        : 'glass-subtle text-zinc-600 dark:text-zinc-300 hover:border-violet-500/40'
                    }`}
                  >
                    #{tag} ({count})
                  </button>
                ))}
              </div>
            </div>
          )}
          </aside>
        )}

        {/* Notes List + Editor Split */}
        <div className={editorOpen ? 'h-full min-h-0' : 'order-1 lg:order-2 lg:col-span-9 grid grid-cols-1 xl:grid-cols-12 gap-5'}>
          {!editorOpen && (
            <div className="xl:col-span-5 glass-panel rounded-2xl flex flex-col overflow-hidden max-h-[760px]">
            <div className="p-3.5 border-b border-zinc-200/70 dark:border-white/10 space-y-2">
              <div className="relative">
                <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Buscar por palabras o significado..."
                  className="w-full pl-9 pr-8 py-2 rounded-xl border border-zinc-200/80 dark:border-white/10 bg-white/70 dark:bg-black/30 text-xs text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-700 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              {searching && (
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400 px-1">
                  Buscando por coincidencia y significado semántico...
                </p>
              )}
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-zinc-200/60 dark:divide-white/5">
              {loading ? (
                <div className="p-4 space-y-3">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-16 rounded-xl bg-zinc-200/60 dark:bg-white/5 animate-pulse" />
                  ))}
                </div>
              ) : visibleNotes.length === 0 ? (
                <div className="p-8 text-center space-y-2">
                  <StickyNote className="w-6 h-6 text-zinc-400 mx-auto" />
                  <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                    No hay notas en esta vista
                  </p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Creá una nota nueva o pedile al Chat general: "Guardá esto como una nota: ..."
                  </p>
                </div>
              ) : (
                visibleNotes.map((n) => {
                  const active = n.id === selectedNoteId;
                  const folderName = getFolderPathLabel(folders, n.folderId);
                  return (
                    <button
                      key={n.id}
                      type="button"
                      onClick={() => {
                        setSelectedNoteId(n.id);
                        setEditorOpen(true);
                        setPreviewMode(false);
                      }}
                      className={`w-full text-left px-4 py-3.5 transition-colors cursor-pointer space-y-1 ${
                        active
                          ? 'bg-violet-600/10 dark:bg-violet-500/15'
                          : 'hover:bg-zinc-100/70 dark:hover:bg-white/5'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                          {n.title}
                        </p>
                        {n.isPinned && <Pin className="w-3.5 h-3.5 text-violet-500 shrink-0" />}
                      </div>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400 line-clamp-2">
                        {n.content.trim() || 'Nota vacía'}
                      </p>
                      <p className="text-[11px] text-zinc-500 dark:text-zinc-400 tabular-nums truncate">
                        {n.isQuick ? 'Nota rápida · ' : ''}
                        {folderName ? `${folderName} · ` : ''}
                        {n.tags && n.tags.length > 0 ? `#${n.tags.slice(0, 3).join(' #')} · ` : ''}
                        {new Date(n.updatedAt || n.createdAt).toLocaleDateString('es-UY', {
                          day: '2-digit',
                          month: 'short',
                        })}
                      </p>
                    </button>
                  );
                })
              )}
            </div>
            </div>
          )}

          {/* Note Editor / Detail */}
          <div
            className={
              editorOpen
                ? 'h-full min-h-0 w-full glass-panel rounded-none border-0 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] sm:px-8 flex flex-col gap-4 overflow-y-auto animate-silvv-editor-in'
                : 'xl:col-span-7 glass-panel rounded-2xl p-5 flex flex-col gap-4 min-h-[560px]'
            }
          >
            {!editorOpen ? (
              <div className="hidden xl:flex flex-col m-auto text-center max-w-sm space-y-3 py-12">
                <p className="font-display text-base font-medium text-zinc-900 dark:text-zinc-100">
                  Tu historial, siempre a mano
                </p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
                  Elegí una nota para editarla en pantalla completa. Cada cambio se guarda automáticamente.
                </p>
              </div>
            ) : !activeNote ? (
              <div className="m-auto text-center max-w-sm space-y-3 py-12">
                <p className="font-display text-base font-medium text-zinc-900 dark:text-zinc-100">
                  Seleccioná o creá una nota
                </p>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-zinc-200/70 dark:border-white/10">
                  <div className="flex flex-1 items-center gap-3 min-w-0">
                  <button
                    type="button"
                    onClick={() => void handleCloseEditor()}
                    aria-label="Volver al historial de notas"
                    title="Volver al historial"
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl glass-subtle text-zinc-600 dark:text-zinc-300 transition-colors hover:text-zinc-950 dark:hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
                  >
                    <X className="h-5 w-5" aria-hidden="true" />
                  </button>
                  <div className="min-w-0">
                    <div className="mb-1 flex flex-wrap items-center gap-1.5 text-[11px] font-medium text-violet-600 dark:text-violet-300">
                      <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>
                        {organizingNote
                          ? 'La IA está organizando tu nota'
                          : !draftContent.trim()
                            ? 'Escribí para empezar'
                            : 'Título sugerido por IA'}
                      </span>
                      <span className="text-zinc-400 dark:text-zinc-500" aria-hidden="true">·</span>
                      <span className="text-zinc-500 dark:text-zinc-400">
                        {saveState === 'saving'
                          ? 'Guardando…'
                          : saveState === 'saved'
                            ? 'Guardado automáticamente'
                            : 'Sincronizado'}
                      </span>
                    </div>
                    <h1 className="truncate font-display text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-xl">
                      {draftTitle === 'Generando título…' && !draftContent.trim()
                        ? 'Tu nueva nota'
                        : draftTitle || 'Nota nueva'}
                    </h1>
                    <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400 tabular-nums">
                      Creada {formatDate(activeNote.createdAt)} · Actualizada {formatDate(activeNote.updatedAt)}
                    </p>
                  </div>
                </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => setPreviewMode((v) => !v)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg glass-subtle text-xs font-medium text-zinc-700 dark:text-zinc-200 cursor-pointer whitespace-nowrap"
                    >
                      {previewMode ? <Edit3 className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      <span>{previewMode ? 'Editar' : 'Vista previa'}</span>
                    </button>
                    {onAskInChat && (
                      <button
                        type="button"
                        onClick={() =>
                          onAskInChat(
                            `Sobre mi nota "${activeNote.title}": ${activeNote.content.slice(0, 600)}`,
                          )
                        }
                        title="Conversar sobre esta nota en el Chat"
                        className="p-1.5 rounded-lg glass-subtle text-zinc-600 dark:text-zinc-300 hover:text-violet-500 cursor-pointer"
                      >
                        <MessageSquare className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleTogglePin(activeNote)}
                      title={activeNote.isPinned ? 'Desfijar' : 'Fijar arriba'}
                      className={`p-1.5 rounded-lg glass-subtle cursor-pointer ${
                        activeNote.isPinned ? 'text-violet-500' : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100'
                      }`}
                    >
                      {activeNote.isPinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleToggleArchive(activeNote)}
                      title={activeNote.isArchived ? 'Desarchivar' : 'Archivar'}
                      className="p-1.5 rounded-lg glass-subtle text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 cursor-pointer"
                    >
                      {activeNote.isArchived ? (
                        <ArchiveRestore className="w-3.5 h-3.5" />
                      ) : (
                        <Archive className="w-3.5 h-3.5" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteNote(activeNote.id)}
                      title="Enviar a papelera"
                      className="p-1.5 rounded-lg glass-subtle text-zinc-500 hover:text-red-500 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] text-zinc-500 dark:text-zinc-400 mb-1">
                      Carpeta
                    </label>
                    <select
                      value={draftFolderId ?? ''}
                      onChange={(e) =>
                        setDraftFolderId(e.target.value ? Number(e.target.value) : null)
                      }
                      className="w-full px-3 py-1.5 rounded-xl border border-zinc-200/80 dark:border-white/10 bg-white/70 dark:bg-black/30 text-xs text-zinc-900 dark:text-zinc-100"
                    >
                      <option value="">Sin carpeta (por clasificar)</option>
                      {folders.map((folder) => (
                        <option key={folder.id} value={folder.id}>
                          {getFolderPathLabel(folders, folder.id)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] text-zinc-500 dark:text-zinc-400 mb-1">
                      Etiquetas (separadas por coma)
                    </label>
                    <input
                      type="text"
                      value={draftTagsText}
                      onChange={(e) => setDraftTagsText(e.target.value)}
                      placeholder="ideas, estudio, proyecto"
                      className="w-full px-3 py-1.5 rounded-xl border border-zinc-200/80 dark:border-white/10 bg-white/70 dark:bg-black/30 text-xs text-zinc-900 dark:text-zinc-100"
                    />
                  </div>
                </div>

                {previewMode ? (
                  <div className={`flex-1 ${editorOpen ? 'min-h-[140px]' : 'min-h-[260px]'} p-4 rounded-xl glass-subtle overflow-y-auto`}>
                    <MarkdownRenderer content={draftContent || '*Nota vacía.*'} />
                  </div>
                ) : (
                  <textarea
                    aria-label="Contenido de la nota"
                    value={draftContent}
                    onChange={(e) => setDraftContent(e.target.value)}
                    placeholder="Escribí libremente tus ideas, apuntes, borradores o listas (admite Markdown)..."
                    className={`flex-1 ${editorOpen ? 'min-h-[140px]' : 'min-h-[260px]'} w-full resize-none p-4 rounded-xl border border-zinc-200/80 dark:border-white/10 bg-white/60 dark:bg-black/25 text-sm text-zinc-900 dark:text-zinc-100 leading-relaxed focus:outline-none focus:ring-2 focus:ring-violet-500/35`}
                  />
                )}

                {/* Attachments */}
                <div className="pt-3 border-t border-zinc-200/70 dark:border-white/10 space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
                      Adjuntos ({activeNote.attachments?.length || 0})
                    </span>
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      accept="image/*,application/pdf,audio/*,text/*,.md,.csv,.json"
                      onChange={handleUploadAttachment}
                      className="hidden"
                    />
                    <button
                      type="button"
                      disabled={uploadingAtt}
                      onClick={() => fileInputRef.current?.click()}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl glass-subtle text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:border-violet-500/40 cursor-pointer whitespace-nowrap"
                    >
                      <Paperclip className="w-3.5 h-3.5" />
                      <span>{uploadingAtt ? 'Subiendo...' : 'Adjuntar imagen o documento'}</span>
                    </button>
                  </div>

                  {activeNote.attachments && activeNote.attachments.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {activeNote.attachments.map((att) => (
                        <AttachmentThumb
                          key={att.id}
                          attachment={att}
                          onDownload={handleDownloadAttachment}
                          onRemove={handleRemoveAttachment}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
