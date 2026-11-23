import { useEffect, useMemo, useState } from 'react';
import { Check, Pencil, Search, Trash2, UserRound, X } from 'lucide-react';
import {
  apiRequest,
  type EventRelationItem,
  type MemoryEventItem,
  type PersonEntityItem,
} from '../lib/api';

interface PeopleViewProps {
  isActive: boolean;
  onDataChanged: () => void;
}

export function PeopleView({ isActive, onDataChanged }: PeopleViewProps) {
  const [people, setPeople] = useState<PersonEntityItem[]>([]);
  const [events, setEvents] = useState<MemoryEventItem[]>([]);
  const [relations, setRelations] = useState<EventRelationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [relationship, setRelationship] = useState('');
  const [notes, setNotes] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [peopleResult, eventsResult, relationsResult] = await Promise.all([
        apiRequest<PersonEntityItem[]>('/api/people'),
        apiRequest<MemoryEventItem[]>('/api/memory-events'),
        apiRequest<EventRelationItem[]>('/api/event-relations'),
      ]);
      setPeople(peopleResult);
      setEvents(eventsResult);
      setRelations(relationsResult);
      setSelectedId((current) => current && peopleResult.some((person) => person.id === current)
        ? current
        : peopleResult[0]?.id ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudieron cargar los perfiles.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isActive) void load();
  }, [isActive]);

  useEffect(() => {
    const handleRemoteChange = (event: Event) => {
      const collectionName = (event as CustomEvent<{ collectionName?: string }>).detail?.collectionName;
      if (isActive && ['peopleEntities', 'memoryEvents', 'eventRelations', 'smartFolders'].includes(collectionName || '')) {
        void load();
      }
    };
    window.addEventListener('silvv:organization-change', handleRemoteChange);
    return () => window.removeEventListener('silvv:organization-change', handleRemoteChange);
  }, [isActive]);

  const selectedPerson = people.find((person) => person.id === selectedId) || null;
  const filteredPeople = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('es');
    if (!needle) return people;
    return people.filter((person) =>
      [person.name, person.relationship || '', person.notes || '']
        .some((value) => value.toLocaleLowerCase('es').includes(needle)),
    );
  }, [people, query]);

  const selectedEvents = useMemo(() => {
    if (!selectedPerson) return [];
    const eventIds = new Set(relations
      .filter((relation) => relation.targetType === 'person' && relation.targetId === selectedPerson.id)
      .map((relation) => relation.sourceEventId));
    return events.filter((event) => eventIds.has(event.id));
  }, [events, relations, selectedPerson]);

  const startEditing = () => {
    if (!selectedPerson) return;
    setName(selectedPerson.name);
    setRelationship(selectedPerson.relationship || '');
    setNotes(selectedPerson.notes || '');
    setPhotoUrl(selectedPerson.photoUrl || '');
    setEditing(true);
    setError(null);
  };

  const saveProfile = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedPerson || !name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await apiRequest<PersonEntityItem>(`/api/people/${selectedPerson.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: name.trim(),
          relationship: relationship.trim() || null,
          notes: notes.trim() || null,
          photoUrl: photoUrl.trim() || null,
        }),
      });
      setPeople((current) => current.map((person) => person.id === updated.id ? updated : person));
      setEditing(false);
      onDataChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo actualizar el perfil.');
    } finally {
      setSaving(false);
    }
  };

  const deleteProfile = async (person: PersonEntityItem) => {
    if (!window.confirm(`¿Eliminar el perfil de ${person.name}? Se quitarán sus relaciones explícitas, pero se conservarán los acontecimientos y textos relacionados.`)) return;
    try {
      await apiRequest(`/api/people/${person.id}`, { method: 'DELETE' });
      const remaining = people.filter((item) => item.id !== person.id);
      setPeople(remaining);
      setSelectedId(remaining[0]?.id ?? null);
      setEditing(false);
      onDataChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo eliminar el perfil.');
    }
  };

  return (
    <section className="space-y-5" aria-labelledby="people-heading">
      <div>
        <h2 id="people-heading" className="font-display text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Personas
        </h2>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Perfiles vinculados por identificadores explícitos a recuerdos, notas y acontecimientos.
        </p>
      </div>

      {error && <p role="alert" className="rounded-xl border border-red-300 bg-red-50/80 p-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">{error}</p>}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(15rem,0.8fr)_minmax(0,1.5fr)]">
        <div className="glass-panel overflow-hidden rounded-2xl">
          <div className="relative border-b border-zinc-200/70 p-3 dark:border-white/10">
            <Search aria-hidden="true" className="absolute left-6 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
            <input
              type="search"
              aria-label="Buscar personas"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar perfiles…"
              className="w-full rounded-xl border border-zinc-200/80 bg-white/70 py-2 pl-9 pr-3 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-violet-500/40 dark:border-white/10 dark:bg-black/30 dark:text-zinc-100"
            />
          </div>
          <div className="divide-y divide-zinc-200/60 dark:divide-white/5">
            {loading ? (
              <p className="p-5 text-sm text-zinc-500">Cargando perfiles…</p>
            ) : filteredPeople.length === 0 ? (
              <div className="p-7 text-center">
                <UserRound className="mx-auto mb-2 size-6 text-zinc-400" aria-hidden="true" />
                <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">Todavía no hay personas identificadas</p>
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Las personas mencionadas en recuerdos y conversaciones se organizan aquí.</p>
              </div>
            ) : filteredPeople.map((person) => (
              <button
                key={person.id}
                type="button"
                onClick={() => { setSelectedId(person.id); setEditing(false); }}
                aria-pressed={selectedId === person.id}
                className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors ${selectedId === person.id ? 'bg-violet-600/10 dark:bg-violet-500/15' : 'hover:bg-zinc-100/70 dark:hover:bg-white/5'}`}
              >
                {person.photoUrl ? (
                  <img src={person.photoUrl} alt="" className="size-10 rounded-full border border-zinc-200 object-cover dark:border-white/15" />
                ) : (
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-violet-500/10 text-sm font-semibold text-violet-700 dark:text-violet-300" aria-hidden="true">
                    {person.name.split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase() || 'P'}
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">{person.name}</span>
                  <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">{person.relationship || 'Relación sin especificar'} · {person.mentionCount} menciones</span>
                </span>
              </button>
            ))}
          </div>
        </div>

        {selectedPerson ? (
          <article className="glass-panel rounded-2xl p-5 sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div className="flex min-w-0 items-center gap-3">
                {selectedPerson.photoUrl ? (
                  <img src={selectedPerson.photoUrl} alt={`Foto de ${selectedPerson.name}`} className="size-14 rounded-2xl border border-zinc-200 object-cover dark:border-white/15" />
                ) : (
                  <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-violet-500/10 text-lg font-semibold text-violet-700 dark:text-violet-300" aria-hidden="true">
                    {selectedPerson.name.split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase() || 'P'}
                  </span>
                )}
                <div className="min-w-0">
                  <h3 className="truncate font-display text-xl font-semibold text-zinc-900 dark:text-zinc-100">{selectedPerson.name}</h3>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">{selectedPerson.relationship || 'Perfil personal'}</p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button type="button" onClick={startEditing} aria-label="Editar perfil" title="Editar perfil" className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-200/70 hover:text-violet-600 dark:hover:bg-white/10 dark:hover:text-violet-300">
                  <Pencil className="size-4" />
                </button>
                <button type="button" onClick={() => void deleteProfile(selectedPerson)} aria-label="Eliminar perfil" title="Eliminar perfil" className="rounded-lg p-2 text-zinc-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30 dark:hover:text-red-400">
                  <Trash2 className="size-4" />
                </button>
              </div>
            </div>

            {editing ? (
              <form onSubmit={saveProfile} className="mt-5 flex flex-col gap-3">
                <label className="flex flex-col gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-300">
                  Nombre
                  <input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} className="rounded-xl border border-zinc-200 bg-white/70 px-3 py-2 text-sm dark:border-white/10 dark:bg-black/30" />
                </label>
                <label className="flex flex-col gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-300">
                  Relación
                  <input maxLength={120} value={relationship} onChange={(event) => setRelationship(event.target.value)} placeholder="Por ejemplo, amiga o colega" className="rounded-xl border border-zinc-200 bg-white/70 px-3 py-2 text-sm dark:border-white/10 dark:bg-black/30" />
                </label>
                <label className="flex flex-col gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-300">
                  Fotografía (URL HTTPS opcional)
                  <input type="url" value={photoUrl} onChange={(event) => setPhotoUrl(event.target.value)} placeholder="https://…" className="rounded-xl border border-zinc-200 bg-white/70 px-3 py-2 text-sm dark:border-white/10 dark:bg-black/30" />
                </label>
                <label className="flex flex-col gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-300">
                  Información relevante
                  <textarea maxLength={2000} rows={4} value={notes} onChange={(event) => setNotes(event.target.value)} className="resize-y rounded-xl border border-zinc-200 bg-white/70 px-3 py-2 text-sm dark:border-white/10 dark:bg-black/30" />
                </label>
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setEditing(false)} className="inline-flex items-center gap-1 rounded-xl px-3 py-2 text-xs text-zinc-600 hover:bg-zinc-200/60 dark:text-zinc-300 dark:hover:bg-white/10"><X className="size-3.5" />Cancelar</button>
                  <button type="submit" disabled={saving || !name.trim()} className="inline-flex items-center gap-1 rounded-xl bg-violet-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-50"><Check className="size-3.5" />{saving ? 'Guardando…' : 'Guardar'}</button>
                </div>
              </form>
            ) : (
              <div className="mt-5 space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-xl bg-zinc-100/70 p-3 dark:bg-white/[0.04]">
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">Menciones</p>
                    <p className="mt-1 text-lg font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">{selectedPerson.mentionCount}</p>
                  </div>
                  <div className="rounded-xl bg-zinc-100/70 p-3 dark:bg-white/[0.04]">
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">Acontecimientos relacionados</p>
                    <p className="mt-1 text-lg font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">{selectedEvents.length}</p>
                  </div>
                </div>
                {selectedPerson.notes && <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">{selectedPerson.notes}</p>}
                <div className="border-t border-zinc-200/70 pt-4 dark:border-white/10">
                  <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Historial relacionado</h4>
                  {selectedEvents.length === 0 ? (
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">Todavía no hay acontecimientos vinculados a este perfil.</p>
                  ) : (
                    <ul className="flex flex-col gap-2">
                      {selectedEvents.map((item) => (
                        <li key={item.id} className="rounded-xl bg-zinc-100/70 p-3 dark:bg-white/[0.04]">
                          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{item.title}</p>
                          <p className="mt-1 line-clamp-2 text-xs text-zinc-600 dark:text-zinc-400">{item.description}</p>
                          <p className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-500">{item.category} · {item.dateLabel || 'Sin fecha precisa'}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </article>
        ) : (
          <div className="glass-panel flex min-h-56 items-center justify-center rounded-2xl p-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
            Seleccioná un perfil para ver sus relaciones y acontecimientos.
          </div>
        )}
      </div>
    </section>
  );
}
