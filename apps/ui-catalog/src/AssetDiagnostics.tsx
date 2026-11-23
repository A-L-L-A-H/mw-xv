import { useState } from 'react';
import { Button } from '@moonwitness/ui/components/button';
import diagnosticReport from '../generated/asset-diagnostics.json';

type DiagnosticsReport = typeof diagnosticReport;

export function AssetDiagnostics() {
  const [report, setReport] = useState<DiagnosticsReport | null>(null);

  function exportReport() {
    if (!report) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
    );
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'moonwitness-asset-diagnostics.json';
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="asset-diagnostics" data-testid="asset-diagnostics">
      <p role="status" aria-live="polite">
        {report
          ? `Build diagnostics: ${report.assetQa.status}; scene validation: ${report.sceneValidation.status}.`
          : 'Build-time diagnostics are ready to run.'}
      </p>
      <div className="catalog-inline">
        <Button onClick={() => setReport(diagnosticReport)}>Load build diagnostics</Button>
        <Button variant="outline" disabled={!report} onClick={exportReport}>
          Export report
        </Button>
      </div>
      {report && (
        <dl className="auth-coverage-facts">
          <div>
            <dt>Manifest assets</dt>
            <dd>{report.assetQa.totalManifestAssets}</dd>
          </div>
          <div>
            <dt>Asset QA errors</dt>
            <dd>{report.assetQa.errorCount}</dd>
          </div>
          <div>
            <dt>Scene bundles validated</dt>
            <dd>{report.sceneValidation.validSceneCount}</dd>
          </div>
          <div>
            <dt>Scene validation errors</dt>
            <dd>{report.sceneValidation.errorCount}</dd>
          </div>
        </dl>
      )}
    </div>
  );
}
