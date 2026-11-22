import { useEffect, useState } from 'react';
import { Search, X } from 'lucide-react';
import { apiRequest, type SearchHit } from '../lib/api';
import type { NavTab } from './DashboardView';

interface CommandSearchModalProps {
  open: boolean;
  onClose: () => void;
  onNavigate: (tab: NavTab) => void;
}

const TYPE_TO_TAB: Record<SearchHit['type'], NavTab> = {
  memory: 'memory',
  file: 'memory',
  project: 'memory',
  task: 'calendar',
  event: 'calendar',
  memory_event: 'calendar',
  note: 'notes',
  message: 'chat',
};

const TYPE_LABEL: Record<SearchHit['type'], string> = {
  memory: 'Memoria',
  file: 'Archivo',
  project: 'Proyecto',
  task: 'Tarea',
  event: 'Agenda',
  memory_event: 'Agenda Memoria',
  note: 'Nota',
  message: 'Mensaje',
};

export function CommandSearchModal({ open, onClose, onNavigate }: CommandSearchModalProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const handle = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await apiRequest<{ results: SearchHit[] }>(
          `/api/search?q=${encodeURIComponent(query)}`
        );
        setResults(res.results);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error en la búsqueda.');
      } finally {
        setLoading(false);
      }
    }, 220);

    return () => clearTimeout(handle);
  }, [query, open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/55 backdrop-blur-xs flex items-start justify-center pt-16 sm:pt-20 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl glass-elevated rounded-2xl overflow-hidden animate-silvv-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-200/70 dark:border-white/10">
          <Search className="w-4 h-4 text-zinc-400 shrink-0" />
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscador universal: notas, recuerdos, Agenda Memoria, carpetas, archivos, mensajes..."
            className="flex-1 bg-transparent text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar búsqueda"
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="max-h-96 overflow-y-auto p-2">
          {loading && (
            <p className="text-xs text-zinc-500 dark:text-zinc-400 px-3 py-4">
              Buscando por significado, entidades y contenido...
            </p>
          )}
          {error && (
            <p className="text-xs text-red-600 dark:text-red-400 px-3 py-4">{error}</p>
          )}
          {!loading && !error && results.length === 0 && (
            <p className="text-sm text-zinc-500 dark:text-zinc-400 px-3 py-6 text-center">
              No se encontraron coincidencias para &ldquo;{query}&rdquo;.
            </p>
          )}
          <ul className="divide-y divide-zinc-200/60 dark:divide-white/10">
            {results.map((hit) => (
              <li key={`${hit.type}-${hit.id}`}>
                <button
                  type="button"
                  onClick={() => {
                    onNavigate(TYPE_TO_TAB[hit.type]);
                    onClose();
                  }}
                  className="w-full text-left px-3 py-2.5 rounded-xl hover:bg-zinc-200/50 dark:hover:bg-white/10 transition-colors cursor-pointer space-y-0.5"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                      {hit.title}
                    </span>
                    <span className="text-xs text-zinc-500 dark:text-zinc-400 shrink-0">
                      {TYPE_LABEL[hit.type]}
                    </span>
                  </div>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                    {hit.subtitle}
                  </p>
                  {hit.snippet && (
                    <p className="text-xs text-zinc-600 dark:text-zinc-300 line-clamp-1">
                      {hit.snippet}
                    </p>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
