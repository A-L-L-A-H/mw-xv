import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArchiveIcon, ArrowRightIcon, BoltIcon, DeleteIcon, SaveIcon } from '@moonwitness/ui/icons';
import { LoadingSpinner } from '@moonwitness/ui/components/effects';
import { toast } from '@moonwitness/ui/components/toast';
import { ConflictError } from '@moonwitness/client';
import { evalDomain, type FieldMeta, type ResolvedViews } from '@moonwitness/client';
import { client } from '@/lib/client';
import { keys, useRecord, useRecordMutations, type RecordData } from '@/hooks/use-model';
import { formatDateTime } from '@/lib/date-format';
import { Button } from '@moonwitness/ui/components/button';
import { StatusBar } from '@moonwitness/ui/components/status-bar';
import { SmartButtonBox } from '@moonwitness/ui/components/smart-button-box';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@moonwitness/ui/components/tabs';
import { ConfirmDialog } from './confirm-dialog';
import { Label } from '@moonwitness/ui/components/label';
import { Skeleton } from '@moonwitness/ui/components/skeleton';
import { FieldWidget } from './fields';
import { relationKey } from './field-utils';
import { One2ManyWidget } from './one2many-widget';
import { Chatter } from './chatter';
import { TagsWidget } from './tags-widget';
import { WorkflowPanel } from './workflow-panel';

interface FormViewProps {
  model: string;
  views: ResolvedViews;
  recordId?: number; // undefined = create mode
  initialValues?: Record<string, unknown>;
  onBack: () => void;
  onSaved?: (id: number) => void;
}

export function FormView(props: FormViewProps) {
  const { data: initialRecord, isLoading } = useRecord(props.model, props.recordId);
  if (props.recordId !== undefined && isLoading) {
    return (
      <div className="ink-panel p-8 space-y-6 bg-card">
        <Skeleton className="h-10 w-full bg-ink/10" />
        <Skeleton className="h-10 w-full bg-ink/10" />
        <Skeleton className="h-10 w-2/3 bg-ink/10" />
      </div>
    );
  }
  return (
    <FormEditor
      key={`${props.model}:${props.recordId ?? 'new'}:${JSON.stringify(props.initialValues ?? {})}`}
      {...props}
      initialRecord={initialRecord}
    />
  );
}

function FormEditor({
  model,
  views,
  recordId,
  initialValues,
  onBack,
  onSaved,
  initialRecord,
}: FormViewProps & { initialRecord?: Record<string, unknown> }) {
  const isCreate = recordId === undefined;
  const mutations = useRecordMutations(model);
  const queryClient = useQueryClient();

  const [formData, setFormData] = useState<Record<string, unknown>>(() => {
    if (initialRecord) return { ...initialRecord };
    return {
      ...Object.fromEntries(
        views.fields
          .filter((field) => field.default !== undefined)
          .map((field) => [field.name, field.default])
      ),
      ...initialValues,
    };
  });
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<
    { kind: 'archive'; hard: boolean } | { kind: 'back' } | null
  >(null);
  const [conflict, setConflict] = useState<{ serverRecord: Record<string, unknown> } | null>(null);
  const saveInFlight = useRef(false);

  // Field lookup map
  const fieldMap = useMemo(() => {
    return new Map<string, FieldMeta>(views.fields.map((f) => [f.name, f]));
  }, [views]);

  // Warn on browser tab close or reload if dirty
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [dirty]);

  const handleBackSafe = useCallback(() => {
    if (dirty) setConfirmAction({ kind: 'back' });
    else onBack();
  }, [dirty, onBack]);

  function handleChange(name: string, val: unknown) {
    setFormData((prev) => {
      const next = { ...prev, [name]: val };
      // When country changes, reset dependent state field if it was set
      if (name === 'country' || name === 'country_id') {
        if (prev.state || prev.state_id) {
          next.state = null;
          next.state_id = null;
        }
      }
      return next;
    });
    setDirty(true);
    setError(null);
  }

  const handleSave = useCallback(
    async (e?: React.FormEvent) => {
      if (e) e.preventDefault();
      if (saveInFlight.current) return;
      setError(null);

      // Validate required fields (respecting dynamic visibility and required predicates)
      for (const [name, f] of fieldMap.entries()) {
        if (f.type === 'one2many') continue;
        const isInvisible = evalDomain(f.invisible, formData);
        const isRequired = f.required || evalDomain(f.requiredIf, formData);

        if (
          !isInvisible &&
          isRequired &&
          (formData[name] === undefined || formData[name] === null || formData[name] === '')
        ) {
          setError(`Field '${f.label}' is required.`);
          return;
        }
      }

      try {
        const cleanValues: Record<string, unknown> = {};
        for (const [key, val] of Object.entries(formData)) {
          if (['id', 'create_date', 'write_date', 'create_uid', 'write_uid'].includes(key))
            continue;
          const field = fieldMap.get(key);
          if (field && (field.readonly || field.type === 'one2many')) continue;
          if (typeof val === 'object' && val !== null && !Array.isArray(val) && !field) continue;
          cleanValues[key] = val;
        }
        for (const field of views.fields) {
          if (
            field.default !== undefined &&
            !Object.hasOwn(cleanValues, field.name) &&
            !field.readonly &&
            field.type !== 'one2many'
          ) {
            cleanValues[field.name] = field.default;
          }
        }

        saveInFlight.current = true;
        const saved = await mutations.save.mutateAsync({
          id: recordId,
          values: cleanValues,
          writeDate: isCreate ? undefined : String(initialRecord?.write_date ?? ''),
        });
        setDirty(false);
        toast.success('Record saved successfully.');

        if (isCreate && saved?.id) {
          onSaved?.(saved.id);
        }
      } catch (err: unknown) {
        if (err instanceof ConflictError && recordId !== undefined) {
          try {
            const serverRecord = await queryClient.fetchQuery<RecordData>({
              queryKey: keys.record(model, recordId),
              queryFn: () => client.model<RecordData>(model).read(recordId),
              staleTime: 0,
            });
            setConflict({ serverRecord });
          } catch {
            setConflict({ serverRecord: {} });
          }
        } else {
          setError(err instanceof Error ? err.message : 'Failed to save record.');
        }
      } finally {
        saveInFlight.current = false;
      }
    },
    [
      fieldMap,
      formData,
      views.fields,
      mutations.save,
      recordId,
      isCreate,
      onSaved,
      initialRecord,
      model,
      queryClient,
    ]
  );

  // Keyboard shortcut listener: Ctrl+S to save, Esc to go back
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 's' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        void handleSave();
      }
      if (e.key === 'Escape') {
        handleBackSafe();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSave, handleBackSafe]);

  async function handleArchive(hard = false) {
    if (!recordId) return;
    try {
      await mutations.archive.mutateAsync({
        id: recordId,
        hard,
        writeDate: String(initialRecord?.write_date ?? ''),
      });
      toast.success(hard ? 'Record deleted.' : 'Record archived.');
      onBack();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to archive record.');
    } finally {
      setConfirmAction(null);
    }
  }

  const exposedActions = useMemo(() => {
    return (views.actions ?? []).filter((act) => act !== 'action_archive');
  }, [views.actions]);

  async function handleExecuteAction(method: string) {
    if (!recordId) return;
    setError(null);
    try {
      await mutations.action.mutateAsync({ id: recordId, method });
      toast.success('Action executed successfully.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed to execute.');
    }
  }

  const canWrite = views.permissions.write || (isCreate && views.permissions.create);

  const formSections = useMemo(() => {
    const sections = views.form?.sections?.length
      ? views.form.sections
      : [{ fields: views.fields.map((f) => f.name) }];
    const visibleSections = sections.map((section, index) => ({
      ...section,
      title: section.title ?? `Section ${index + 1}`,
    }));
    const labels = views.form?.tabs?.length
      ? views.form.tabs
      : visibleSections.map((s) => s.title!);
    return { visibleSections, labels };
  }, [views.fields, views.form]);

  const saveStep = isCreate ? 1 : dirty ? 2 : 3;
  const archiveTarget = confirmAction?.kind === 'archive' ? confirmAction : null;

  return (
    <div className="min-w-0 space-y-6">
      {/* Top action bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b-2 border-ink pb-5">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={handleBackSafe} className="gap-1.5">
            <ArrowRightIcon className="size-4 rotate-180" /> Back to list
          </Button>
          <div className="h-6 w-0.5 bg-ink/20" />
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="ink-title text-2xl sm:text-3xl">
              {isCreate ? (
                <span>New {views.title.replace(/s$/, '')}</span>
              ) : (
                <span>
                  {views.title.replace(/s$/, '')}{' '}
                  <span className="font-mono text-ink-faint">#{recordId}</span>
                </span>
              )}
            </h1>
            {!isCreate && recordId !== undefined && (
              <TagsWidget model={model} recordId={recordId} />
            )}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Custom exposed actions */}
          {!isCreate &&
            exposedActions.map((method) => {
              if (method === 'action_unarchive' && initialRecord?.active !== false) {
                return null;
              }
              const label = method
                .replace(/^action_/, '')
                .replace(/_/g, ' ')
                .replace(/\b\w/g, (c) => c.toUpperCase());
              const isUnarchive = method === 'action_unarchive';

              return (
                <Button
                  key={method}
                  variant="outline"
                  size="sm"
                  onClick={() => handleExecuteAction(method)}
                  disabled={mutations.action.isPending}
                  className={
                    isUnarchive
                      ? 'gap-1.5 hover:bg-primary hover:text-primary-foreground'
                      : 'gap-1.5 hover:bg-primary/25'
                  }
                >
                  {mutations.action.isPending ? (
                    <LoadingSpinner className="size-4" />
                  ) : (
                    <BoltIcon className="size-4 text-yellow-readable" />
                  )}
                  {label}
                </Button>
              );
            })}

          {canWrite && (
            <SmartButtonBox
              className="min-w-0"
              primaryActions={[
                {
                  id: 'save',
                  label: 'Save Record',
                  icon: mutations.save.isPending ? (
                    <LoadingSpinner className="size-4" />
                  ) : (
                    <SaveIcon className="size-4" />
                  ),
                  onClick: () => void handleSave(),
                  disabled: !dirty || mutations.save.isPending,
                  primary: true,
                },
              ]}
              secondaryActions={
                !isCreate && views.permissions.unlink
                  ? [
                      ...(initialRecord?.active !== false
                        ? [
                            {
                              id: 'archive',
                              label: 'Archive',
                              icon: <ArchiveIcon className="size-4" />,
                              variant: 'outline' as const,
                              ariaLabel: 'Archive record',
                              onClick: () => setConfirmAction({ kind: 'archive', hard: false }),
                              disabled: mutations.archive.isPending,
                            },
                          ]
                        : []),
                      {
                        id: 'delete-permanently',
                        label: 'Delete permanently',
                        icon: <DeleteIcon className="size-4" />,
                        variant: 'destructive' as const,
                        ariaLabel: 'Delete record permanently',
                        onClick: () => setConfirmAction({ kind: 'archive', hard: true }),
                        disabled: mutations.archive.isPending,
                      },
                    ]
                  : []
              }
            />
          )}
        </div>
      </div>

      {/* Notifications */}
      {error && (
        <div className="border-2 border-ink bg-destructive p-3 font-bold text-destructive-foreground shadow-ink">
          {error}
        </div>
      )}
      {!isCreate && (
        <StatusBar
          steps={[
            { id: 'loaded', label: 'Loaded', state: saveStep >= 1 ? 'done' : 'disabled' },
            {
              id: 'editing',
              label: 'Editing',
              state: saveStep === 2 ? 'active' : saveStep > 2 ? 'done' : 'disabled',
            },
            { id: 'saved', label: 'Saved', state: saveStep === 3 ? 'done' : 'disabled' },
          ]}
        />
      )}

      {!isCreate && recordId !== undefined && <WorkflowPanel model={model} recordId={recordId} />}

      {/* Form sections */}
      <form onSubmit={handleSave} className="space-y-6">
        <Tabs defaultValue="0" className="min-w-0 space-y-5">
          <TabsList className="flex-wrap">
            {formSections.visibleSections.map((section, index) => (
              <TabsTrigger key={index} value={String(index)}>
                {section.title}
              </TabsTrigger>
            ))}
          </TabsList>
          {formSections.visibleSections.map((section, sIdx) => {
            const visibleFields = section.fields
              .map((fieldName) => fieldMap.get(fieldName))
              .filter((f): f is FieldMeta => f !== undefined && f.name !== 'id');

            return (
              <TabsContent
                key={sIdx}
                value={String(sIdx)}
                className="ink-panel min-w-0 bg-card p-6 sm:p-8"
              >
                <div className="grid min-w-0 gap-6 sm:grid-cols-2">
                  {visibleFields.map((field) => {
                    const isInvisible = evalDomain(field.invisible, formData);
                    if (isInvisible) return null;

                    const isReadonly = field.readonly || evalDomain(field.readonlyIf, formData);
                    const isRequired = field.required || evalDomain(field.requiredIf, formData);

                    if (field.type === 'one2many') {
                      return (
                        <div key={field.name} className="min-w-0 pt-2 sm:col-span-2">
                          <One2ManyWidget
                            field={field}
                            parentModel={model}
                            parentId={recordId}
                            isCreate={isCreate}
                          />
                        </div>
                      );
                    }

                    const isFullWidth =
                      field.type === 'string' && field.name.includes('description');
                    const relatedObj = initialRecord?.[relationKey(field)] as Record<
                      string,
                      unknown
                    > | null;

                    const effectiveField: FieldMeta = {
                      ...field,
                      readonly: isReadonly,
                      required: isRequired,
                    };

                    const contextDomain = (() => {
                      if (field.name === 'state' || field.name === 'state_id') {
                        const countryVal = formData.country_id ?? formData.country;
                        if (countryVal) {
                          return [['country_id', '=', countryVal]] as Array<
                            [string, string, unknown]
                          >;
                        }
                      }
                      if (field.name === 'bank' || field.name === 'bank_id') {
                        const countryVal = formData.country_id ?? formData.country;
                        if (countryVal) {
                          return [['country_id', '=', countryVal]] as Array<
                            [string, string, unknown]
                          >;
                        }
                      }
                      return undefined;
                    })();

                    return (
                      <div
                        key={field.name}
                        className={isFullWidth ? 'sm:col-span-2 space-y-2' : 'space-y-2'}
                      >
                        <div className="flex items-center justify-between">
                          <Label
                            htmlFor={`field-${field.name}`}
                            className="font-bold text-xs uppercase tracking-wider"
                          >
                            {field.label}
                            {isRequired && <span className="ml-1 text-destructive">*</span>}
                          </Label>
                          {isReadonly && (
                            <span className="font-mono text-[10px] uppercase text-ink-faint">
                              Readonly
                            </span>
                          )}
                        </div>

                        <FieldWidget
                          id={`field-${field.name}`}
                          field={effectiveField}
                          value={formData[field.name] ?? field.default}
                          onChange={(val) => handleChange(field.name, val)}
                          related={relatedObj}
                          contextDomain={contextDomain}
                        />

                        {field.help && <p className="text-xs text-ink-faint">{field.help}</p>}
                      </div>
                    );
                  })}
                </div>
              </TabsContent>
            );
          })}
        </Tabs>
      </form>

      {/* Audit Trail & Meta box */}
      {!isCreate && initialRecord && (
        <div className="ink-panel border-dashed bg-card/60 p-4 text-xs font-mono text-ink-muted">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-6">
              <div>
                <span className="block text-[10px] uppercase tracking-wider text-ink-faint">
                  Created At
                </span>
                <span>
                  {initialRecord.create_date
                    ? formatDateTime(String(initialRecord.create_date))
                    : '—'}
                </span>
              </div>
              <div>
                <span className="block text-[10px] uppercase tracking-wider text-ink-faint">
                  Last Modified
                </span>
                <span>
                  {initialRecord.write_date
                    ? formatDateTime(String(initialRecord.write_date))
                    : '—'}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="ink-tag text-[10px]">
                Status: {initialRecord.active !== false ? 'ACTIVE' : 'ARCHIVED'}
              </span>
              <span className="font-mono text-[10px] text-ink-faint">ID: #{recordId}</span>
            </div>
          </div>
        </div>
      )}

      {/* Unified Chatter & Activity Stream */}
      {!isCreate && recordId !== undefined && views.form?.chatter !== false && (
        <Chatter model={model} recordId={recordId} />
      )}
      <ConfirmDialog
        open={confirmAction !== null}
        title={
          confirmAction?.kind === 'back'
            ? 'Discard unsaved changes?'
            : archiveTarget?.hard
              ? 'Delete permanently?'
              : 'Archive record?'
        }
        description={
          confirmAction?.kind === 'back'
            ? 'Your local changes will be lost if you leave this record.'
            : archiveTarget?.hard
              ? 'This record will be permanently removed. This action cannot be undone.'
              : 'The record will be archived and remain recoverable.'
        }
        confirmLabel={
          confirmAction?.kind === 'back'
            ? 'Discard changes'
            : archiveTarget?.hard
              ? 'Delete permanently'
              : 'Archive'
        }
        destructive={confirmAction?.kind === 'archive'}
        busy={mutations.archive.isPending}
        onConfirm={() => {
          if (confirmAction?.kind === 'back') {
            setConfirmAction(null);
            onBack();
          } else if (archiveTarget) void handleArchive(archiveTarget.hard);
        }}
        onCancel={() => setConfirmAction(null)}
      />
      <ConfirmDialog
        open={conflict !== null}
        title="Record changed on the server"
        description="A newer version was saved after you loaded this record. Reload to review the server data before reapplying your changes."
        confirmLabel="Reload and review"
        cancelLabel="Keep local changes"
        onConfirm={() => window.location.reload()}
        onCancel={() => setConflict(null)}
      />
    </div>
  );
}
