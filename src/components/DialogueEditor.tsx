import React, { useState, useCallback } from 'react';
import { useProjectStore } from '../stores/projectStore';
import { DEFAULT_FONTS, RYTHMO_SYMBOLS } from '../types/project';
import type { RythmoSymbol } from '../types/project';

interface DialogueEditorProps {
  videoSync?: any; // Provided from App.tsx
}

const DialogueEditor: React.FC<DialogueEditorProps> = ({ videoSync }) => {
  const {
    project,
    currentTime,
    addDialogue,
    updateDialogue,
    deleteDialogue,
  } = useProjectStore();

  const { dialogues, characters, settings } = project;

  // For inline gear settings popup
  const [openSettingsId, setOpenSettingsId] = useState<string | null>(null);

  const handleAdd = useCallback(() => {
    if (characters.length === 0) return;

    // Role selection logic: last used role or first available
    // Array might be empty, so handle carefully.
    const lastUse = dialogues.length > 0 ? dialogues[dialogues.length - 1].character_id : '';
    const firstUse = characters[0].id;
    const validCharId = characters.find(c => c.id === lastUse) ? lastUse : firstUse;

    const start = useProjectStore.getState().currentTime;
    addDialogue({
      character_id: validCharId,
      start_time: start,
      end_time: start + 2.0, // Default duration
      text: '', // Start empty, user types right away!
      symbols: [],
      font_family: settings.font_family,
      font_size: settings.font_size,
    });
  }, [characters, dialogues, settings, addDialogue]);

  const handleAddSymbol = useCallback(
    (dialogueId: string, type: RythmoSymbol['symbol_type']) => {
      const dialogue = dialogues.find(d => d.id === dialogueId);
      if (!dialogue) return;
      const newSymbol: RythmoSymbol = { symbol_type: type, time: currentTime };
      updateDialogue(dialogueId, {
        symbols: [...dialogue.symbols, newSymbol],
      });
    },
    [dialogues, currentTime, updateDialogue]
  );

  const getCharacterColor = (id: string) =>
    characters.find((c) => c.id === id)?.color || '#94a3b8';

  return (
    <div className="dialogue-editor" id="dialogue-editor">
      <div className="editor-header">
        <h3>Dialogues</h3>
        <button
          className="btn btn-primary btn-sm"
          onClick={handleAdd}
          disabled={characters.length === 0}
          title={characters.length === 0 ? 'Add a character first' : 'Add dialogue'}
          id="btn-add-dialogue"
        >
          + Add
        </button>
      </div>

      {characters.length === 0 && (
        <div className="editor-hint">
          <span>💡</span> Add a character first to create dialogues
        </div>
      )}

      {/* Dialogue list inline editing */}
      <div className="dialogue-list" style={{ gap: '8px', padding: '10px' }}>
        {dialogues.map((d) => (
          <div
            key={d.id}
            className="dialogue-item glass-card"
            style={{ borderLeft: `4px solid ${getCharacterColor(d.character_id)}`, padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: '6px' }}
            onDoubleClick={(e) => {
              // Focus playhead in timeline on double click
              e.stopPropagation();
              if (videoSync) videoSync.seek(d.start_time);
            }}
          >
            {/* Top row: Role, text, settings, delete */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', position: 'relative', paddingRight: '16px' }}>
              <select
                value={d.character_id}
                onChange={(e) => updateDialogue(d.id, { character_id: e.target.value })}
                style={{
                  backgroundColor: getCharacterColor(d.character_id),
                  color: '#000',
                  fontWeight: 'bold',
                  border: 'none',
                  borderRadius: '4px',
                  padding: '4px 6px',
                  fontSize: '11px',
                  appearance: 'none',
                  WebkitAppearance: 'none',
                  cursor: 'pointer',
                  maxWidth: '80px',
                  textAlign: 'center'
                }}
              >
                {characters.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>

              <input
                type="text"
                value={d.text}
                onChange={(e) => updateDialogue(d.id, { text: e.target.value })}
                onKeyDown={(e) => e.stopPropagation()} // Prevent timeline shortcuts
                placeholder="Type here..."
                style={{ flex: 1, backgroundColor: 'transparent', border: '1px solid transparent', color: '#e2e8f0', fontSize: '13px', outline: 'none', padding: '4px' }}
                onFocus={(e) => e.target.style.borderBottom = '1px solid rgba(255,255,255,0.2)'}
                onBlur={(e) => e.target.style.borderBottom = '1px solid transparent'}
              />

              <div style={{ position: 'absolute', right: 0, top: '100%', transform: 'translateY(-50%)', display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'center' }}>
                <button
                  onClick={() => setOpenSettingsId(openSettingsId === d.id ? null : d.id)}
                  style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '15px', padding: 0 }}
                  title="Advanced Settings"
                >
                  ⚙️
                </button>

                <button
                  onClick={() => deleteDialogue(d.id)}
                  style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '25px', fontWeight: 'bold', padding: 0 }}
                  title="Delete Dialogue"
                >
                  ×
                </button>
              </div>
            </div>

            {/* Time labels below */}
            <div style={{ fontSize: '10px', color: '#64748b' }}>
              {d.start_time.toFixed(2)}s — {d.end_time.toFixed(2)}s <span style={{ opacity: 0.5 }}>(Double-click to seek)</span>
            </div>

            {/* Advanced Settings Popup inline */}
            {openSettingsId === d.id && (
              <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid rgba(255,255,255,0.1)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '11px', color: '#94a3b8' }}>Font</label>
                    <select
                      value={d.font_family || settings.font_family}
                      onChange={(e) => updateDialogue(d.id, { font_family: e.target.value })}
                      style={{ backgroundColor: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', fontSize: '12px', padding: '4px', borderRadius: '4px' }}
                    >
                      {DEFAULT_FONTS.map((f) => <option key={f.value} value={f.value} style={{ fontFamily: f.value }}>{f.label}</option>)}
                    </select>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '11px', color: '#94a3b8' }}>Size</label>
                    <input
                      type="number"
                      value={d.font_size || settings.font_size}
                      onChange={(e) => updateDialogue(d.id, { font_size: parseFloat(e.target.value) })}
                      style={{ width: '60px', backgroundColor: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', fontSize: '12px', padding: '4px', borderRadius: '4px' }}
                    />
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '11px', color: '#94a3b8' }}>Insert Symbol (at playhead)</label>
                  <div className="symbol-palette">
                    {RYTHMO_SYMBOLS.map((sym) => (
                      <button
                        key={sym.type}
                        className="symbol-btn"
                        onClick={() => handleAddSymbol(d.id, sym.type)}
                        title={sym.label}
                      >
                        {sym.icon}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default DialogueEditor;
