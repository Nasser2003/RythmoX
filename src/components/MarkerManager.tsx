import React, { useState } from 'react';
import { useProjectStore } from '../stores/projectStore';
import { CHARACTER_COLORS } from '../types/project';

const MarkerManager: React.FC = () => {
  const { project, updateMarker, deleteMarker, addMarker, currentTime } = useProjectStore();
  const markers = project.markers;

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');

  const handleEdit = (m: any) => {
    setEditingId(m.id);
    setEditLabel(m.label);
  };

  const saveEdit = (id: string) => {
    updateMarker(id, { label: editLabel });
    setEditingId(null);
  };

  const cycleColor = (m: any) => {
    const currentIndex = CHARACTER_COLORS.indexOf(m.color);
    const nextIndex = (currentIndex + 1) % CHARACTER_COLORS.length;
    updateMarker(m.id, { color: CHARACTER_COLORS[nextIndex] });
  };

  return (
    <div className="character-manager glass-card" style={{ display: 'flex', flexDirection: 'column', padding: '16px', gap: '12px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0, fontSize: '14px', color: '#e2e8f0' }}>Markers</h3>
        <button
          onClick={() => addMarker(currentTime)}
          style={{ backgroundColor: '#fbbf24', color: '#000', border: 'none', padding: '4px 10px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}
        >
          + Add Marker (M)
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', overflowY: 'auto', maxHeight: '200px' }}>
        {markers.map((m) => (
          <div key={m.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'rgba(255,255,255,0.05)', padding: '6px 12px', borderRadius: '6px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1 }}>
              <div 
                onClick={() => cycleColor(m)}
                style={{ width: '12px', height: '12px', borderRadius: '50%', backgroundColor: m.color, cursor: 'pointer', border: '1px solid rgba(255,255,255,0.2)' }} 
                title="Change color"
              />
              
              {editingId === m.id ? (
                <input
                  autoFocus
                  type="text"
                  value={editLabel}
                  onChange={(e) => setEditLabel(e.target.value)}
                  onBlur={() => saveEdit(m.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveEdit(m.id);
                    if (e.key === 'Escape') setEditingId(null);
                  }}
                  style={{ flex: 1, backgroundColor: 'transparent', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', outline: 'none', borderRadius: '2px', padding: '0 4px' }}
                />
              ) : (
                <span onDoubleClick={() => handleEdit(m)} style={{ color: '#fff', fontSize: '13px', flex: 1, cursor: 'text' }}>
                  {m.label} <span style={{ color: '#64748b', fontSize: '11px', marginLeft: '8px' }}>({m.time.toFixed(2)}s)</span>
                </span>
              )}
            </div>

            <button
              onClick={() => deleteMarker(m.id)}
              style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '14px', padding: '0 4px', opacity: 0.7 }}
              title="Delete marker"
              onMouseEnter={(e) => e.currentTarget.style.opacity = '1'}
              onMouseLeave={(e) => e.currentTarget.style.opacity = '0.7'}
            >
              ×
            </button>
          </div>
        ))}

        {markers.length === 0 && (
          <div style={{ color: '#64748b', fontSize: '12px', textAlign: 'center', padding: '16px 0' }}>
            No markers yet. Press 'M' during playback.
          </div>
        )}
      </div>
    </div>
  );
};

export default MarkerManager;
