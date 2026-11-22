import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  reauthenticateWithPopup,
  signInWithPopup,
} from 'firebase/auth';
import { doc, getDocFromServer, getFirestore } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = firebaseConfig.firestoreDatabaseId
  ? getFirestore(app, firebaseConfig.firestoreDatabaseId)
  : getFirestore(app);

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
