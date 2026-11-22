import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { fetchPrivateFileBlobUrl } from '../lib/api';

interface PrivateImagePreviewProps {
  fileId?: number;
  src?: string;
  alt: string;
  className?: string;
  lazy?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function PrivateImagePreview({
  fileId,
  src,
  alt,
  className = 'max-h-64 max-w-full rounded-xl object-contain',
  lazy = false,
  open,
  onOpenChange,
}: PrivateImagePreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [shouldLoad, setShouldLoad] = useState(!lazy || Boolean(src));
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = open ?? internalOpen;
  const resolvedUrl = src ?? imageUrl;

  const setOpen = (nextOpen: boolean) => {
    if (onOpenChange) onOpenChange(nextOpen);
    else setInternalOpen(nextOpen);
  };

  useEffect(() => {
    if (!lazy || shouldLoad || !containerRef.current) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShouldLoad(true);
          observer.disconnect();
        }
      },
      { rootMargin: '160px' },
    );

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [lazy, shouldLoad]);

  useEffect(() => {
    if (!shouldLoad || src || !fileId) return;

    let active = true;
    let objectUrl: string | null = null;

    fetchPrivateFileBlobUrl(fileId)
      .then((url) => {
        if (!active) {
          URL.revokeObjectURL(url);
          return;
        }
        objectUrl = url;
        setImageUrl(url);
      })
      .catch(() => {
        if (active) setFailed(true);
      });

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [fileId, shouldLoad, src]);

  useEffect(() => {
    if (!isOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  return (
    <>
      <div ref={containerRef}>
        {resolvedUrl ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label={`Ampliar ${alt}`}
            className="block max-w-full cursor-zoom-in rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
          >
            <img
              src={resolvedUrl}
              alt={alt}
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
              className={className}
            />
          </button>
        ) : failed ? (
          <div
            role="img"
            aria-label={`${alt}: no se pudo cargar la imagen`}
            className="flex min-h-16 items-center justify-center rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-black/20 dark:text-zinc-400"
          >
            No se pudo cargar la imagen
          </div>
        ) : (
          <div
            aria-hidden="true"
            className="min-h-16 animate-pulse rounded-xl bg-zinc-200/60 dark:bg-white/5"
          />
        )}
      </div>
      {resolvedUrl && isOpen &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label={alt}
            tabIndex={-1}
            onClick={(event) => {
              if (event.target === event.currentTarget) setOpen(false);
            }}
            className="fixed inset-0 z-[120] flex items-center justify-center bg-black/90 p-4 text-white"
          >
            <button
              type="button"
              autoFocus
              onClick={() => setOpen(false)}
              aria-label="Cerrar imagen"
              className="absolute right-4 top-4 z-10 flex size-11 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <X className="size-5" />
            </button>
            <div className="flex max-h-full max-w-full flex-col items-center gap-3">
              <img
                src={resolvedUrl}
                alt={alt}
                className="max-h-[85dvh] max-w-full rounded-lg object-contain"
              />
              <p className="max-w-full truncate text-xs text-white/75">{alt}</p>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
