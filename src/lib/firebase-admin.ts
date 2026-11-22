import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import firebaseConfig from '../../firebase-applet-config.json' with { type: 'json' };

const authEmulatorHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
if (process.env.NODE_ENV === 'production' && authEmulatorHost) {
  throw new Error('Firebase Auth Emulator no puede usarse en producción.');
}

const projectId = process.env.FIREBASE_PROJECT_ID || firebaseConfig.projectId;

if (!getApps().length) {
  initializeApp({
    projectId,
  });
}

export const adminAuth = getAuth();
