import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { getPropertyDefinitions, type PostPropertyValue, type Membro } from '../../../store';
import { PropertyValue } from './PropertyValue';
import { PropertyDefinitionPanel } from './PropertyDefinitionPanel';

interface Props {
  templateId: number;
  postId: number;
  workflowId: number;
  propertyValues: PostPropertyValue[];
  membros: Membro[];
}

export function PropertyPanel({ templateId, postId, workflowId, propertyValues, membros }: Props) {
  const qc = useQueryClient();
  const [showPanel, setShowPanel] = useState(false);

  const { data: definitions = [] } = useQuery({
    queryKey: ['property-definitions', templateId],
    queryFn: () => getPropertyDefinitions(templateId),
  });

  if (definitions.length === 0 && !showPanel) {
    return (
      <div style={{ marginBottom: '0.75rem' }}>
        <button
          onClick={() => setShowPanel(true)}
          style={{
            background: 'none', border: '1px dashed var(--border-color, #e2e8f0)',
            borderRadius: 6, padding: '4px 10px', fontSize: '0.78rem',
            color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
          }}
        >
          <Plus className="h-3 w-3" /> Adicionar propriedade
        </button>
        {showPanel && (
          <PropertyDefinitionPanel
            templateId={templateId}
            onSave={() => {
              setShowPanel(false);
              qc.invalidateQueries({ queryKey: ['property-definitions', templateId] });
              qc.invalidateQueries({ queryKey: ['workflow-posts-with-props', workflowId] });
            }}
            onClose={() => setShowPanel(false)}
          />
        )}
      </div>
    );
  }

  return (
    <div style={{ marginBottom: '1rem' }}>
      <div style={{
        background: 'var(--card-bg-secondary, #f8fafc)',
        border: '1px solid var(--border-color, #e2e8f0)',
        borderRadius: 8, padding: '10px 12px', marginBottom: 4,
      }}>
        <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
          Propriedades
        </div>
        {definitions.map(def => {
          const pv = propertyValues.find(v => v.property_definition_id === def.id);
          return (
            <PropertyValue
              key={def.id}
              definition={def}
              value={pv?.value ?? null}
              postId={postId}
              workflowId={workflowId}
              membros={membros}
            />
          );
        })}
        <button
          onClick={() => setShowPanel(true)}
          style={{
            background: 'none', border: 'none', padding: '5px 0 0', fontSize: '0.78rem',
            color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, marginTop: 2,
          }}
        >
          <Plus className="h-3 w-3" /> Adicionar propriedade
        </button>
      </div>

      {showPanel && (
        <PropertyDefinitionPanel
          templateId={templateId}
          onSave={() => {
            setShowPanel(false);
            qc.invalidateQueries({ queryKey: ['property-definitions', templateId] });
            qc.invalidateQueries({ queryKey: ['workflow-posts-with-props', workflowId] });
          }}
          onClose={() => setShowPanel(false)}
        />
      )}
    </div>
  );
}
