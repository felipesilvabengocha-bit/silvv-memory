import { eq, and, isNull } from 'drizzle-orm';
import { db } from './index.ts';
import { users, userPreferences, folders, conversations } from './schema.ts';

export async function ensureUserBootstrapped(
  uid: string,
  email: string,
  fullName?: string,
  avatarUrl?: string
) {
  try {
    const existing = await db
      .select()
      .from(users)
      .where(eq(users.uid, uid))
      .limit(1);

    let userRecord = existing[0];

    if (!userRecord) {
      const inserted = await db
        .insert(users)
        .values({
          uid,
          email,
          fullName: fullName || (email ? email.split('@')[0] : 'Usuario'),
          avatarUrl: avatarUrl || null,
        })
        .onConflictDoUpdate({
          target: users.uid,
          set: {
            email,
            ...(fullName ? { fullName } : {}),
            ...(avatarUrl ? { avatarUrl } : {}),
            updatedAt: new Date(),
          },
        })
        .returning();
      userRecord = inserted[0];
    }

    await db
      .insert(userPreferences)
      .values({ userUid: uid })
      .onConflictDoNothing({ target: userPreferences.userUid });

    const existingInbox = await db
      .select({ id: folders.id })
      .from(folders)
      .where(and(eq(folders.userUid, uid), eq(folders.isSystem, true), isNull(folders.deletedAt)))
      .limit(1);

    if (!existingInbox.length) {
      await db.insert(folders).values({
        userUid: uid,
        name: 'Bandeja de entrada',
        slug: 'bandeja-de-entrada',
        category: 'Inbox',
        description: 'Elementos recibidos pendientes o en clasificación automática',
        isSystem: true,
        autoCreated: false,
      });
    }

    const existingConv = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(and(eq(conversations.userUid, uid), isNull(conversations.deletedAt)))
      .limit(1);

    if (!existingConv.length) {
      await db.insert(conversations).values({
        userUid: uid,
        title: 'Bandeja universal',
        contextSummary: 'Conversación principal con SILVV MEMORY',
      });
    }

    return userRecord;
  } catch (error) {
    console.error('Database user bootstrap failed:', error);
    throw new Error('No se pudo inicializar el perfil de usuario.', { cause: error });
  }
}
