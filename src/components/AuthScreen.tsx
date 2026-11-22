import { useState } from 'react';
import {
  ArrowRight,
  BookOpenText,
  Bot,
  Brain,
  Calendar,
  FileSearch,
  MessageSquare,
  StickyNote,
} from 'lucide-react';
import {
  isFirebaseEmulatorEnabled,
  signInWithEmulatorGoogleUser,
  signInWithGoogleAndCaptureToken,
} from '../lib/firebase';

export function AuthScreen() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGoogleSignIn = async () => {
    setLoading(true);
    setError(null);
    try {
      await signInWithGoogleAndCaptureToken();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'No se pudo iniciar sesión con Google.';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleEmulatorSignIn = async () => {
    setLoading(true);
    setError(null);
    try {
      await signInWithEmulatorGoogleUser();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'No se pudo iniciar la sesión de prueba.';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-[#09090B] silvv-ambient-bg text-zinc-900 dark:text-zinc-100 flex flex-col justify-between px-6 py-10 md:px-12">
      <header className="max-w-5xl w-full mx-auto flex items-center justify-between gap-4">
        <span className="font-display text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 whitespace-nowrap shrink-0">
          SILVV MEMORY
        </span>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          Memoria digital personal permanente
        </span>
      </header>

      <main className="max-w-5xl w-full mx-auto grid grid-cols-1 lg:grid-cols-12 gap-10 items-center my-auto py-10">
        <div className="lg:col-span-7 space-y-6">
          <p className="text-sm font-medium text-violet-600 dark:text-violet-400">
            Inteligencia artificial personal, notas, memoria temporal y agentes
          </p>
          <h1 className="font-display text-4xl sm:text-5xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 leading-[1.1]">
            Tu segundo cerebro digital, conectado a tus notas, historia y agenda real.
          </h1>
          <p className="text-base text-zinc-600 dark:text-zinc-400 max-w-xl leading-relaxed">
            Conversá libremente, capturá notas conectadas, registrá acontecimientos vividos en tu Agenda Memoria, generá resúmenes diarios, semanales o mensuales sin inventar datos y creá agentes personalizados con aislamiento estricto.
          </p>

          <div className="pt-2 flex flex-col sm:flex-row sm:items-center gap-4">
            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={loading}
              className="inline-flex items-center justify-center gap-2.5 px-6 py-3 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-60 text-white text-sm font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <span>{loading ? 'Conectando...' : 'Continuar con Google'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              Tus conversaciones, notas, archivos y memoria son privados por cuenta.
            </span>
          </div>

          {isFirebaseEmulatorEnabled && (
            <div className="max-w-md rounded-xl border border-emerald-300/70 dark:border-emerald-900/70 bg-emerald-50/70 dark:bg-emerald-950/20 p-4 space-y-2">
              <p className="text-xs font-medium text-emerald-800 dark:text-emerald-300">
                Entorno aislado de pruebas
              </p>
              <p className="text-xs leading-relaxed text-emerald-800/80 dark:text-emerald-200/80">
                Usa Auth y Firestore locales. No inicia sesión con Google ni accede a datos de producción.
              </p>
              <button
                type="button"
                onClick={handleEmulatorSignIn}
                disabled={loading}
                className="inline-flex min-h-10 items-center justify-center rounded-lg border border-emerald-700/30 bg-white/80 px-4 py-2 text-sm font-medium text-emerald-900 transition-colors hover:bg-white disabled:opacity-60 dark:bg-emerald-900/30 dark:text-emerald-100 dark:hover:bg-emerald-900/50"
              >
                {loading ? 'Iniciando sesión...' : 'Entrar como usuario de prueba'}
              </button>
            </div>
          )}

          {error && (
            <div className="p-3.5 rounded-xl border border-red-300 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 text-sm text-red-700 dark:text-red-300 max-w-md">
              {error}
            </div>
          )}
        </div>

        <div className="lg:col-span-5 glass-panel rounded-2xl p-6 space-y-4">
          <div className="space-y-1 pb-3 border-b border-zinc-200/70 dark:border-white/10">
            <h2 className="font-display text-base font-semibold text-zinc-900 dark:text-zinc-100">
              Las 7 secciones de SILVV MEMORY
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Arquitectura central compartida con funciones especializadas.
            </p>
          </div>

          <ul className="space-y-3">
            <li className="flex items-start gap-3">
              <MessageSquare className="w-4 h-4 text-violet-600 dark:text-violet-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Chat general</p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Conversaciones multimodales con detección automática de memoria, notas y agenda.
                </p>
              </div>
            </li>
            <li className="flex items-start gap-3">
              <StickyNote className="w-4 h-4 text-violet-600 dark:text-violet-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Notas</p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Notas manuales y rápidas con carpetas, etiquetas, adjuntos y autoguardado.
                </p>
              </div>
            </li>
            <li className="flex items-start gap-3">
              <Brain className="w-4 h-4 text-violet-600 dark:text-violet-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Memoria y carpetas</p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  4 capas de memoria, árbol jerárquico, proyectos y buscador híbrido universal.
                </p>
              </div>
            </li>
            <li className="flex items-start gap-3">
              <Calendar className="w-4 h-4 text-violet-600 dark:text-violet-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Agenda inteligente</p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Agenda Memoria cronológica y Agenda Real sincronizada con Google Calendar.
                </p>
              </div>
            </li>
            <li className="flex items-start gap-3">
              <BookOpenText className="w-4 h-4 text-violet-600 dark:text-violet-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Resúmenes</p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Diarios, semanales y mensuales estrictamente basados en tus registros reales.
                </p>
              </div>
            </li>
            <li className="flex items-start gap-3">
              <FileSearch className="w-4 h-4 text-violet-600 dark:text-violet-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Chat de conocimiento</p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Razona exclusivamente sobre tu base personal con citas verificadas.
                </p>
              </div>
            </li>
            <li className="flex items-start gap-3">
              <Bot className="w-4 h-4 text-violet-600 dark:text-violet-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Mis agentes</p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Constructor visual con documentos propios y aislamiento estricto por defecto.
                </p>
              </div>
            </li>
          </ul>
        </div>
      </main>

      <footer className="max-w-5xl w-full mx-auto flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-500">
        <span>SILVV MEMORY</span>
        <span className="tabular-nums">Zona horaria predeterminada: America/Montevideo</span>
      </footer>
    </div>
  );
}
