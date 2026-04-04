import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useProjectStore } from '../stores/projectStore';
import { CHARACTER_COLORS, type Character } from '../types/project';

type PreviewCharacter = {
  char: Character;
  originalIndex: number;
};

const CharacterManager: React.FC = () => {
  const { project, addCharacter, updateCharacter, deleteCharacter, reorderCharacters } = useProjectStore();
  const { characters } = project;
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const dragIndexRef = useRef<number | null>(null);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

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

  const previewCharacters: PreviewCharacter[] = characters.map((char, index) => ({
    char,
    originalIndex: index,
  }));

  if (draggingIndex !== null && dragOverIndex !== null) {
    const [draggedItem] = previewCharacters.splice(draggingIndex, 1);
    previewCharacters.splice(dragOverIndex, 0, draggedItem);
  }

  useEffect(() => {
    if (draggingIndex === null) return;

    const handlePointerUp = () => {
      if (dragIndexRef.current !== null && dragOverIndex !== null && dragIndexRef.current !== dragOverIndex) {
        reorderCharacters(dragIndexRef.current, dragOverIndex);
      }
      dragIndexRef.current = null;
      setDraggingIndex(null);
      setDragOverIndex(null);
    };

    window.addEventListener('pointerup', handlePointerUp);
    return () => window.removeEventListener('pointerup', handlePointerUp);
  }, [draggingIndex, dragOverIndex, reorderCharacters]);

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
        {previewCharacters.map(({ char, originalIndex }, previewIndex) => (
          <div
            key={char.id}
            className={`char-item${draggingIndex !== null && char.id === characters[draggingIndex]?.id ? ' char-dragging char-preview-target' : ''}${draggingIndex !== null && previewIndex === dragOverIndex && char.id !== characters[draggingIndex]?.id ? ' char-drag-over' : ''}`}
            id={`char-${char.id}`}
            onPointerEnter={() => {
              if (draggingIndex !== null) {
                setDragOverIndex(previewIndex);
              }
            }}
            onPointerUp={() => {
              if (draggingIndex !== null) {
                setDragOverIndex(previewIndex);
              }
            }}
          >
            <button
              type="button"
              className="char-drag-handle"
              title="Drag to reorder"
              onPointerDown={(e) => {
                e.preventDefault();
                dragIndexRef.current = originalIndex;
                setDraggingIndex(originalIndex);
                setDragOverIndex(previewIndex);
              }}
            >
              ⠿
            </button>
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
