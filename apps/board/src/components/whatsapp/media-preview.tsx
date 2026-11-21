'use client';

import { useEffect, useRef, useState } from 'react';
import { ApiError } from '@moonwitness/client';
import { Button } from '@moonwitness/ui/components/button';
import { client } from '@/lib/client';
import {
  formatMediaSize,
  formatTransferRate,
  mediaLoadFailureMessage,
  safeMediaDownloadName,
  type Message,
  type UploadProgressState,
} from './types';

type MediaLoadResult =
  | {
      requestKey: string;
      status: 'loaded';
      url: string;
      mimeType: string;
      sizeBytes: number | null;
      thumbnailSizeBytes: number | null;
    }
  | {
      requestKey: string;
      status: 'failed';
      failureMessage: string;
    };

export function MediaPreview({ message }: { message: Message }) {
  const defaultMode: 'thumbnail' | 'original' =
    message.message_type === 'image' || message.message_type === 'video' ? 'thumbnail' : 'original';
  const [modeOverride, setModeOverride] = useState<{
    messageId: number;
    mode: 'thumbnail' | 'original';
  } | null>(null);
  const mode = modeOverride?.messageId === message.id ? modeOverride.mode : defaultMode;
  const [attempt, setAttempt] = useState(0);
  const requestKey = `${message.id}:${mode}:${attempt}`;
  const [loadResult, setLoadResult] = useState<MediaLoadResult | null>(null);
  const [progressState, setProgressState] = useState<{
    requestKey: string;
    progress: UploadProgressState | null;
  } | null>(null);
  const downloadAbortController = useRef<AbortController | null>(null);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    const controller = new AbortController();
    downloadAbortController.current = controller;
    const previousProgress = { loadedBytes: 0, sampledAt: performance.now() };
    const isThumbnail = mode === 'thumbnail';
    const path = `/whatsapp/media/${message.id}${isThumbnail ? '/thumbnail' : ''}`;
    let responseHeaders: Readonly<Record<string, string>> = {};
    void client
      .requestBlobWithDownloadProgress(path, {
        signal: controller.signal,
        onDownloadProgress: (progress) => {
          if (!active) return;
          const sampledAt = performance.now();
          const durationMs = Math.max(1, sampledAt - previousProgress.sampledAt);
          const bytesPerSecond =
            Math.max(0, progress.loadedBytes - previousProgress.loadedBytes) * (1000 / durationMs);
          previousProgress.loadedBytes = progress.loadedBytes;
          previousProgress.sampledAt = sampledAt;
          setProgressState({
            requestKey,
            progress: { percent: progress.percent, bytesPerSecond },
          });
        },
        onDownloadResponse: (headers) => {
          responseHeaders = headers;
        },
      })
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        const resolvedMime = isThumbnail
          ? responseHeaders['x-original-content-type'] || blob.type || 'application/octet-stream'
          : blob.type || 'application/octet-stream';
        const originalSize = Number(responseHeaders['x-original-content-length']);
        setLoadResult({
          requestKey,
          status: 'loaded',
          url: objectUrl,
          mimeType: resolvedMime,
          thumbnailSizeBytes: isThumbnail ? blob.size : null,
          sizeBytes: isThumbnail
            ? Number.isSafeInteger(originalSize) && originalSize >= 0
              ? originalSize
              : null
            : blob.size,
        });
      })
      .catch((error: unknown) => {
        if (
          active &&
          isThumbnail &&
          message.message_type === 'video' &&
          error instanceof ApiError &&
          error.status === 415
        ) {
          setModeOverride({ messageId: message.id, mode: 'original' });
          return;
        }
        if (active) {
          setLoadResult({
            requestKey,
            status: 'failed',
            failureMessage: mediaLoadFailureMessage(error),
          });
        }
      })
      .finally(() => {
        if (downloadAbortController.current === controller) downloadAbortController.current = null;
        if (active) setProgressState({ requestKey, progress: null });
      });
    return () => {
      active = false;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [message.id, message.message_type, mode, requestKey]);

  const activeResult = loadResult?.requestKey === requestKey ? loadResult : null;
  const failed = activeResult?.status === 'failed';
  const failureMessage =
    activeResult?.status === 'failed'
      ? activeResult.failureMessage
      : 'Attachment could not be loaded.';
  const downloadProgress =
    progressState?.requestKey === requestKey
      ? progressState.progress
      : { percent: 0, bytesPerSecond: 0 };

  if (failed)
    return (
      <div role="status" className="mt-2 flex items-center gap-2 text-xs text-ink-faint">
        <span>{failureMessage}</span>
        <Button
          type="button"
          variant="link"
          className="h-auto p-0 underline"
          onClick={() => {
            setModeOverride({ messageId: message.id, mode: defaultMode });
            setAttempt((value) => value + 1);
          }}
        >
          Try again
        </Button>
      </div>
    );
  if (!activeResult)
    return (
      <div className="mt-2 space-y-2" aria-live="polite">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <p role="status">
            {downloadProgress?.percent === null || !downloadProgress
              ? `Downloading attachment · ${formatTransferRate(downloadProgress?.bytesPerSecond ?? 0)}`
              : `Downloading attachment · ${downloadProgress.percent}% · ${formatTransferRate(downloadProgress.bytesPerSecond)}`}
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => downloadAbortController.current?.abort()}
          >
            Cancel download
          </Button>
        </div>
        {downloadProgress && (
          <div
            role="progressbar"
            aria-label={`Download progress for ${safeMediaDownloadName(message.media_file_name).name}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={downloadProgress.percent ?? undefined}
            className="h-2 overflow-hidden border border-ink bg-paper-raised"
          >
            <div
              className="h-full bg-magenta transition-[width] duration-150"
              style={{ width: `${downloadProgress.percent ?? 0}%` }}
            />
          </div>
        )}
      </div>
    );

  const { url, mimeType, sizeBytes, thumbnailSizeBytes } = activeResult;
  const safeName = safeMediaDownloadName(message.media_file_name);
  const metadata = (
    <p className="mt-1 text-xs text-ink-faint">
      {mode === 'thumbnail'
        ? `Preview thumbnail${thumbnailSizeBytes !== null ? ` · ${formatMediaSize(thumbnailSizeBytes)}` : ''}`
        : mimeType || 'Unknown file type'}
      {sizeBytes !== null
        ? ` · ${mode === 'thumbnail' ? 'Original ' : ''}${formatMediaSize(sizeBytes)}`
        : ''}
    </p>
  );
  if (mode === 'thumbnail')
    return (
      <div>
        <img
          src={url}
          alt={`${safeName.name} preview`}
          className="mt-2 max-h-64 max-w-full object-contain"
        />
        {metadata}
        <Button
          type="button"
          variant="link"
          className="h-auto p-0 underline"
          onClick={() => setModeOverride({ messageId: message.id, mode: 'original' })}
        >
          {message.message_type === 'video' ? 'Load video' : 'Load original image'}
        </Button>
      </div>
    );
  if (mimeType.startsWith('image/'))
    return (
      <div>
        <a href={url} target="_blank" rel="noreferrer">
          <img src={url} alt={safeName.name} className="mt-2 max-h-64 max-w-full object-contain" />
        </a>
        {metadata}
        <Button
          type="button"
          variant="link"
          className="h-auto p-0 underline"
          onClick={() => setModeOverride({ messageId: message.id, mode: 'thumbnail' })}
        >
          Show thumbnail
        </Button>
      </div>
    );
  if (mimeType.startsWith('video/'))
    return (
      <div>
        <video controls src={url} className="mt-2 max-h-64 max-w-full" />
        {metadata}
        <Button
          type="button"
          variant="link"
          className="h-auto p-0 underline"
          onClick={() => setModeOverride({ messageId: message.id, mode: 'thumbnail' })}
        >
          Show poster
        </Button>
      </div>
    );
  if (mimeType.startsWith('audio/'))
    return (
      <div>
        <audio controls src={url} className="mt-2 max-w-full" />
        {metadata}
      </div>
    );
  if (mimeType === 'application/pdf')
    return (
      <div className="mt-2 space-y-1">
        <iframe
          src={url}
          title={`Sandboxed PDF preview: ${safeName.name}`}
          sandbox=""
          className="h-72 w-full border border-ink"
        />
        <p className="text-xs text-ink-faint">
          PDF preview is sandboxed. Download the file to use your PDF reader.
        </p>
        {metadata}
        <a href={url} download={safeName.name} className="inline-block underline">
          Download PDF
        </a>
      </div>
    );
  return (
    <div className="mt-2 space-y-1">
      <p className="text-sm">{safeName.name}</p>
      {metadata}
      {safeName.blockedExtension && (
        <p role="status" className="text-xs text-warning">
          Potentially active file type ({safeName.blockedExtension}) is renamed for safer download.
        </p>
      )}
      <a href={url} download={safeName.name} className="inline-block underline">
        Download attachment
      </a>
    </div>
  );
}
