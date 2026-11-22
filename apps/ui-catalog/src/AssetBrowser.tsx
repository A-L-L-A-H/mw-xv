import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import manifestUrl from '@moonwitness/assets/manifest.json?url';
import licensesUrl from '@moonwitness/assets/licenses.json?url';
import heroDesktop from '@moonwitness/assets/illustrations/home-hero-desktop.webp';
import heroMobile from '@moonwitness/assets/illustrations/home-hero-mobile.webp';
import boardMasthead from '@moonwitness/assets/illustrations/board-masthead.webp';

type AssetRecord = {
  path: string;
  kind?: string;
  format?: string;
  pack?: string;
  subject?: string;
  domain?: string;
  variant?: string;
  status?: string;
  width?: number;
  height?: number;
  sourceAsset?: string;
  variants?: string[];
};

type InventoryFilter = 'kind' | 'pack' | 'subject' | 'domain' | 'variant' | 'status';

type ProvenanceEntry = { path: string; status?: string; license?: string };
const previewByPath: Record<string, string> = {
  'illustrations/home-hero-desktop.webp': heroDesktop,
  'illustrations/home-hero-mobile.webp': heroMobile,
  'illustrations/board-masthead.webp': boardMasthead,
};
const filters: { key: InventoryFilter; label: string }[] = [
  { key: 'kind', label: 'Category' },
  { key: 'pack', label: 'Pack' },
  { key: 'subject', label: 'Subject' },
  { key: 'domain', label: 'Domain' },
  { key: 'variant', label: 'Variant' },
  { key: 'status', label: 'Status' },
];

function valuesFor(key: InventoryFilter, assets: AssetRecord[]): string[] {
  return [...new Set(assets.map((asset) => asset[key]).filter((value): value is string => Boolean(value)))].sort();
}

export function AssetBrowser() {
  const [search, setSearch] = useState('');
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [blockedProvenance, setBlockedProvenance] = useState<Set<string>>(new Set());
  const [loadError, setLoadError] = useState(false);
  const [selected, setSelected] = useState<Record<InventoryFilter, string>>({
    kind: '', pack: '', subject: '', domain: '', variant: '', status: '',
  });
  useEffect(() => {
    let active = true;
    Promise.all([
      fetch(manifestUrl).then((response) => {
        if (!response.ok) throw new Error('The canonical asset manifest could not be loaded.');
        return response.json() as Promise<{ assets: AssetRecord[] }>;
      }),
      fetch(licensesUrl).then((response) => {
        if (!response.ok) throw new Error('Asset provenance could not be loaded.');
        return response.json() as Promise<{ sourceAssets?: ProvenanceEntry[] }>;
      }),
    ]).then(([manifest, provenance]) => {
      if (!active) return;
      setAssets(manifest.assets);
      setBlockedProvenance(new Set((provenance.sourceAssets ?? [])
        .filter((entry) => entry.status === 'blocked' || entry.license === 'unverified')
        .map((entry) => entry.path)));
    }).catch(() => {
      if (active) setLoadError(true);
    });
    return () => { active = false; };
  }, []);
  const visibleAssets = useMemo(() => assets.filter((asset) => {
    const matchesSearch = `${asset.path} ${asset.kind ?? ''} ${asset.pack ?? ''} ${asset.subject ?? ''} ${asset.domain ?? ''}`
      .toLocaleLowerCase()
      .includes(search.toLocaleLowerCase());
    return matchesSearch && filters.every(({ key }) => !selected[key] || asset[key] === selected[key]);
  }).sort((left, right) => left.path.localeCompare(right.path)), [search, selected]);

  function updateFilter(key: InventoryFilter, event: ChangeEvent<HTMLSelectElement>) {
    const value = event.currentTarget.value;
    setSelected((current) => ({ ...current, [key]: value }));
  }

  return (
    <div className="asset-browser" data-testid="asset-browser" aria-busy={assets.length === 0 && !loadError}>
      <div className="asset-browser-controls">
        <label className="asset-browser-search">
          <span>Find an asset</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
            placeholder="Search paths and tags"
          />
        </label>
        {filters.map(({ key, label }) => {
          const values = valuesFor(key, assets);
          return (
            <label key={key} className="asset-browser-filter">
              <span>{label}</span>
              <select aria-label={label} value={selected[key]} onChange={(event) => updateFilter(key, event)}>
                <option value="">All {label.toLocaleLowerCase()}s</option>
                {values.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
              {values.length === 0 && <small>No registered {label.toLocaleLowerCase()} tags</small>}
            </label>
          );
        })}
      </div>
      <p className="asset-browser-count" role="status" aria-live="polite">
        {assets.length === 0 && !loadError ? 'Loading canonical asset inventory…' : `${visibleAssets.length} of ${assets.length} canonical assets`}
      </p>
      {loadError ? (
        <p className="asset-browser-empty" role="alert">The asset inventory could not be loaded.</p>
      ) : visibleAssets.length === 0 && assets.length > 0 ? (
        <p className="asset-browser-empty">No assets match these filters.</p>
      ) : visibleAssets.length > 0 ? (
        <ul className="asset-browser-grid" aria-label="Canonical asset inventory">
          {visibleAssets.map((asset) => {
            const blocked = blockedProvenance.has(asset.path);
            return (
              <li className="asset-browser-card" key={asset.path}>
                <div className="asset-browser-preview">
                  {previewByPath[asset.path] ? (
                    <img src={previewByPath[asset.path]} alt="" loading="lazy" />
                  ) : (
                    <span aria-hidden="true">{asset.format?.toUpperCase() ?? asset.kind?.toUpperCase() ?? 'ASSET'}</span>
                  )}
                </div>
                <div className="asset-browser-details">
                  <code>{asset.path}</code>
                  <span>{[asset.kind, asset.variant, asset.width && asset.height ? `${asset.width} × ${asset.height}` : ''].filter(Boolean).join(' · ')}</span>
                  <span className={blocked ? 'asset-browser-status is-blocked' : 'asset-browser-status'}>
                    {blocked ? 'Blocked · rights review' : asset.status ?? (asset.kind === 'source' ? 'Source only' : 'Runtime asset')}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
