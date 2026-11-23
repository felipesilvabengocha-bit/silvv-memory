import {
  Component,
  lazy,
  Suspense,
  type ErrorInfo,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import {
  BookOpenText,
  Bot,
  Brain,
  Calendar,
  FileSearch,
  LayoutDashboard,
  LogOut,
  MessageSquare,
  Moon,
  Search,
  Settings,
  StickyNote,
  Sun,
  X,
} from 'lucide-react';
import { auth, clearGoogleAccessToken } from './lib/firebase';
import {
  apiRequest,
  type DashboardData,
  type GoogleCalendarIntegration,
  type UserPreferences,
  type UserProfile,
} from './lib/api';
import { AuthScreen } from './components/AuthScreen';
import { DashboardView, type NavTab } from './components/DashboardView';
import { CommandSearchModal } from './components/CommandSearchModal';

const InboxView = lazy(() =>
  import('./components/InboxView').then((module) => ({ default: module.InboxView })),
);
const NotesView = lazy(() =>
  import('./components/NotesView').then((module) => ({ default: module.NotesView })),
);
const MemoryView = lazy(() =>
  import('./components/MemoryView').then((module) => ({ default: module.MemoryView })),
);
const CalendarTasksView = lazy(() =>
  import('./components/CalendarTasksView').then((module) => ({ default: module.CalendarTasksView })),
);
const SummariesView = lazy(() =>
  import('./components/SummariesView').then((module) => ({ default: module.SummariesView })),
);
const KnowledgeView = lazy(() =>
  import('./components/KnowledgeView').then((module) => ({ default: module.KnowledgeView })),
);
const AgentsView = lazy(() =>
  import('./components/AgentsView').then((module) => ({ default: module.AgentsView })),
);
const SettingsTrashView = lazy(() =>
  import('./components/SettingsTrashView').then((module) => ({ default: module.SettingsTrashView })),
);

const NAV_ITEMS: Array<{ id: NavTab; label: string; shortLabel: string; icon: typeof LayoutDashboard }> = [
  { id: 'dashboard', label: 'Inicio', shortLabel: 'Inicio', icon: LayoutDashboard },
  { id: 'chat', label: 'Chat', shortLabel: 'Chat', icon: MessageSquare },
  { id: 'notes', label: 'Notas', shortLabel: 'Notas', icon: StickyNote },
  { id: 'memory', label: 'Memoria y carpetas', shortLabel: 'Memoria', icon: Brain },
  { id: 'calendar', label: 'Agenda inteligente', shortLabel: 'Agenda', icon: Calendar },
  { id: 'summaries', label: 'Resúmenes', shortLabel: 'Resúmenes', icon: BookOpenText },
  { id: 'knowledge', label: 'Chat de conocimiento', shortLabel: 'Saber', icon: FileSearch },
  { id: 'agents', label: 'Mis agentes', shortLabel: 'Agentes', icon: Bot },
  { id: 'settings', label: 'Ajustes y papelera', shortLabel: 'Ajustes', icon: Settings },
];

// 5 primary sections on iPhone / mobile fixed bottom navigation bar
const MOBILE_PRIMARY_TABS: NavTab[] = ['chat', 'notes', 'memory', 'calendar', 'summaries'];

const routeVariants = {
  enter: (direction: 'forward' | 'backward') => ({
    opacity: 0,
    x: direction === 'forward' ? 16 : -16,
    scale: 0.995,
  }),
  center: { opacity: 1, x: 0, scale: 1 },
  exit: (direction: 'forward' | 'backward') => ({
    opacity: 0,
    x: direction === 'forward' ? -12 : 12,
    scale: 0.997,
  }),
};

class SilvvErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; message: string }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(err: Error) {
    return { hasError: true, message: err.message || 'Ocurrió un error inesperado.' };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('SILVV MEMORY ErrorBoundary:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-zinc-50 dark:bg-[#09090B] silvv-ambient-bg text-zinc-900 dark:text-zinc-100 flex items-center justify-center p-6">
          <div className="max-w-md w-full glass-elevated rounded-2xl p-6 space-y-4">
            <h2 className="font-display text-lg font-semibold">Ocurrió un problema en SILVV MEMORY</h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 break-words">
              {this.state.message}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium cursor-pointer"
            >
              Recargar aplicación
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function ViewLoadingState({ isFullBleed }: { isFullBleed: boolean }) {
  return (
    <div
      role="status"
      aria-label="Cargando sección"
      className={`w-full ${isFullBleed ? 'h-full p-4' : 'space-y-5'}`}
    >
      <span className="sr-only">Cargando sección...</span>
      <div aria-hidden="true" className="space-y-4 animate-pulse">
        <div className="h-8 w-2/5 rounded-xl bg-zinc-200/70 dark:bg-white/10" />
        <div className="h-28 rounded-2xl glass-panel" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="h-36 rounded-2xl glass-panel" />
          <div className="h-36 rounded-2xl glass-panel" />
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [preferences, setPreferences] = useState<UserPreferences | null>(null);
  const [googleIntegration, setGoogleIntegration] = useState<GoogleCalendarIntegration | null>(null);
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [dashLoading, setDashLoading] = useState(false);
  const [dashError, setDashError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<NavTab>('dashboard');
  const [viewDirection, setViewDirection] = useState<'forward' | 'backward'>('forward');
  const [notesVisited, setNotesVisited] = useState(false);
  const [selectedConvId, setSelectedConvId] = useState<number | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [quickChatText, setQuickChatText] = useState<string | null>(null);
  const [isDark, setIsDark] = useState(true);
  const [mobileKeyboardOpen, setMobileKeyboardOpen] = useState(false);

  const lastAutoSyncUidRef = useRef<string | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user);
      setAuthReady(true);
      if (!user) {
        clearGoogleAccessToken();
        lastAutoSyncUidRef.current = null;
      }
    });
    return () => unsub();
  }, []);

  const applyTheme = useCallback((prefTheme?: 'dark' | 'light' | 'system') => {
    const target = prefTheme || 'dark';
    const dark =
      target === 'dark' ||
      (target === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    setIsDark(dark);
    document.documentElement.classList.toggle('dark', dark);
  }, []);

  useEffect(() => {
    applyTheme(preferences?.theme);
  }, [preferences?.theme, applyTheme]);

  useEffect(() => {
    const visualViewport = window.visualViewport;
    const updateViewport = () => {
      const height = visualViewport?.height ?? window.innerHeight;
      document.documentElement.style.setProperty('--silvv-visual-viewport-height', `${Math.round(height)}px`);

      const activeElement = document.activeElement;
      const hasTextInputFocus =
        activeElement instanceof HTMLElement &&
        activeElement.matches('input, textarea, [contenteditable="true"]');
      setMobileKeyboardOpen(
        window.matchMedia('(max-width: 1023px)').matches && hasTextInputFocus,
      );
    };
    const updateAfterFocus = () => window.requestAnimationFrame(updateViewport);

    updateViewport();
    window.addEventListener('resize', updateViewport);
    visualViewport?.addEventListener('resize', updateViewport);
    visualViewport?.addEventListener('scroll', updateViewport);
    document.addEventListener('focusin', updateViewport);
    document.addEventListener('focusout', updateAfterFocus);

    return () => {
      window.removeEventListener('resize', updateViewport);
      visualViewport?.removeEventListener('resize', updateViewport);
      visualViewport?.removeEventListener('scroll', updateViewport);
      document.removeEventListener('focusin', updateViewport);
      document.removeEventListener('focusout', updateAfterFocus);
      document.documentElement.style.removeProperty('--silvv-visual-viewport-height');
    };
  }, []);

  useEffect(() => {
    if (activeTab === 'notes') setNotesVisited(true);
  }, [activeTab]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const loadWorkspace = useCallback(async () => {
    if (!firebaseUser) return;
    setDashLoading(true);
    setDashError(null);
    try {
      const [meRes, dashRes] = await Promise.all([
        apiRequest<{
          user: UserProfile;
          preferences: UserPreferences;
          googleCalendarIntegration: GoogleCalendarIntegration | null;
        }>('/api/me'),
        apiRequest<DashboardData>('/api/dashboard'),
      ]);
      setProfile(meRes.user);
      setPreferences(meRes.preferences);
      setGoogleIntegration(meRes.googleCalendarIntegration);
      setDashboardData(dashRes);

      // Run silent automated summaries sync once per authenticated session
      if (lastAutoSyncUidRef.current !== firebaseUser.uid) {
        lastAutoSyncUidRef.current = firebaseUser.uid;
        apiRequest('/api/summaries/sync-auto', { method: 'POST' }).catch(() => {});
      }
    } catch (err) {
      setDashError(err instanceof Error ? err.message : 'No se pudo cargar tu espacio.');
    } finally {
      setDashLoading(false);
    }
  }, [firebaseUser]);

  useEffect(() => {
    if (authReady && firebaseUser) {
      loadWorkspace();
    } else if (authReady && !firebaseUser) {
      setProfile(null);
      setPreferences(null);
      setGoogleIntegration(null);
      setDashboardData(null);
    }
  }, [authReady, firebaseUser, loadWorkspace]);

  const handleToggleTheme = async () => {
    const nextTheme = isDark ? 'light' : 'dark';
    applyTheme(nextTheme);
    if (preferences) {
      setPreferences({ ...preferences, theme: nextTheme });
    }
    try {
      await apiRequest('/api/me', {
        method: 'PATCH',
        body: JSON.stringify({ theme: nextTheme }),
      });
    } catch {
      // non-fatal visual preference sync
    }
  };

  const handleNavigate = (tab: NavTab, convId?: number) => {
    if (convId !== undefined) setSelectedConvId(convId);
    if (tab !== activeTab) {
      const currentIndex = NAV_ITEMS.findIndex((item) => item.id === activeTab);
      const nextIndex = NAV_ITEMS.findIndex((item) => item.id === tab);
      setViewDirection(nextIndex >= currentIndex ? 'forward' : 'backward');
      setActiveTab(tab);
    }
  };

  const handleQuickSend = (text: string) => {
    setQuickChatText(text);
    handleNavigate('chat');
  };

  const handleSignOut = async () => {
    clearGoogleAccessToken();
    await signOut(auth);
  };

  if (!authReady) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-[#09090B] silvv-ambient-bg flex items-center justify-center text-sm text-zinc-500 dark:text-zinc-400">
        Cargando SILVV MEMORY...
      </div>
    );
  }

  if (!firebaseUser) {
    return <AuthScreen />;
  }

  const displayName =
    profile?.fullName || firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'Usuario';
  const initials = displayName
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0].toUpperCase())
    .join('');
  const timezone = profile?.timezone || 'America/Montevideo';
  const activeNavLabel = NAV_ITEMS.find((i) => i.id === activeTab)?.label || 'Inicio';
  const isFullBleedChat = activeTab === 'chat' || activeTab === 'knowledge';

  return (
    <SilvvErrorBoundary>
        <div
          className={`${isFullBleedChat ? (mobileKeyboardOpen ? 'h-[var(--silvv-visual-viewport-height,100dvh)] min-h-0 overflow-hidden' : 'h-[100dvh] min-h-0 overflow-hidden') : 'min-h-screen'} bg-zinc-50 dark:bg-[#09090B] silvv-ambient-bg text-zinc-900 dark:text-zinc-100 flex`}
        >
          {/* Desktop Sidebar */}
          <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:fixed lg:inset-y-0 glass-panel border-r border-zinc-200/70 dark:border-white/10 px-4 py-5 justify-between">
            <div className="space-y-6">
              <div className="px-2 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => handleNavigate('dashboard')}
                  className="font-display text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  SILVV MEMORY
                </button>
              </div>

              <button
                type="button"
                onClick={() => setSearchOpen(true)}
                className="w-full flex items-center justify-between px-3 py-2 rounded-xl glass-subtle text-xs text-zinc-500 dark:text-zinc-400 hover:border-zinc-300 dark:hover:border-white/20 transition-colors cursor-pointer"
              >
                <span className="flex items-center gap-2 truncate">
                  <Search className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">Buscador universal...</span>
                </span>
                <kbd className="font-mono text-[10px] text-zinc-400 shrink-0">⌘K</kbd>
              </button>

              <nav className="space-y-1">
                {NAV_ITEMS.map((item) => {
                  const Icon = item.icon;
                  const active = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handleNavigate(item.id)}
                      aria-current={active ? 'page' : undefined}
                      className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm transition-colors cursor-pointer whitespace-nowrap ${
                        active
                          ? 'bg-violet-600/15 text-violet-700 dark:text-violet-300 font-medium'
                          : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200/50 dark:hover:bg-white/5 hover:text-zinc-900 dark:hover:text-zinc-100'
                      }`}
                    >
                      <Icon className="w-4 h-4 shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </button>
                  );
                })}
              </nav>
            </div>

            <div className="pt-4 border-t border-zinc-200/70 dark:border-white/10 flex items-center justify-between gap-2 px-1">
              <div className="flex items-center gap-2.5 min-w-0">
                {firebaseUser.photoURL ? (
                  <img
                    src={firebaseUser.photoURL}
                    alt={displayName}
                    referrerPolicy="no-referrer"
                    className="w-8 h-8 rounded-full object-cover shrink-0 border border-zinc-200 dark:border-white/15"
                  />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-violet-600/15 text-violet-600 dark:text-violet-300 flex items-center justify-center text-xs font-semibold shrink-0">
                    {initials || 'SM'}
                  </div>
                )}
                <div className="min-w-0">
                  <p className="text-xs font-medium text-zinc-900 dark:text-zinc-100 truncate">
                    {displayName}
                  </p>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                    {profile?.email || firebaseUser.email}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={handleSignOut}
                title="Cerrar sesión"
                className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 cursor-pointer shrink-0"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </aside>

          {/* Mobile Slide Drawer */}
          <MotionConfig reducedMotion="user">
            <AnimatePresence>
              {mobileNavOpen && (
                <motion.div
                  key="mobile-navigation-backdrop"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2, ease: 'easeOut' }}
                  className="fixed inset-x-0 bottom-0 top-[calc(3.5rem+env(safe-area-inset-top))] z-50 lg:hidden bg-black/55 backdrop-blur-xs"
                  onClick={() => setMobileNavOpen(false)}
                >
                  <motion.aside
                    id="mobile-navigation-drawer"
                    role="dialog"
                    aria-modal="true"
                    aria-label="Navegación principal"
                    initial={{ x: '-100%' }}
                    animate={{ x: 0 }}
                    exit={{ x: '-100%' }}
                    transition={{ type: 'spring', stiffness: 380, damping: 38 }}
                    className="w-72 h-full glass-elevated border-r border-zinc-200/70 dark:border-white/10 p-5 flex flex-col justify-between"
                    onClick={(e) => e.stopPropagation()}
                  >
                <div className="space-y-6 overflow-y-auto">
                  <div className="flex items-center justify-between">
                    <span className="font-display text-lg font-semibold whitespace-nowrap">
                      SILVV MEMORY
                    </span>
                    <button
                      type="button"
                      onClick={() => setMobileNavOpen(false)}
                      className="p-1.5 text-zinc-400 cursor-pointer"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                  <nav className="space-y-1">
                    {NAV_ITEMS.map((item) => {
                      const Icon = item.icon;
                      const active = activeTab === item.id;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => {
                            handleNavigate(item.id);
                            setMobileNavOpen(false);
                          }}
                          aria-current={active ? 'page' : undefined}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm cursor-pointer whitespace-nowrap ${
                            active
                              ? 'bg-violet-600/15 text-violet-700 dark:text-violet-300 font-medium'
                              : 'text-zinc-600 dark:text-zinc-400'
                          }`}
                        >
                          <Icon className="w-4 h-4 shrink-0" />
                          <span>{item.label}</span>
                        </button>
                      );
                    })}
                  </nav>
                </div>
                <button
                  type="button"
                  onClick={handleSignOut}
                  className="flex items-center gap-2 px-3 py-2 text-sm text-zinc-600 dark:text-zinc-400 cursor-pointer"
                >
                  <LogOut className="w-4 h-4" />
                  <span>Cerrar sesión</span>
                </button>
                  </motion.aside>
                </motion.div>
              )}
            </AnimatePresence>
          </MotionConfig>

          {/* Main Content Area */}
          <div
            className={`flex-1 lg:pl-64 flex flex-col min-w-0 ${isFullBleedChat ? 'h-full min-h-0' : 'min-h-screen'}`}
          >
            <header className="h-[calc(3.5rem+env(safe-area-inset-top))] shrink-0 border-b border-zinc-200/70 dark:border-white/10 glass-panel sticky top-0 z-30 px-4 pt-[env(safe-area-inset-top)] sm:px-8 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <button
                  type="button"
                  onClick={() => setMobileNavOpen((open) => !open)}
                  aria-expanded={mobileNavOpen}
                  aria-controls="mobile-navigation-drawer"
                  aria-label={mobileNavOpen ? 'Cerrar menú' : 'Abrir menú'}
                  className="lg:hidden min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl glass-subtle text-zinc-600 dark:text-zinc-300 cursor-pointer shrink-0"
                >
                  <span className="relative h-4 w-4" aria-hidden="true">
                    <motion.span
                      className="absolute left-0 top-[3px] h-[1.5px] w-4 rounded-full bg-current"
                      animate={{ y: mobileNavOpen ? 4 : 0, rotate: mobileNavOpen ? 45 : 0 }}
                      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                    />
                    <motion.span
                      className="absolute left-0 top-[7px] h-[1.5px] w-4 rounded-full bg-current"
                      animate={{ opacity: mobileNavOpen ? 0 : 1, scaleX: mobileNavOpen ? 0.4 : 1 }}
                      transition={{ duration: 0.16, ease: 'easeOut' }}
                    />
                    <motion.span
                      className="absolute left-0 top-[11px] h-[1.5px] w-4 rounded-full bg-current"
                      animate={{ y: mobileNavOpen ? -4 : 0, rotate: mobileNavOpen ? -45 : 0 }}
                      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                    />
                  </span>
                </button>
                <div className="flex items-center gap-2 text-sm truncate">
                  <button
                    type="button"
                    onClick={() => handleNavigate('dashboard')}
                    className="text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 hidden sm:inline cursor-pointer whitespace-nowrap shrink-0"
                  >
                    SILVV MEMORY
                  </button>
                  <span className="text-zinc-400 dark:text-zinc-600 hidden sm:inline">/</span>
                  <span className="font-medium text-zinc-900 dark:text-zinc-100 truncate">
                    {activeNavLabel}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setSearchOpen(true)}
                  className="lg:hidden p-2 rounded-xl glass-subtle text-zinc-600 dark:text-zinc-300 cursor-pointer"
                  aria-label="Buscar"
                >
                  <Search className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={handleToggleTheme}
                  aria-label="Cambiar tema"
                  className="p-2 rounded-xl glass-subtle text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200/60 dark:hover:bg-white/10 transition-colors cursor-pointer"
                >
                  {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                </button>
                <button
                  type="button"
                  onClick={() => handleNavigate('chat')}
                  className="px-3.5 py-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  Chat general
                </button>
              </div>
            </header>

            <main
              className={
                isFullBleedChat
                  ? `flex-1 w-full min-h-0 overflow-hidden ${mobileKeyboardOpen ? 'h-[calc(var(--silvv-visual-viewport-height,100dvh)-3.5rem-env(safe-area-inset-top))] pb-0' : 'pb-[calc(3.25rem+env(safe-area-inset-bottom))]'} lg:h-[calc(100dvh-3.5rem)] lg:pb-0`
                  : 'flex-1 max-w-6xl w-full mx-auto px-4 sm:px-8 py-6 pb-24 lg:pb-8'
              }
            >
              <Suspense fallback={<ViewLoadingState isFullBleed={isFullBleedChat} />}>
                <MotionConfig reducedMotion="user">
                  <AnimatePresence initial={false} mode="wait" custom={viewDirection}>
                    <motion.div
                      key={activeTab}
                      variants={routeVariants}
                      initial="enter"
                      animate="center"
                      exit="exit"
                      transition={{ type: 'spring', stiffness: 320, damping: 32, mass: 0.8 }}
                      className={`silvv-view-transition ${isFullBleedChat ? 'h-full min-h-0' : ''}`}
                    >
              {activeTab === 'dashboard' && (
                <DashboardView
                  data={dashboardData}
                  loading={dashLoading}
                  error={dashError}
                  timezone={timezone}
                  userName={displayName}
                  onRefresh={loadWorkspace}
                  onNavigate={handleNavigate}
                  onQuickSend={handleQuickSend}
                />
              )}

              {activeTab === 'chat' && (
                <InboxView
                  projects={dashboardData?.activeProjects || []}
                  initialQuickText={quickChatText}
                  initialConversationId={selectedConvId}
                  onClearQuickText={() => setQuickChatText(null)}
                  onDataChanged={loadWorkspace}
                  mobileKeyboardOpen={mobileKeyboardOpen}
                />
              )}

              {(activeTab === 'notes' || notesVisited) && (
                <div className={activeTab === 'notes' ? 'contents' : 'hidden'}>
                  <NotesView
                    key={firebaseUser.uid}
                    isActive={activeTab === 'notes'}
                    onDataChanged={loadWorkspace}
                    onAskInChat={handleQuickSend}
                  />
                </div>
              )}

              {activeTab === 'memory' && (
                <MemoryView
                  onDataChanged={loadWorkspace}
                  onGoToChat={() => handleNavigate('chat')}
                />
              )}

              {activeTab === 'calendar' && (
                <CalendarTasksView
                  timezone={timezone}
                  preferences={preferences}
                  googleIntegration={googleIntegration}
                  projects={dashboardData?.activeProjects || []}
                  onPreferencesUpdated={(p) => setPreferences(p)}
                  onDataChanged={loadWorkspace}
                />
              )}

              {activeTab === 'summaries' && (
                <SummariesView
                  onDataChanged={loadWorkspace}
                  onNavigateToNotes={() => handleNavigate('notes')}
                />
              )}

              {activeTab === 'knowledge' && <KnowledgeView />}

              {activeTab === 'agents' && <AgentsView />}

              {activeTab === 'settings' && (
                <SettingsTrashView
                  user={profile}
                  preferences={preferences}
                  googleIntegration={googleIntegration}
                  onUpdated={(u, p) => {
                    setProfile(u);
                    setPreferences(p);
                  }}
                  onDataChanged={loadWorkspace}
                />
              )}
                    </motion.div>
                  </AnimatePresence>
                </MotionConfig>
              </Suspense>
            </main>
          </div>

          {/* Fixed Bottom Navigation Bar for Mobile / iPhone (5 Main Sections) */}
          <nav
            aria-label="Navegación principal móvil"
            className={`${isFullBleedChat && mobileKeyboardOpen ? 'hidden' : 'lg:hidden fixed bottom-0 left-0 right-0 z-40 border-t border-zinc-200/70 dark:border-white/10 glass-elevated pb-[env(safe-area-inset-bottom)]'}`}
          >
            <div className="grid grid-cols-5">
              {MOBILE_PRIMARY_TABS.map((tabId) => {
                const item = NAV_ITEMS.find((n) => n.id === tabId)!;
                const Icon = item.icon;
                const active = activeTab === tabId;
                return (
                  <button
                    key={tabId}
                    type="button"
                    onClick={() => handleNavigate(tabId)}
                    aria-current={active ? 'page' : undefined}
                    className={`min-h-[52px] flex flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-[11px] font-medium cursor-pointer transition-all duration-150 active:scale-95 ${
                      active
                        ? 'text-violet-600 dark:text-violet-400'
                        : 'text-zinc-500 dark:text-zinc-400'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span className="truncate max-w-full">{item.shortLabel}</span>
                  </button>
                );
              })}
            </div>
          </nav>

          <CommandSearchModal
            open={searchOpen}
            onClose={() => setSearchOpen(false)}
            onNavigate={handleNavigate}
          />
        </div>
    </SilvvErrorBoundary>
  );
}
