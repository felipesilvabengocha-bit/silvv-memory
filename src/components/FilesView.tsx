import { useEffect, useState } from 'react';
import {
  ChevronRight,
  Download,
  Edit3,
  Folder,
  FolderPlus,
  Trash2,
  Check,
  X,
} from 'lucide-react';
import {
  apiRequest,
  fetchPrivateFileBlobUrl,
  type FileItem,
  type FolderItem,
} from '../lib/api';

interface FilesViewProps {
  onDataChanged: () => void;
  onGoToChat: () => void;
}

export function FilesView({ onDataChanged, onGoToChat }: FilesViewProps) {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<number | 'all'>('all');
  const [selectedFile, setSelectedFile] = useState<FileItem | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [newFolderName, setNewFolderName] = useState('');
  const [newFolderParentId, setNewFolderParentId] = useState<number | ''>('');
  const [showNewFolder, setShowNewFolder] = useState(false);

  const [renamingFolderId, setRenamingFolderId] = useState<number | null>(null);
  const [renameFolderValue, setRenameFolderValue] = useState('');

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [fls, flds] = await Promise.all([
        apiRequest<FileItem[]>('/api/files'),
        apiRequest<FolderItem[]>('/api/folders'),
      ]);
      setFiles(fls);
      setFolders(flds);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar carpetas y archivos.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    let activeUrl: string | null = null;
    if (selectedFile && selectedFile.fileKind === 'image') {
      fetchPrivateFileBlobUrl(selectedFile.id)
        .then((url) => {
          activeUrl = url;
          setPreviewUrl(url);
        })
        .catch(() => setPreviewUrl(null));
    } else {
      setPreviewUrl(null);
    }
    return () => {
      if (activeUrl) URL.revokeObjectURL(activeUrl);
    };
  }, [selectedFile?.id]);

  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;
    try {
      const created = await apiRequest<FolderItem>('/api/folders', {
        method: 'POST',
        body: JSON.stringify({
          name: newFolderName.trim(),
          parentId: newFolderParentId === '' ? null : Number(newFolderParentId),
        }),
      });
      setFolders((prev) => [...prev, created]);
      setNewFolderName('');
      setNewFolderParentId('');
      setShowNewFolder(false);
      onDataChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear la carpeta.');
    }
  };

  const handleRenameFolder = async (folderId: number) => {
    const trimmed = renameFolderValue.trim();
    if (!trimmed) {
      setRenamingFolderId(null);
      return;
    }
    try {
      const updated = await apiRequest<FolderItem>(`/api/folders/${folderId}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: trimmed }),
      });
      setFolders((prev) => prev.map((f) => (f.id === folderId ? updated : f)));
      setRenamingFolderId(null);
      onDataChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo renombrar la carpeta.');
    }
  };

  const handleDeleteFolder = async (folderId: number) => {
    try {
      await apiRequest(`/api/folders/${folderId}`, { method: 'DELETE' });
      setFolders((prev) => prev.filter((f) => f.id !== folderId));
      if (selectedFolderId === folderId) setSelectedFolderId('all');
      onDataChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo eliminar la carpeta.');
    }
  };

  const handleMoveFolder = async (fileId: number, folderId: number | null) => {
    try {
      const updated = await apiRequest<FileItem>(`/api/files/${fileId}`, {
        method: 'PATCH',
        body: JSON.stringify({ folderId, processingStatus: 'organized' }),
      });
      setFiles((prev) => prev.map((f) => (f.id === fileId ? updated : f)));
      if (selectedFile?.id === fileId) setSelectedFile(updated);
      onDataChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo mover el archivo.');
    }
  };

  const handleDownload = async (file: FileItem) => {
    try {
      const url = await fetchPrivateFileBlobUrl(file.id);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.displayName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo descargar el archivo.');
    }
  };

  const handleDeleteFile = async (id: number) => {
    try {
      await apiRequest(`/api/files/${id}`, { method: 'DELETE' });
      setFiles((prev) => prev.filter((f) => f.id !== id));
      if (selectedFile?.id === id) setSelectedFile(null);
      onDataChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al eliminar archivo.');
    }
  };

  // Build hierarchical folder order (roots + children)
  const getFolderBranchIds = (rootId: number): number[] => {
    const kids = folders.filter((f) => f.parentId === rootId);
    return [rootId, ...kids.flatMap((k) => getFolderBranchIds(k.id))];
  };

  const visibleFiles = files.filter((f) => {
    if (selectedFolderId === 'all') return true;
    const branchIds = getFolderBranchIds(selectedFolderId);
    return f.folderId !== null && branchIds.includes(f.folderId);
  });

  const getFolderLabel = (f: FolderItem): string => {
    if (!f.parentId) return f.name;
    const parent = folders.find((p) => p.id === f.parentId);
    return parent ? `${parent.name} / ${f.name}` : f.name;
  };

  const renderFolderTree = (parentId: number | null = null, depth = 0) => {
    const branch = folders.filter((f) => (f.parentId ?? null) === parentId);
    return branch.map((fld) => {
      const count = files.filter((f) => f.folderId === fld.id).length;
      const active = selectedFolderId === fld.id;
      const isRenaming = renamingFolderId === fld.id;
      return (
        <div key={fld.id}>
          <div
            style={{ paddingLeft: `${depth * 14 + 8}px` }}
            className={`group flex items-center justify-between pr-2 py-1.5 rounded-lg text-sm transition-colors ${
              active
                ? 'bg-violet-600/10 text-violet-700 dark:text-violet-300 font-medium'
                : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800/60'
            }`}
          >
            {isRenaming ? (
              <div className="flex items-center gap-1 flex-1 min-w-0">
                <input
                  type="text"
                  autoFocus
                  value={renameFolderValue}
                  onChange={(e) => setRenameFolderValue(e.target.value)}
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
                  <Check className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setSelectedFolderId(fld.id)}
                  className="flex items-center gap-1.5 flex-1 min-w-0 text-left cursor-pointer"
                >
                  {depth > 0 && <ChevronRight className="w-3 h-3 text-zinc-400 shrink-0" />}
                  <Folder className="w-4 h-4 shrink-0" />
                  <span className="truncate">{fld.name}</span>
                </button>
                <div className="flex items-center gap-1 shrink-0">
                  {!fld.isSystem && (
                    <div className="hidden group-hover:flex items-center gap-0.5">
                      <button
                        type="button"
                        onClick={() => {
                          setRenamingFolderId(fld.id);
                          setRenameFolderValue(fld.name);
                        }}
                        title="Renombrar carpeta"
                        className="p-1 text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-100 cursor-pointer"
                      >
                        <Edit3 className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteFolder(fld.id)}
                        title="Eliminar carpeta"
                        className="p-1 text-zinc-400 hover:text-red-500 cursor-pointer"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                  <span className="text-xs font-mono tabular-nums text-zinc-500 pl-1">
                    {count}
                  </span>
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
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Árbol jerárquico de carpetas y subcarpetas con movimiento manual y resúmenes automáticos.
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowNewFolder((v) => !v)}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111114] text-xs font-medium text-zinc-800 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer whitespace-nowrap shrink-0"
          >
            <FolderPlus className="w-4 h-4" />
            <span>Nueva carpeta</span>
          </button>
          <button
            type="button"
            onClick={onGoToChat}
            className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium cursor-pointer whitespace-nowrap shrink-0"
          >
            Subir desde Chat
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3.5 rounded-lg border border-red-300 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 text-sm text-red-700 dark:text-red-300 flex items-center justify-between gap-2">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} className="cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {showNewFolder && (
        <form
          onSubmit={handleCreateFolder}
          className="glass-panel rounded-2xl p-4 grid grid-cols-1 sm:grid-cols-12 gap-3 items-center"
        >
          <input
            type="text"
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            placeholder="Nombre de carpeta o subcarpeta..."
            className="sm:col-span-6 px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#09090B] text-sm text-zinc-900 dark:text-zinc-100"
          />
          <select
            value={newFolderParentId}
            onChange={(e) =>
              setNewFolderParentId(e.target.value ? Number(e.target.value) : '')
            }
            className="sm:col-span-4 px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#09090B] text-xs text-zinc-800 dark:text-zinc-200"
          >
            <option value="">Carpeta principal (raíz)</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                Dentro de: {getFolderLabel(f)}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={!newFolderName.trim()}
            className="sm:col-span-2 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium cursor-pointer"
          >
            Crear
          </button>
        </form>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Hierarchical Folder Tree */}
        <aside className="lg:col-span-3 glass-panel rounded-2xl p-3 space-y-1 self-start">
          <h2 className="font-display text-xs font-semibold text-zinc-500 dark:text-zinc-400 px-2 pb-1">
            Carpetas
          </h2>
          <button
            type="button"
            onClick={() => setSelectedFolderId('all')}
            className={`w-full flex items-center justify-between px-2.5 py-2 rounded-xl text-sm cursor-pointer ${
              selectedFolderId === 'all'
                ? 'bg-violet-600/10 text-violet-700 dark:text-violet-300 font-medium'
                : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200/50 dark:hover:bg-white/5'
            }`}
          >
            <span className="flex items-center gap-2 truncate">
              <Folder className="w-4 h-4 shrink-0" />
              <span className="truncate">Todos los archivos</span>
            </span>
            <span className="text-xs font-mono tabular-nums text-zinc-500">{files.length}</span>
          </button>

          {renderFolderTree(null, 0)}
        </aside>

        {/* Files list + Inspector */}
        <div className="lg:col-span-9 grid grid-cols-1 xl:grid-cols-12 gap-6">
          <div className="xl:col-span-7 glass-panel rounded-2xl divide-y divide-zinc-200/70 dark:divide-white/10">
            {loading ? (
              <div className="p-6 space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-14 rounded-lg bg-zinc-100 dark:bg-zinc-900 animate-pulse" />
                ))}
              </div>
            ) : visibleFiles.length === 0 ? (
              <div className="p-10 text-center space-y-2">
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  No hay archivos en esta carpeta
                </p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Enviá imágenes, PDFs, documentos o notas de voz desde el Chat general.
                </p>
              </div>
            ) : (
              visibleFiles.map((f) => {
                const active = selectedFile?.id === f.id;
                return (
                  <div
                    key={f.id}
                    onClick={() => setSelectedFile(f)}
                    className={`px-5 py-4 flex items-center justify-between gap-4 cursor-pointer transition-colors ${
                      active
                        ? 'bg-violet-600/5 dark:bg-violet-500/10'
                        : 'hover:bg-zinc-50 dark:hover:bg-zinc-900/50'
                    }`}
                  >
                    <div className="min-w-0 space-y-0.5">
                      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                        {f.displayName}
                      </p>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400 tabular-nums truncate">
                        {f.detectedCategory || f.fileKind}
                        {f.classificationConfidence
                          ? ` · ${Math.round(f.classificationConfidence * 100)}% confianza`
                          : ''}
                        {' · '}
                        {f.processingStatus}
                      </p>
                    </div>
                    <span className="text-xs font-mono tabular-nums text-zinc-500 dark:text-zinc-400 shrink-0">
                      {(f.sizeBytes / 1024).toFixed(0)} KB
                    </span>
                  </div>
                );
              })
            )}
          </div>

          <div className="xl:col-span-5 glass-panel rounded-2xl p-5 self-start">
            {!selectedFile ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-400 py-8 text-center">
                Seleccioná un archivo para ver su resumen, texto extraído y cambiar su carpeta.
              </p>
            ) : (
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-display text-base font-semibold text-zinc-900 dark:text-zinc-100 break-words">
                      {selectedFile.displayName}
                    </h3>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 tabular-nums">
                      {selectedFile.mimeType} · {(selectedFile.sizeBytes / 1024).toFixed(1)} KB
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleDownload(selectedFile)}
                      title="Descargar"
                      className="p-2 rounded-lg border border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
                    >
                      <Download className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteFile(selectedFile.id)}
                      title="Enviar a papelera"
                      className="p-2 rounded-lg border border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-300 hover:text-red-500 cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {previewUrl && (
                  <img
                    src={previewUrl}
                    alt={selectedFile.displayName}
                    referrerPolicy="no-referrer"
                    className="w-full max-h-56 object-contain rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#09090B]"
                  />
                )}

                <div>
                  <label className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">
                    Mover a carpeta o subcarpeta
                  </label>
                  <select
                    value={selectedFile.folderId ?? ''}
                    onChange={(e) =>
                      handleMoveFolder(
                        selectedFile.id,
                        e.target.value ? Number(e.target.value) : null
                      )
                    }
                    className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#09090B] text-xs text-zinc-900 dark:text-zinc-100"
                  >
                    <option value="">Sin carpeta</option>
                    {folders.map((fld) => (
                      <option key={fld.id} value={fld.id}>
                        {getFolderLabel(fld)}
                      </option>
                    ))}
                  </select>
                </div>

                {selectedFile.aiSummary && (
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                      Resumen de SILVV MEMORY
                    </p>
                    <p className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed">
                      {selectedFile.aiSummary}
                    </p>
                  </div>
                )}

                {selectedFile.extractedText && (
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                      Texto extraído / transcripción
                    </p>
                    <div className="max-h-48 overflow-y-auto p-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#09090B] text-xs text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap">
                      {selectedFile.extractedText}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
