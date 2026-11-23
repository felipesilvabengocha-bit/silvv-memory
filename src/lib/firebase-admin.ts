import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import firebaseConfig from '../../firebase-applet-config.json' with { type: 'json' };

const authEmulatorHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
if (process.env.NODE_ENV === 'production' && authEmulatorHost) {
  throw new Error('Firebase Auth Emulator no puede usarse en producción.');
}

const projectId = process.env.FIREBASE_PROJECT_ID || firebaseConfig.projectId;

const app = getApps()[0] || initializeApp({ projectId });

export const adminAuth = getAuth(app);
export const adminDb = process.env.FIRESTORE_EMULATOR_HOST
  ? getFirestore(app)
  : getFirestore(app, firebaseConfig.firestoreDatabaseId);
