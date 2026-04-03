import React, { useState, useCallback } from 'react';
import { useProjectStore } from '../stores/projectStore';
import { CHARACTER_COLORS } from '../types/project';

const CharacterManager: React.FC = () => {
  const { project, addCharacter, updateCharacter, deleteCharacter } = useProjectStore();
  const { characters } = project;
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);

  const handleAdd = useCallback(() => {
    if (!newName.trim()) return;
    addCharacter(newName.trim());
    setNewName('');
  }, [newName, addCharacter]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') handleAdd();
    },
    [handleAdd]
  );

  return (
    <div className="character-manager" id="character-manager">
      <div className="editor-header">
        <h3>Characters</h3>
      </div>

      {/* Add character */}
      <div className="char-add-form">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Character name..."
          className="char-input"
          id="new-char-name"
        />
        <button
          className="btn btn-primary btn-sm"
          onClick={handleAdd}
          disabled={!newName.trim()}
          id="btn-add-char"
        >
          +
        </button>
      </div>

      {/* Character list */}
      <div className="char-list">
        {characters.map((char) => (
          <div key={char.id} className="char-item" id={`char-${char.id}`}>
            <div
              className="char-color-dot"
              style={{ background: char.color }}
              title="Click to change color"
              onClick={() => {
                const currentIdx = CHARACTER_COLORS.indexOf(char.color);
                const nextIdx = (currentIdx + 1) % CHARACTER_COLORS.length;
                updateCharacter(char.id, { color: CHARACTER_COLORS[nextIdx] });
              }}
            />
            {editingId === char.id ? (
              <input
                type="text"
                value={char.name}
                onChange={(e) => updateCharacter(char.id, { name: e.target.value })}
                onBlur={() => setEditingId(null)}
                onKeyDown={(e) => e.key === 'Enter' && setEditingId(null)}
                className="char-edit-input"
                autoFocus
              />
            ) : (
              <span
                className="char-name"
                onDoubleClick={() => setEditingId(char.id)}
                title="Double-click to edit"
              >
                {char.name}
              </span>
            )}
            <button
              className="char-delete-btn"
              onClick={() => deleteCharacter(char.id)}
              title="Delete character"
            >
              ×
            </button>
          </div>
        ))}
        {characters.length === 0 && (
          <div className="char-empty">No characters yet. Add one above.</div>
        )}
      </div>
    </div>
  );
};

export default CharacterManager;
