const SIGNIFICANT_CHARACTERS = /[\p{L}\p{N}]/gu;
const INVISIBLE_OR_SPACING = /[\p{C}\p{Z}\s]/gu;

export function hasMeaningfulNoteContent(value: unknown): value is string {
  if (typeof value !== 'string') return false;

  const normalized = value.normalize('NFKC').replace(INVISIBLE_OR_SPACING, '');
  const significantCharacters = normalized.match(SIGNIFICANT_CHARACTERS) || [];
  if (significantCharacters.length < 2) return false;

  return !/^([\p{L}\p{N}])\1+$/iu.test(normalized);
}

export function isValidNoteDraft(title: unknown, content: unknown): boolean {
  return hasMeaningfulNoteContent(title) || hasMeaningfulNoteContent(content);
}

export function getNoteValidationMessage(): string {
  return 'La nota necesita un título o contenido con al menos dos caracteres significativos.';
}
