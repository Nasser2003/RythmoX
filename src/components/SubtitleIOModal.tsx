import React, { useState } from 'react';
import { open, save } from '@tauri-apps/plugin-dialog';
import { useProjectStore } from '../stores/projectStore';

type Mode = 'import' | 'export';

interface Props {
  mode: Mode;
  onClose: () => void;
  initialFilePath?: string;
}

const SubtitleIOModal: React.FC<Props> = ({ mode, onClose, initialFilePath }) => {
  const { project, importSubtitles, exportSubtitles } = useProjectStore();

  // Import state
  const [filePath, setFilePath] = useState(initialFilePath ?? '');
  const [extractMeta, setExtractMeta] = useState(true);

  // Export state
  const [format, setFormat] = useState<'srt' | 'ass'>('srt');
  const [includeMeta, setIncludeMeta] = useState(true);

  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pickImportFile = async () => {
    const selected = await open({
      title: 'Select a subtitle file',
      filters: [{ name: 'Subtitle Files', extensions: ['srt', 'ass'] }],
      multiple: false,
    });
    if (selected) setFilePath(selected as string);
  };

  const handleImport = async () => {
    if (!filePath) { setError('Please select a file.'); return; }
    setIsProcessing(true);
    setError(null);
    try {
      await importSubtitles(filePath, extractMeta);
      onClose();
    } catch (e: any) {
      setError(e?.toString() ?? 'Unknown error');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleExport = async () => {
    const ext = format === 'ass' ? 'ass' : 'srt';
    const outputPath = await save({
      title: `Export as ${ext.toUpperCase()}`,
      filters: [{ name: `${ext.toUpperCase()} File`, extensions: [ext] }],
      defaultPath: `${project.name}.${ext}`,
    });
    if (!outputPath) return;
    setIsProcessing(true);
    setError(null);
    try {
      await exportSubtitles(format, outputPath, includeMeta, includeMeta);
      onClose();
    } catch (e: any) {
      setError(e?.toString() ?? 'Unknown error');
    } finally {
      setIsProcessing(false);
    }
  };

  const isImport = mode === 'import';

  return (
    <div style={overlayStyle}>
      <div style={modalStyle} className="glass-card">
        {/* Header */}
        <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>
          {isImport ? '📥 Import Subtitles' : '📤 Export Subtitles'}
        </h3>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '16px' }}>

          {/* ── IMPORT ── */}
          {isImport && (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={labelStyle}>Source file</label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    readOnly
                    value={filePath}
                    placeholder="No file selected..."
                    style={inputStyle}
                  />
                  <button className="btn btn-ghost" onClick={pickImportFile} style={{ whiteSpace: 'nowrap' }}>
                    Browse…
                  </button>
                </div>
                {filePath && (
                  <span style={{ fontSize: '11px', opacity: 0.5 }}>
                    Detected format: {filePath.split('.').pop()?.toUpperCase()}
                  </span>
                )}
              </div>

              <ToggleRow
                checked={extractMeta}
                onChange={setExtractMeta}
                label="Extract roles & markers"
                description={
                  <>
                    Reads <code style={codeStyle}>[Name]</code> prefixes to auto-create characters,
                    and imports <code style={codeStyle}>MARKER:</code> entries as markers.
                    <br />
                    Example: <code style={codeStyle}>[Sonic] Hello world</code>
                  </>
                }
              />
            </>
          )}

          {/* ── EXPORT ── */}
          {!isImport && (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={labelStyle}>Format</label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {(['srt', 'ass'] as const).map(f => (
                    <button
                      key={f}
                      onClick={() => setFormat(f)}
                      style={{
                        flex: 1, padding: '8px', borderRadius: '6px', cursor: 'pointer',
                        fontSize: '13px', fontWeight: 600, border: 'none',
                        background: format === f ? 'rgba(74,222,128,0.15)' : 'rgba(255,255,255,0.05)',
                        color: format === f ? '#4ade80' : 'rgba(255,255,255,0.5)',
                        outline: format === f ? '1px solid #4ade80' : '1px solid rgba(255,255,255,0.1)',
                        transition: 'all 0.15s',
                      }}
                    >
                      <div>{f.toUpperCase()}</div>
                      <div style={{ fontSize: '10px', fontWeight: 400, opacity: 0.7, marginTop: '2px' }}>
                        {f === 'srt' ? 'Universal, simple' : 'Styles & colors'}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <ToggleRow
                checked={includeMeta}
                onChange={setIncludeMeta}
                label="Include roles & markers"
                description={
                  format === 'srt'
                    ? <>
                        Adds <code style={codeStyle}>[Name]</code> prefixes to each line, and appends
                        markers as <code style={codeStyle}>NOTE / MARKER:</code> blocks at the end.
                        <br />
                        Example: <code style={codeStyle}>[Sonic] Hello &nbsp;·&nbsp; NOTE{"\n"}MARKER: Scene 1 @ 00:01:00,000</code>
                      </>
                    : <>
                        Adds <code style={codeStyle}>[Name]</code> prefixes (the native ASS <em>Name</em> field
                        is always set), and writes markers as <code style={codeStyle}>Comment: …MARKER:</code>
                        lines visible in Aegisub.
                      </>
                }
              />
            </>
          )}

          {/* Error */}
          {error && (
            <p style={{ color: '#f87171', fontSize: '12px', margin: 0, padding: '8px', background: 'rgba(239,68,68,0.1)', borderRadius: '6px' }}>
              {error}
            </p>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: '10px', marginTop: '4px' }}>
            <button
              className="btn btn-primary"
              style={{ flex: 1 }}
              onClick={isImport ? handleImport : handleExport}
              disabled={isProcessing || (isImport && !filePath)}
            >
              {isProcessing ? '...' : isImport ? 'Import' : 'Choose destination…'}
            </button>
            <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ── Small reusable toggle row ──────────────────────────────────────────────

interface ToggleRowProps {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description: React.ReactNode;
}

const ToggleRow: React.FC<ToggleRowProps> = ({ checked, onChange, label, description }) => (
  <div
    style={{
      display: 'flex', gap: '12px', padding: '12px', borderRadius: '8px', cursor: 'pointer',
      background: checked ? 'rgba(74,222,128,0.07)' : 'rgba(255,255,255,0.03)',
      border: checked ? '1px solid rgba(74,222,128,0.25)' : '1px solid rgba(255,255,255,0.08)',
      transition: 'all 0.15s',
    }}
    onClick={() => onChange(!checked)}
  >
    {/* Checkbox */}
    <div style={{
      width: 18, height: 18, borderRadius: 4, flexShrink: 0, marginTop: 1,
      background: checked ? '#4ade80' : 'rgba(255,255,255,0.1)',
      border: checked ? 'none' : '1px solid rgba(255,255,255,0.2)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      {checked && <span style={{ fontSize: 11, color: '#000', fontWeight: 700 }}>✓</span>}
    </div>
    <div>
      <div style={{ fontWeight: 600, fontSize: '13px', color: checked ? '#4ade80' : '#fff' }}>{label}</div>
      <div style={{ fontSize: '11px', opacity: 0.55, marginTop: '3px', lineHeight: 1.5 }}>{description}</div>
    </div>
  </div>
);

// ── Styles ─────────────────────────────────────────────────────────────────

const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
};

const modalStyle: React.CSSProperties = {
  width: 440, padding: '24px', borderRadius: '12px',
  boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
};

const labelStyle: React.CSSProperties = {
  fontSize: '12px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em',
};

const inputStyle: React.CSSProperties = {
  flex: 1, background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)',
  color: '#fff', fontSize: '12px', padding: '6px 10px', borderRadius: '6px', outline: 'none',
  fontFamily: 'monospace',
};

const codeStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.1)', borderRadius: '3px', padding: '0 4px', fontSize: '11px',
};

export default SubtitleIOModal;
