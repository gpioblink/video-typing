import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import {
  countDictionaryEntries,
  type DictionaryImportProgress,
  importDictionaryTsv,
  parseDictionaryTsv,
} from '../../src/lib/dictionary';
import '../../src/styles/options.css';

interface ImportPreview {
  fileName: string;
  entries: number;
  skipped: number;
}

function OptionsApp() {
  const fileTextRef = useRef('');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<DictionaryImportProgress | null>(null);

  useEffect(() => {
    void countDictionaryEntries().then(setTotal);
  }, []);

  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }

    let cancelled = false;

    file.text().then((text) => {
      if (cancelled) {
        return;
      }

      fileTextRef.current = text;
      const parsed = parseDictionaryTsv(text);
      setPreview({
        fileName: file.name,
        entries: parsed.entries.length,
        skipped: parsed.skipped,
      });
      setStatus('');
    }).catch(() => {
      if (!cancelled) {
        setPreview(null);
        setStatus('Failed to read TSV file.');
      }
    });

    return () => {
      cancelled = true;
    };
  }, [file]);

  const handleImport = async () => {
    if (!file) {
      return;
    }

    setIsImporting(true);
    setStatus('Importing...');
    setImportProgress({
      processed: 0,
      totalEntries: preview?.entries || 0,
      imported: 0,
      percent: 0,
    });

    try {
      const text = fileTextRef.current || await file.text();
      const result = await importDictionaryTsv(
        file.name,
        text,
        setImportProgress,
        preview?.entries,
        preview?.skipped,
      );
      setTotal(result.total);
      setStatus(`Imported ${result.imported} entries. Skipped ${result.skipped} lines.`);
    } catch {
      setStatus('Failed to import dictionary TSV.');
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <main className="page">
      <section className="panel">
        <header className="header">
          <div>
            <h1>Dictionary settings</h1>
            <p>Import TSV entries for typing hints.</p>
          </div>
          <div className="total">
            <span>Total entries</span>
            <strong>{total.toLocaleString()}</strong>
          </div>
        </header>

        <label className="dropzone">
          <input
            type="file"
            accept=".tsv,.txt,text/tab-separated-values,text/plain"
            onChange={(event) => setFile(event.target.files?.[0] || null)}
          />
          <span className="dropTitle">{file?.name || 'Choose TSV file'}</span>
          <span className="dropMeta">headword + tab + body</span>
        </label>

        {preview && (
          <div className="stats">
            <div>
              <span>File</span>
              <strong>{preview.fileName}</strong>
            </div>
            <div>
              <span>Valid rows</span>
              <strong>{preview.entries.toLocaleString()}</strong>
            </div>
            <div>
              <span>Skipped rows</span>
              <strong>{preview.skipped.toLocaleString()}</strong>
            </div>
          </div>
        )}

        <div className="actions">
          <button type="button" disabled={!file || isImporting} onClick={handleImport}>
            Import TSV
          </button>
          {status && <p className="status">{status}</p>}
        </div>

        {importProgress && (
          <div className="progressPanel">
            <div className="progressLabel">
              <span>Import progress</span>
              <strong>{Math.round(importProgress.percent)}%</strong>
            </div>
            <div className="progressBar" aria-hidden="true">
              <div className="progressFill" style={{ width: `${importProgress.percent}%` }} />
            </div>
            <div className="progressMeta">
              <span>
                {importProgress.processed.toLocaleString()} / {importProgress.totalEntries.toLocaleString()} processed
              </span>
              <span>{importProgress.imported.toLocaleString()} imported</span>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(<OptionsApp />);
