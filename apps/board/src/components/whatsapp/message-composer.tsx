'use client';

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AttachmentIcon, SendIcon } from '@moonwitness/ui/icons';
import { toast } from '@moonwitness/ui/components/toast';
import { Button } from '@moonwitness/ui/components/button';
import { Checkbox } from '@moonwitness/ui/components/checkbox';
import { Input } from '@moonwitness/ui/components/input';
import { Textarea } from '@moonwitness/ui/components/textarea';
import { MAX_ATTACHMENT_BYTES } from '@moonwitness/types';
import { client } from '@/lib/client';
import { scopedQueryKey } from '@/lib/query-scope';
import {
  deleteWhatsappDraft,
  readWhatsappDraft,
  writeWhatsappDraft,
} from '@/whatsapp-draft-storage';
import {
  formatTransferRate,
  type GroupProfile,
  type Message,
  type UploadProgressState,
} from './types';

const PREVIEWABLE_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

export function MessageComposer({
  conversationId,
  groupParticipants,
  directUploads,
  replyTo,
  onCancelReply,
  sendOnEnter,
  onSendOnEnterChange,
}: {
  conversationId: number;
  groupParticipants: GroupProfile['participants'];
  directUploads: boolean;
  replyTo: Message | null;
  onCancelReply: () => void;
  sendOnEnter: boolean;
  onSendOnEnterChange: (value: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState('');
  const [selectedMentions, setSelectedMentions] = useState<string[]>([]);
  const [mentionPickerOpen, setMentionPickerOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<{ file: File; url: string } | null>(null);
  const [draftSaved, setDraftSaved] = useState(false);
  const [loadedDraftKey, setLoadedDraftKey] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgressState | null>(null);
  const sendLock = useRef(false);
  const idempotencyKey = useRef(crypto.randomUUID());
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadAbortController = useRef<AbortController | null>(null);
  const previousUploadProgress = useRef({ loadedBytes: 0, sampledAt: 0 });
  const draftSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftSaveWarningShown = useRef(false);
  const companyId = client.getCompanyId();
  const mentionOptions = groupParticipants.flatMap((participant) => {
    const phone = participant.phone_number?.replace(/@.*$/u, '').replace(/\D/gu, '') ?? '';
    return /^\d{7,15}$/u.test(phone)
      ? [{ phone, label: participant.display_name?.trim() || `+${phone}` }]
      : [];
  });
  const mentionableMedia = !file || !/^audio\//u.test(file.type);
  const toggleMention = (mention: string) => {
    setSelectedMentions((current) => {
      const next = current.includes(mention)
        ? current.filter((item) => item !== mention)
        : mention === '@everyone'
          ? ['@everyone']
          : [...current.filter((item) => item !== '@everyone'), mention];
      idempotencyKey.current = crypto.randomUUID();
      return next;
    });
  };
  const draftStorageKey =
    client.currentUser && companyId
      ? `whatsapp:${client.currentUser.id}:${companyId}:${conversationId}`
      : null;

  const [prevDraftKey, setPrevDraftKey] = useState(draftStorageKey);
  if (prevDraftKey !== draftStorageKey) {
    setPrevDraftKey(draftStorageKey);
    setDraft('');
    setFile(null);
    setLoadedDraftKey(null);
  }

  const filePreviewUrl = filePreview?.file === file ? filePreview.url : null;
  useEffect(() => {
    if (!file || !PREVIEWABLE_IMAGE_TYPES.has(file.type)) return;
    const url = URL.createObjectURL(file);
    const frameId = requestAnimationFrame(() => {
      setFilePreview({ file, url });
    });
    return () => {
      cancelAnimationFrame(frameId);
      URL.revokeObjectURL(url);
    };
  }, [file]);

  useEffect(() => {
    let cancelled = false;
    if (!draftStorageKey) return;
    void readWhatsappDraft(draftStorageKey)
      .then((saved) => {
        if (cancelled) return;
        setDraft(saved?.text ?? '');
        setFile(
          saved?.file
            ? new File([saved.file.blob], saved.file.name, {
                type: saved.file.type,
                lastModified: saved.file.lastModified,
              })
            : null
        );
        setDraftSaved(Boolean(saved && (saved.text || saved.file)));
        setLoadedDraftKey(draftStorageKey);
      })
      .catch(() => {
        if (!cancelled) setLoadedDraftKey(draftStorageKey);
      });
    return () => {
      cancelled = true;
    };
  }, [draftStorageKey]);

  useEffect(() => {
    if (!draftStorageKey || loadedDraftKey !== draftStorageKey) return;
    const timeout = setTimeout(() => {
      draftSaveTimer.current = null;
      void writeWhatsappDraft(draftStorageKey, {
        text: draft,
        ...(file
          ? {
              file: {
                blob: file,
                name: file.name,
                type: file.type,
                lastModified: file.lastModified,
              },
            }
          : {}),
      })
        .then(() => {
          draftSaveWarningShown.current = false;
          setDraftSaved(Boolean(draft || file));
        })
        .catch(() => {
          if (!draftSaveWarningShown.current) {
            toast.error('Draft could not be saved on this device');
            draftSaveWarningShown.current = true;
          }
        });
    }, 300);
    draftSaveTimer.current = timeout;
    return () => {
      clearTimeout(timeout);
      if (draftSaveTimer.current === timeout) draftSaveTimer.current = null;
    };
  }, [draft, file, draftStorageKey, loadedDraftKey]);

  useEffect(() => {
    idempotencyKey.current = crypto.randomUUID();
  }, [replyTo?.id]);

  const send = async (event: FormEvent) => {
    event.preventDefault();
    if (sendLock.current || (!draft.trim() && !file)) return;
    if (file && file.size > MAX_ATTACHMENT_BYTES) {
      toast.error('File must be 10 MiB or smaller');
      return;
    }
    sendLock.current = true;
    setSending(true);
    setUploadProgress(file ? { percent: 0, bytesPerSecond: 0 } : null);
    const abortController = file ? new AbortController() : null;
    uploadAbortController.current = abortController;
    previousUploadProgress.current = { loadedBytes: 0, sampledAt: performance.now() };
    try {
      const body: FormData | Record<string, unknown> = file
        ? new FormData()
        : {
            content: draft.trim(),
            mentions: JSON.stringify(selectedMentions),
            ...(replyTo ? { reply_to_message_id: replyTo.id } : {}),
          };
      if (body instanceof FormData) {
        body.set('content', draft.trim());
        body.set('mentions', JSON.stringify(selectedMentions));
        if (replyTo) body.set('reply_to_message_id', String(replyTo.id));
        body.set('media', file!, file!.name);
      }
      const requestOptions = {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey.current },
        body,
      } as const;
      const reportUploadProgress = (progress: { loadedBytes: number; percent: number | null }) => {
        const sampledAt = performance.now();
        const previous = previousUploadProgress.current;
        const durationMs = Math.max(1, sampledAt - previous.sampledAt);
        const bytesPerSecond =
          Math.max(0, progress.loadedBytes - previous.loadedBytes) * (1000 / durationMs);
        previousUploadProgress.current = { loadedBytes: progress.loadedBytes, sampledAt };
        setUploadProgress({ percent: progress.percent, bytesPerSecond });
      };
      if (file && directUploads && abortController) {
        const ticket = (
          await client.request<{
            data: {
              upload_id: number;
              url: string;
              fields: Record<string, string>;
            };
          }>(`/whatsapp/conversations/${conversationId}/uploads`, {
            method: 'POST',
            body: {
              file_name: file.name,
              content_type: file.type || 'application/octet-stream',
              size_bytes: file.size,
            },
          })
        ).data;
        await client.uploadPresignedPost(ticket.url, ticket.fields, file, {
          signal: abortController.signal,
          onUploadProgress: reportUploadProgress,
        });
        await client.request(`/whatsapp/conversations/${conversationId}/messages`, {
          method: 'POST',
          headers: { 'Idempotency-Key': idempotencyKey.current },
          body: {
            content: draft.trim(),
            upload_ticket_id: ticket.upload_id,
            mentions: JSON.stringify(selectedMentions),
            ...(replyTo ? { reply_to_message_id: replyTo.id } : {}),
          },
        });
      } else if (body instanceof FormData && abortController) {
        await client.requestWithUploadProgress(
          `/whatsapp/conversations/${conversationId}/messages`,
          {
            ...requestOptions,
            body,
            signal: abortController.signal,
            onUploadProgress: reportUploadProgress,
          }
        );
      } else {
        await client.request(`/whatsapp/conversations/${conversationId}/messages`, requestOptions);
      }
      if (draftSaveTimer.current) clearTimeout(draftSaveTimer.current);
      draftSaveTimer.current = null;
      if (draftStorageKey) await deleteWhatsappDraft(draftStorageKey).catch(() => undefined);
      setDraft('');
      setFile(null);
      setSelectedMentions([]);
      setDraftSaved(false);
      onCancelReply();
      idempotencyKey.current = crypto.randomUUID();
      if (fileInput.current) fileInput.current.value = '';
      await queryClient.invalidateQueries({ queryKey: scopedQueryKey(['whatsapp']) });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        toast.error('Upload stopped. Your draft is saved; retry uses the same message key.');
      } else {
        toast.error(error instanceof Error ? error.message : 'Message could not be queued');
      }
    } finally {
      uploadAbortController.current = null;
      sendLock.current = false;
      setSending(false);
      setUploadProgress(null);
    }
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const shouldSend = sendOnEnter
      ? event.key === 'Enter' && !event.shiftKey
      : event.key === 'Enter' && (event.ctrlKey || event.metaKey);
    if (!shouldSend) return;
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  };

  return (
    <form onSubmit={send} className="flex flex-col gap-2 border-t-2 border-ink p-3">
      {groupParticipants.length > 0 && (
        <div className="flex flex-col items-start gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!mentionableMedia || sending}
            aria-expanded={mentionPickerOpen}
            onClick={() => setMentionPickerOpen((open) => !open)}
          >
            {mentionPickerOpen ? 'Hide mentions' : 'Mention participants'}
          </Button>
          {mentionPickerOpen && (
            <div
              role="group"
              aria-label="Mention picker"
              className="flex max-h-32 flex-wrap gap-2 overflow-y-auto"
            >
              <Button
                type="button"
                size="sm"
                variant={selectedMentions.includes('@everyone') ? 'default' : 'outline'}
                aria-pressed={selectedMentions.includes('@everyone')}
                onClick={() => toggleMention('@everyone')}
              >
                @everyone
              </Button>
              {mentionOptions.map((participant) => (
                <Button
                  key={participant.phone}
                  type="button"
                  size="sm"
                  variant={selectedMentions.includes(participant.phone) ? 'default' : 'outline'}
                  aria-pressed={selectedMentions.includes(participant.phone)}
                  disabled={
                    sending ||
                    (selectedMentions.length >= 100 &&
                      !selectedMentions.includes(participant.phone))
                  }
                  onClick={() => toggleMention(participant.phone)}
                >
                  @{participant.label}
                </Button>
              ))}
            </div>
          )}
          {selectedMentions.length > 0 && (
            <p role="status" className="text-xs text-ink-faint">
              Mention preview ({selectedMentions.length}/100):{' '}
              {selectedMentions
                .map((mention) =>
                  mention === '@everyone'
                    ? mention
                    : `@${mentionOptions.find((item) => item.phone === mention)?.label ?? mention}`
                )
                .join(', ')}
            </p>
          )}
          {!mentionableMedia && (
            <p className="text-xs text-ink-faint">Mentions are not supported for audio messages.</p>
          )}
        </div>
      )}
      {replyTo && (
        <div className="flex items-start justify-between gap-3 border-l-2 border-magenta bg-cream p-2 text-xs">
          <p className="min-w-0 truncate">
            Replying to: {replyTo.content || `[${replyTo.message_type}]`}
          </p>
          <Button
            type="button"
            variant="link"
            className="h-auto p-0 underline"
            onClick={onCancelReply}
          >
            Cancel reply
          </Button>
        </div>
      )}
      <div className="flex items-center gap-2">
        <label
          className="cursor-pointer rounded border-2 border-ink p-2 hover:bg-magenta/20"
          title="Attach media"
        >
          <span className="sr-only">Attach media</span>
          <AttachmentIcon className="size-4" />
          <Input
            type="file"
            ref={fileInput}
            disabled={sending}
            aria-label="Attach media"
            className="sr-only"
            accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx"
            onChange={(event) => {
              const selected = event.target.files?.[0] ?? null;
              if (selected && selected.size > MAX_ATTACHMENT_BYTES) {
                toast.error('File must be 10 MiB or smaller');
                event.target.value = '';
                setFile(null);
                setDraftSaved(false);
                return;
              }
              setFile(selected);
              setDraftSaved(false);
              idempotencyKey.current = crypto.randomUUID();
            }}
          />
        </label>
        <Textarea
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setDraftSaved(false);
            idempotencyKey.current = crypto.randomUUID();
          }}
          placeholder="Write a message…"
          aria-label="Write a message"
          maxLength={8000}
          disabled={sending}
          rows={2}
          onKeyDown={handleComposerKeyDown}
          className="min-h-10 resize-y"
        />
        <Button
          type="submit"
          disabled={sending || (!draft.trim() && !file)}
          aria-label={sending ? 'Sending message' : 'Send message'}
        >
          {sending ? 'Sending…' : <SendIcon className="size-4" />}
        </Button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-xs text-ink-faint">
          <Checkbox
            checked={sendOnEnter}
            onChange={(event) => onSendOnEnterChange(event.target.checked)}
            aria-label="Press Enter to send"
          />
          Press Enter to send
        </label>
        <p className="text-[10px] text-ink-faint">
          {sendOnEnter ? 'Shift+Enter for a new line' : 'Ctrl+Enter to send'} · Media files up to 10
          MiB
        </p>
      </div>
      {file && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {filePreviewUrl && (
            <img
              src={filePreviewUrl}
              alt={`Preview of ${file.name}`}
              className="size-16 border border-ink object-cover"
            />
          )}
          <span>Attached: {file.name}</span>
          <Button
            type="button"
            variant="link"
            className="h-auto p-0 underline"
            onClick={() => {
              setFile(null);
              setDraftSaved(false);
              idempotencyKey.current = crypto.randomUUID();
              if (fileInput.current) fileInput.current.value = '';
            }}
          >
            Remove
          </Button>
        </div>
      )}
      {draftSaved && (draft || file) && (
        <p role="status" className="text-xs text-ink-faint">
          Draft saved on this device
        </p>
      )}
      {file && sending && uploadProgress && (
        <div className="space-y-2" aria-live="polite">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <p role="status">
              {uploadProgress.percent === null
                ? `Uploading ${file.name} · ${formatTransferRate(uploadProgress.bytesPerSecond)}`
                : `Uploading ${file.name} · ${uploadProgress.percent}% · ${formatTransferRate(uploadProgress.bytesPerSecond)}`}
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => uploadAbortController.current?.abort()}
            >
              Cancel upload
            </Button>
          </div>
          <div
            role="progressbar"
            aria-label={`Upload progress for ${file.name}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={uploadProgress.percent ?? undefined}
            className="h-2 overflow-hidden border border-ink bg-paper-raised"
          >
            <div
              className="h-full bg-magenta transition-[width] duration-150"
              style={{ width: `${uploadProgress.percent ?? 0}%` }}
            />
          </div>
        </div>
      )}
    </form>
  );
}
