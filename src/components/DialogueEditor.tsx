import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useProjectStore } from '../stores/projectStore';
import { DEFAULT_FONTS } from '../types/project';

interface DialogueEditorProps {
  videoSync?: any; // Provided from App.tsx
}

const DialogueEditor: React.FC<DialogueEditorProps> = ({ videoSync }) => {
  const {
    project,
    addDialogue,
    updateDialogue,
    deleteDialogue,
    selectDialogue,
    selectedDialogueId,
    editingDialogueId,
    selectedCharacterId,
    addDialogueVisualCut,
  } = useProjectStore();

  const { dialogues, characters, settings } = project;

  const [openRoleMenuId, setOpenRoleMenuId] = useState<string | null>(null);
  const [roleMenuPlacement, setRoleMenuPlacement] = useState<'up' | 'down'>('up');
  const [flashId, setFlashId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const inputRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});

  // Single click on timeline block: scroll + flash only
  useEffect(() => {
    if (!selectedDialogueId) return;
    const el = itemRefs.current[selectedDialogueId];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      setFlashId(selectedDialogueId);
      const t = setTimeout(() => setFlashId(null), 700);
      return () => clearTimeout(t);
    }
  }, [selectedDialogueId]);

  // Double click on timeline block: also focus the text input
  useEffect(() => {
    if (!editingDialogueId) return;
    setTimeout(() => {
      const input = inputRefs.current[editingDialogueId];
      if (!input) return;
      input.focus();
      const textLength = input.value.length;
      input.setSelectionRange(textLength, textLength);
    }, 50);
  }, [editingDialogueId]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest('.dialogue-role-select')) {
        setOpenRoleMenuId(null);
      }
    };

    const handleCloseTransientMenus = () => {
      setOpenRoleMenuId(null);
    };

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('rythmox:close-transient-menus', handleCloseTransientMenus as EventListener);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('rythmox:close-transient-menus', handleCloseTransientMenus as EventListener);
    };
  }, []);

  const handleAdd = useCallback(() => {
    if (characters.length === 0) return;

    // Priority: selected character layer > last used role > first available
    let validCharId: string;
    if (selectedCharacterId && characters.find(c => c.id === selectedCharacterId)) {
      validCharId = selectedCharacterId;
    } else {
      const lastUse = dialogues.length > 0 ? dialogues[dialogues.length - 1].character_id : '';
      const firstUse = characters[0].id;
      validCharId = characters.find(c => c.id === lastUse) ? lastUse : firstUse;
    }

    const start = useProjectStore.getState().currentTime;
    addDialogue({
      character_id: validCharId,
      start_time: start,
      end_time: start + 2.0, // Default duration
      text: '', // Start empty, user types right away!
      symbols: [],
      font_family: settings.font_family,
      bold: false,
      underline: false,
      crossed: false,
      italic: false,
    });
  }, [characters, dialogues, settings, addDialogue, selectedCharacterId]);

  const getCharacterColor = (id: string) =>
    characters.find((c) => c.id === id)?.color || '#94a3b8';

  const resizeTextarea = (element: HTMLTextAreaElement | null) => {
    if (!element) return;
    element.style.height = '0px';
    element.style.height = `${element.scrollHeight}px`;
  };

  const getRoleMenuPlacement = (trigger: HTMLElement) => {
    const listBounds = listRef.current?.getBoundingClientRect();
    const triggerBounds = trigger.getBoundingClientRect();
    const estimatedMenuHeight = Math.min(characters.length * 36 + 20, 220);

    if (!listBounds) return 'up' as const;

    const spaceAbove = triggerBounds.top - listBounds.top;
    const spaceBelow = listBounds.bottom - triggerBounds.bottom;

    if (spaceAbove < estimatedMenuHeight && spaceBelow > spaceAbove) {
      return 'down' as const;
    }

    return 'up' as const;
  };

  return (
    <div className="dialogue-editor" id="dialogue-editor">
      <div className="editor-header">
        <h3>Dialogues</h3>
        <button
          className="btn btn-primary btn-sm"
          onClick={handleAdd}
          disabled={characters.length === 0}
          title={characters.length === 0 ? 'Add a character first' : 'Add dialogue (D)'}
          id="btn-add-dialogue"
        >
          + Add (D)
        </button>
      </div>

      {characters.length === 0 && (
        <div className="editor-hint">
          <span>💡</span> Add a character first to create dialogues
        </div>
      )}

      {/* Dialogue list inline editing */}
      <div ref={listRef} className="dialogue-list" style={{ gap: '8px', padding: '10px' }}>
        {dialogues.map((d) => (
          <div
            key={d.id}
            ref={(el) => { itemRefs.current[d.id] = el; }}
            className={`dialogue-item glass-card${flashId === d.id ? ' flash' : ''}${openRoleMenuId === d.id ? ' role-menu-open' : ''}`}
            style={{ borderLeft: `4px solid ${getCharacterColor(d.character_id)}`, padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: '6px' }}
            onClick={() => selectDialogue(d.id)}
            onDoubleClick={(e) => {
              // Focus playhead in timeline on double click
              e.stopPropagation();
              if (videoSync) videoSync.seek(d.start_time);
            }}
          >
            <div className="dialogue-top-row">
              <div className="dialogue-role-select">
                <button
                  type="button"
                  className={`dialogue-role-trigger${openRoleMenuId === d.id ? ' open' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (openRoleMenuId === d.id) {
                      setOpenRoleMenuId(null);
                      return;
                    }
                    setRoleMenuPlacement(getRoleMenuPlacement(e.currentTarget));
                    setOpenRoleMenuId(d.id);
                  }}
                  style={{
                    ['--role-color' as string]: getCharacterColor(d.character_id),
                  }}
                  title="Change role"
                >
                  <span className="dialogue-role-dot" />
                  <span className="dialogue-role-label">
                    {characters.find((c) => c.id === d.character_id)?.name || 'Role'}
                  </span>
                </button>

                {openRoleMenuId === d.id && (
                  <div className={`dialogue-role-menu glass-card${roleMenuPlacement === 'down' ? ' open-down' : ''}`}>
                    {characters.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        className={`dialogue-role-option${c.id === d.character_id ? ' selected' : ''}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          updateDialogue(d.id, { character_id: c.id });
                          setOpenRoleMenuId(null);
                        }}
                        style={{ ['--role-color' as string]: c.color }}
                      >
                        <span className="dialogue-role-dot" />
                        <span className="dialogue-role-option-name">{c.name}</span>
                        {c.id === d.character_id && <span className="dialogue-role-check">✓</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="dialogue-time-inline">
                {d.start_time.toFixed(2)}s - {d.end_time.toFixed(2)}s
              </div>

              <div className="dialogue-inline-actions">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteDialogue(d.id);
                  }}
                  style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '25px', fontWeight: 'bold', padding: 0 }}
                  title="Delete Dialogue"
                >
                  ×
                </button>
              </div>
            </div>

            <textarea
              ref={(el) => {
                inputRefs.current[d.id] = el;
                resizeTextarea(el);
              }}
              value={d.text}
              onChange={(e) => {
                updateDialogue(d.id, { text: e.target.value });
                resizeTextarea(e.target);
              }}
              onFocus={() => selectDialogue(d.id)}
              onInput={(e) => resizeTextarea(e.currentTarget)}
              onKeyDown={(e) => e.stopPropagation()}
              placeholder="Type here..."
              className="dialogue-textarea"
              rows={1}
            />

            {/* Advanced Settings inline for the active dialogue */}
            {(selectedDialogueId === d.id || editingDialogueId === d.id) && (
              <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid rgba(255,255,255,0.1)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '11px', color: '#94a3b8' }}>Font</label>
                    <select
                      className="dialogue-font-select"
                      value={d.font_family || settings.font_family}
                      onChange={(e) => updateDialogue(d.id, { font_family: e.target.value })}
                      style={{ backgroundColor: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', fontSize: '12px', padding: '4px', borderRadius: '4px' }}
                    >
                      {DEFAULT_FONTS.map((f) => <option key={f.value} value={f.value} style={{ fontFamily: f.value }}>{f.label}</option>)}
                    </select>
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '11px', color: '#94a3b8' }}>Style</label>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    {([
                      { key: 'bold',      label: 'B',  title: 'Bold',          style: { fontWeight: 'bold' as const } },
                      { key: 'italic',    label: 'I',  title: 'Italic',        style: { fontStyle: 'italic' as const } },
                      { key: 'underline', label: 'U',  title: 'Underline',     style: { textDecoration: 'underline' as const } },
                      { key: 'crossed',   label: 'S',  title: 'Strikethrough', style: { textDecoration: 'line-through' as const } },
                    ] as const).map(({ key, label, title, style }) => {
                      const active = !!(d as any)[key];
                      return (
                        <button
                          key={key}
                          title={title}
                          onClick={() => updateDialogue(d.id, { [key]: !active } as any)}
                          style={{
                            width: '28px', height: '28px',
                            borderRadius: '4px',
                            border: active ? '1px solid rgba(255,255,255,0.6)' : '1px solid rgba(255,255,255,0.15)',
                            background: active ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.2)',
                            color: active ? '#fff' : '#94a3b8',
                            cursor: 'pointer',
                            fontSize: '13px',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            ...style,
                          }}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                {/* Internal Cuts */}
                {(() => {
                  const cuts = [...(d.visual_cuts ?? [])].sort((a, b) => a.position - b.position);
                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <label style={{ fontSize: '11px', color: '#94a3b8' }}>Internal Cuts {cuts.length > 0 && <span style={{ opacity: 0.6 }}>({cuts.length})</span>}</label>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            addDialogueVisualCut(d.id, useProjectStore.getState().currentTime);
                          }}
                          style={{ fontSize: '11px', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', color: '#94a3b8', borderRadius: '4px', padding: '2px 7px', cursor: 'pointer' }}
                          title="Add cut at playhead"
                        >
                          + at playhead
                        </button>
                      </div>
                      {cuts.length === 0 ? (
                        <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.3)', padding: '2px 0' }}>No cuts</div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                          {cuts.map((cut, i) => {
                            const absTime = d.start_time + cut.position * (d.end_time - d.start_time);
                            return (
                              <div key={cut.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(0,0,0,0.15)', borderRadius: '4px', padding: '3px 8px' }}>
                                <span style={{ fontSize: '11px', color: '#cbd5e1' }}>Cut {i + 1} — {absTime.toFixed(2)}s</span>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    updateDialogue(d.id, {
                                      visual_cuts: (d.visual_cuts ?? []).filter(c => c.id !== cut.id),
                                    });
                                  }}
                                  style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '16px', padding: '0 2px', lineHeight: 1 }}
                                  title="Delete cut"
                                >
                                  ×
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default DialogueEditor;
