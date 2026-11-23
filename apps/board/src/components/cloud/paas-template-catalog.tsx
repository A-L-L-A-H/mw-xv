'use client';

import { useMemo, useState } from 'react';
import { Badge } from '@moonwitness/ui/components/badge';
import { Button } from '@moonwitness/ui/components/button';
import { Input } from '@moonwitness/ui/components/input';
import { Panel } from '@moonwitness/ui/components/panel';
import {
  PAAS_MARKETPLACE_TEMPLATES,
  type PaasTemplateCategory,
  type PaasTemplateDefinition,
} from './paas-template-data';
import { ActivityIcon, BoltIcon, CodeIcon, GlobeIcon, SignalIcon } from '@moonwitness/ui/icons';

export interface PaasTemplateCatalogProps {
  readonly templates?: readonly PaasTemplateDefinition[];
  readonly deployingTemplateId?: string | null;
  readonly onDeployTemplate: (template: PaasTemplateDefinition) => void | Promise<void>;
}

function categoryBadgeVariant(category: PaasTemplateCategory): 'primary' | 'cyan' | 'default' {
  if (category === 'Platform' || category === 'AI') return 'primary';
  if (category === 'Database' || category === 'Cache') return 'cyan';
  return 'default';
}

function renderTemplateIcon(category: PaasTemplateCategory) {
  switch (category) {
    case 'Database':
    case 'Cache':
      return <ActivityIcon className="h-4 w-4 text-primary" />;
    case 'AI':
      return <BoltIcon className="h-4 w-4 text-primary" />;
    case 'Frontend':
      return <GlobeIcon className="h-4 w-4 text-primary" />;
    case 'Backend':
      return <CodeIcon className="h-4 w-4 text-primary" />;
    case 'Platform':
      return <SignalIcon className="h-4 w-4 text-primary" />;
  }
}

export function PaasTemplateCatalog({
  templates = PAAS_MARKETPLACE_TEMPLATES,
  deployingTemplateId = null,
  onDeployTemplate,
}: PaasTemplateCatalogProps) {
  const [query, setQuery] = useState<string>('');

  const filteredTemplates = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return templates;
    return templates.filter(
      (tpl) =>
        tpl.name.toLowerCase().includes(normalized) ||
        tpl.category.toLowerCase().includes(normalized) ||
        tpl.description.toLowerCase().includes(normalized)
    );
  }, [query, templates]);

  return (
    <Panel className="space-y-4 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold tracking-tight">
            1-Click PaaS Template Marketplace
          </h3>
          <p className="text-xs text-muted-foreground">
            Deploy pre-hardened services across your private EasyTier VPS mesh.
          </p>
        </div>
        <div className="w-full sm:w-64">
          <Input
            aria-label="Filter PaaS templates"
            placeholder="Filter templates..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        {filteredTemplates.map((template) => {
          const isDeploying = deployingTemplateId === template.id;
          return (
            <Panel key={template.id} className="flex flex-col justify-between gap-3 p-4">
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {renderTemplateIcon(template.category)}
                    <span className="text-sm font-semibold">{template.name}</span>
                  </div>
                  <Badge variant={categoryBadgeVariant(template.category)}>
                    {template.category}
                  </Badge>
                </div>

                <p className="text-xs text-muted-foreground">{template.description}</p>

                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  <Badge variant="default">{template.recommendedRamMb} MB RAM</Badge>
                  <Badge variant="default">Port {template.defaultPort}</Badge>
                </div>
              </div>

              <Button
                type="button"
                variant="default"
                size="sm"
                disabled={isDeploying}
                onClick={() => {
                  void onDeployTemplate(template);
                }}
              >
                <BoltIcon className="mr-1.5 h-3.5 w-3.5" />
                {isDeploying ? 'Deploying...' : 'Deploy Template'}
              </Button>
            </Panel>
          );
        })}
      </div>
    </Panel>
  );
}
