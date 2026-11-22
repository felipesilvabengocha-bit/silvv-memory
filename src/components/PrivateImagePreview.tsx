import { useEffect, useRef, useState } from 'react';
import { fetchPrivateFileBlobUrl } from '../lib/api';

interface PrivateImagePreviewProps {
  fileId: number;
  alt: string;
  className?: string;
  lazy?: boolean;
}

export function PrivateImagePreview({
  fileId,
  alt,
  className = 'max-h-64 max-w-full rounded-xl object-contain',
  lazy = false,
}: PrivateImagePreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [shouldLoad, setShouldLoad] = useState(!lazy);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

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
    if (!shouldLoad) return;

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
  }, [fileId, shouldLoad]);

  return (
    <div ref={containerRef}>
      {imageUrl ? (
        <img
          src={imageUrl}
          alt={alt}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          className={className}
        />
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
  );
}
