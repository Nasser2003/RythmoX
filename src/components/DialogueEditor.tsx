import React, { useState, useCallback } from 'react';
import { useProjectStore } from '../stores/projectStore';
import { DEFAULT_FONTS, RYTHMO_SYMBOLS } from '../types/project';
import type { RythmoSymbol } from '../types/project';

const DialogueEditor: React.FC = () => {
  const {
    project,
    selectedDialogueId,
    currentTime,
    addDialogue,
    updateDialogue,
    deleteDialogue,
    selectDialogue,
  } = useProjectStore();

  const { dialogues, characters, settings } = project;
  const selectedDialogue = dialogues.find((d) => d.id === selectedDialogueId);
  const [isAdding, setIsAdding] = useState(false);

  // New dialogue form state
  const [newText, setNewText] = useState('');
  const [newCharId, setNewCharId] = useState('');
  const [newStart, setNewStart] = useState(0);
  const [newEnd, setNewEnd] = useState(0);

  const handleAdd = useCallback(() => {
    setIsAdding(true);
    setNewStart(currentTime);
    setNewEnd(currentTime + 3);
    setNewText('');
    setNewCharId(characters[0]?.id || '');
  }, [currentTime, characters]);

  const handleConfirmAdd = useCallback(() => {
    if (!newText.trim() || !newCharId) return;
    addDialogue({
      character_id: newCharId,
      start_time: newStart,
      end_time: newEnd,
      text: newText,
      detection: '',
      symbols: [],
      font_family: settings.font_family,
      font_size: settings.font_size,
    });
    setIsAdding(false);
  }, [newText, newCharId, newStart, newEnd, settings, addDialogue]);

  const handleAddSymbol = useCallback(
    (type: RythmoSymbol['symbol_type']) => {
      if (!selectedDialogue) return;
      const newSymbol: RythmoSymbol = { symbol_type: type, time: currentTime };
      updateDialogue(selectedDialogue.id, {
        symbols: [...selectedDialogue.symbols, newSymbol],
      });
    },
    [selectedDialogue, currentTime, updateDialogue]
  );

  const getCharacterName = (id: string) =>
    characters.find((c) => c.id === id)?.name || 'Unknown';
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

      {/* New dialogue form */}
      {isAdding && (
        <div className="dialogue-form glass-card">
          <div className="form-row">
            <label>Character</label>
            <select value={newCharId} onChange={(e) => setNewCharId(e.target.value)} id="new-dialogue-char">
              {characters.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div className="form-row">
            <label>Text</label>
            <textarea
              value={newText}
              onChange={(e) => setNewText(e.target.value)}
              placeholder="Enter dialogue text..."
              rows={2}
              id="new-dialogue-text"
            />
          </div>
          <div className="form-row form-row-split">
            <div>
              <label>Start (s)</label>
              <input
                type="number"
                step="0.1"
                value={newStart}
                onChange={(e) => setNewStart(parseFloat(e.target.value))}
                id="new-dialogue-start"
              />
            </div>
            <div>
              <label>End (s)</label>
              <input
                type="number"
                step="0.1"
                value={newEnd}
                onChange={(e) => setNewEnd(parseFloat(e.target.value))}
                id="new-dialogue-end"
              />
            </div>
          </div>
          <div className="form-actions">
            <button className="btn btn-primary btn-sm" onClick={handleConfirmAdd} id="btn-confirm-add">
              ✓ Confirm
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setIsAdding(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Dialogue list */}
      <div className="dialogue-list">
        {dialogues.map((d) => (
          <div
            key={d.id}
            className={`dialogue-item ${d.id === selectedDialogueId ? 'selected' : ''}`}
            onClick={() => selectDialogue(d.id)}
            style={{ borderLeftColor: getCharacterColor(d.character_id) }}
            id={`dialogue-${d.id}`}
          >
            <div className="dialogue-item-header">
              <span
                className="dialogue-char-badge"
                style={{ background: getCharacterColor(d.character_id) }}
              >
                {getCharacterName(d.character_id)}
              </span>
              <span className="dialogue-time">
                {d.start_time.toFixed(1)}s — {d.end_time.toFixed(1)}s
              </span>
            </div>
            <div className="dialogue-item-text">{d.text || '(empty)'}</div>
          </div>
        ))}
      </div>

      {/* Selected dialogue editor */}
      {selectedDialogue && (
        <div className="dialogue-detail glass-card">
          <h4>Edit Dialogue</h4>
          <div className="form-row">
            <label>Character</label>
            <select
              value={selectedDialogue.character_id}
              onChange={(e) => updateDialogue(selectedDialogue.id, { character_id: e.target.value })}
              id="edit-dialogue-char"
            >
              {characters.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div className="form-row">
            <label>Text</label>
            <textarea
              value={selectedDialogue.text}
              onChange={(e) => updateDialogue(selectedDialogue.id, { text: e.target.value })}
              rows={3}
              id="edit-dialogue-text"
            />
          </div>
          <div className="form-row">
            <label>Detection</label>
            <textarea
              value={selectedDialogue.detection}
              onChange={(e) => updateDialogue(selectedDialogue.id, { detection: e.target.value })}
              rows={2}
              placeholder="Lip detection notation..."
              className="detection-input"
              id="edit-dialogue-detection"
            />
          </div>
          <div className="form-row form-row-split">
            <div>
              <label>Start (s)</label>
              <input
                type="number"
                step="0.1"
                value={selectedDialogue.start_time}
                onChange={(e) => updateDialogue(selectedDialogue.id, { start_time: parseFloat(e.target.value) })}
                id="edit-dialogue-start"
              />
            </div>
            <div>
              <label>End (s)</label>
              <input
                type="number"
                step="0.1"
                value={selectedDialogue.end_time}
                onChange={(e) => updateDialogue(selectedDialogue.id, { end_time: parseFloat(e.target.value) })}
                id="edit-dialogue-end"
              />
            </div>
          </div>

          {/* Font controls */}
          <div className="form-row form-row-split">
            <div>
              <label>Font</label>
              <select
                value={selectedDialogue.font_family || settings.font_family}
                onChange={(e) => updateDialogue(selectedDialogue.id, { font_family: e.target.value })}
                id="edit-dialogue-font"
              >
                {DEFAULT_FONTS.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
            </div>
            <div>
              <label>Size</label>
              <input
                type="number"
                min={10}
                max={48}
                value={selectedDialogue.font_size || settings.font_size}
                onChange={(e) => updateDialogue(selectedDialogue.id, { font_size: parseFloat(e.target.value) })}
                id="edit-dialogue-fontsize"
              />
            </div>
          </div>

          {/* Rythmo symbols */}
          <div className="form-row">
            <label>Add Symbol at Current Time</label>
            <div className="symbol-palette">
              {RYTHMO_SYMBOLS.map((sym) => (
                <button
                  key={sym.type}
                  className="symbol-btn"
                  onClick={() => handleAddSymbol(sym.type)}
                  title={sym.label}
                  id={`sym-${sym.type}`}
                >
                  {sym.icon}
                </button>
              ))}
            </div>
          </div>

          <div className="form-actions">
            <button
              className="btn btn-danger btn-sm"
              onClick={() => deleteDialogue(selectedDialogue.id)}
              id="btn-delete-dialogue"
            >
              🗑 Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default DialogueEditor;
