import { initializeApp } from 'firebase/app';
import {
  connectAuthEmulator,
  getAuth,
  GoogleAuthProvider,
  reauthenticateWithPopup,
  signInWithCredential,
  signInWithPopup,
} from 'firebase/auth';
import {
  collection,
  connectFirestoreEmulator,
  doc,
  getDocFromServer,
  getFirestore,
  onSnapshot,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const TEST_FIREBASE_PROJECT_ID = 'demo-silvv-memory';
export const isFirebaseEmulatorEnabled =
  import.meta.env.DEV && import.meta.env.VITE_FIREBASE_EMULATORS === 'true';

const activeFirebaseConfig = isFirebaseEmulatorEnabled
  ? {
      ...firebaseConfig,
      apiKey: 'demo-api-key',
      authDomain: `${TEST_FIREBASE_PROJECT_ID}.firebaseapp.com`,
      projectId: TEST_FIREBASE_PROJECT_ID,
      firestoreDatabaseId: undefined,
    }
  : firebaseConfig;

const app = initializeApp(activeFirebaseConfig);
export const auth = getAuth(app);
export const db = isFirebaseEmulatorEnabled
  ? getFirestore(app)
  : firebaseConfig.firestoreDatabaseId
    ? getFirestore(app, firebaseConfig.firestoreDatabaseId)
    : getFirestore(app);

if (isFirebaseEmulatorEnabled) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: Array<{
      providerId?: string | null;
      email?: string | null;
    }>;
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error:', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

void testConnection();

export const googleAuthProvider = new GoogleAuthProvider();
googleAuthProvider.addScope('https://www.googleapis.com/auth/calendar.events');
googleAuthProvider.setCustomParameters({ prompt: 'select_account' });

// Stored strictly in JS memory (never persisted to localStorage/sessionStorage)
let inMemoryGoogleAccessToken: string | null = null;

export function getGoogleAccessToken(): string | null {
  return inMemoryGoogleAccessToken;
}

export function setGoogleAccessToken(token: string | null) {
  inMemoryGoogleAccessToken = token;
}

export function clearGoogleAccessToken() {
  inMemoryGoogleAccessToken = null;
}

export async function signInWithGoogleAndCaptureToken() {
  const result = await signInWithPopup(auth, googleAuthProvider);
  const credential = GoogleAuthProvider.credentialFromResult(result);
  if (credential?.accessToken) {
    inMemoryGoogleAccessToken = credential.accessToken;
  }
  return result;
}

export async function signInWithEmulatorGoogleUser() {
  if (!isFirebaseEmulatorEnabled) {
    throw new Error('El acceso de prueba solo está disponible con los emuladores locales.');
  }

  const mockGoogleIdToken = JSON.stringify({
    sub: 'silvv-memory-emulator-user',
    email: 'silvv-test-user@example.test',
    email_verified: true,
    name: 'Usuario de prueba SILVV',
  });

  return signInWithCredential(auth, GoogleAuthProvider.credential(mockGoogleIdToken));
}

export function subscribeToOrganizationChanges(
  uid: string,
  onChange: (collectionName: string) => void,
): () => void {
  const collectionNames = [
    'notes',
    'noteFolders',
    'memories',
    'memoryEvents',
    'peopleEntities',
    'eventRelations',
    'calendarEvents',
    'smartFolders',
  ];
  const initialized = new Set<string>();
  const unsubscribeAll = collectionNames.map((collectionName) =>
    onSnapshot(
      collection(db, 'users', uid, collectionName),
      (snapshot) => {
        if (!initialized.has(collectionName)) {
          initialized.add(collectionName);
          return;
        }
        if (snapshot.docChanges().length > 0) onChange(collectionName);
      },
      () => {},
    ),
  );
  return () => unsubscribeAll.forEach((unsubscribe) => unsubscribe());
}

export async function authorizeGoogleCalendarPopup(): Promise<string | null> {
  const calendarProvider = new GoogleAuthProvider();
  calendarProvider.addScope('https://www.googleapis.com/auth/calendar.events');
  calendarProvider.setCustomParameters({ prompt: 'consent' });

  const result = auth.currentUser
    ? await reauthenticateWithPopup(auth.currentUser, calendarProvider)
    : await signInWithPopup(auth, calendarProvider);

  const credential = GoogleAuthProvider.credentialFromResult(result);
  if (credential?.accessToken) {
    inMemoryGoogleAccessToken = credential.accessToken;
    return credential.accessToken;
  }
  return null;
}
