import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { listPlans, createPlan, updatePlan, deletePlan, type Plan } from '../lib/api';
import { useIsPhone } from '../hooks/useIsPhone';
import { AdminFormSheet } from '../components/shell/AdminFormSheet';
import { type FormState, emptyFormState, planToForm, formToPayload } from './plan-form';
import { PLAN_FORM_ID, PlanFormFields } from './plans/PlanFormFields';
import { PlansDesktop } from './plans/PlansDesktop';
import { PlansPhone } from './plans/PlansPhone';

export default function PlansPage() {
  const queryClient = useQueryClient();
  const isPhone = useIsPhone();
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(emptyFormState);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'plans'],
    queryFn: listPlans,
  });

  const createMutation = useMutation({
    mutationFn: () => createPlan(formToPayload(form)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'plans'] });
      toast.success('Plano criado');
      closeForm();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: () => updatePlan({ plan_id: editingPlan!.id, ...formToPayload(form) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'plans'] });
      toast.success('Plano atualizado');
      closeForm();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (planId: string) => deletePlan(planId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'plans'] });
      toast.success('Plano excluído');
      closeForm();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const openCreate = () => {
    setEditingPlan(null);
    setForm(emptyFormState());
    setShowForm(true);
  };

  const openEdit = (plan: Plan) => {
    setEditingPlan(plan);
    setForm(planToForm(plan));
    setShowForm(true);
  };

  // editingPlan stays set while the sheet animates out, so its title does not flip to "Novo plano".
  const closeForm = () => setShowForm(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingPlan) updateMutation.mutate();
    else createMutation.mutate();
  };

  const plans = data?.plans ?? [];
  const canDelete = editingPlan != null && editingPlan.workspace_count === 0;

  return (
    <>
      {isPhone ? (
        <PlansPhone plans={plans} isLoading={isLoading} onCreate={openCreate} onEdit={openEdit} />
      ) : (
        <PlansDesktop plans={plans} isLoading={isLoading} onCreate={openCreate} onEdit={openEdit} />
      )}

      <AdminFormSheet
        open={showForm}
        onOpenChange={(open) => {
          if (!open) closeForm();
        }}
        title={editingPlan ? `Editar: ${editingPlan.name}` : 'Novo plano'}
        formId={PLAN_FORM_ID}
        submitLabel={editingPlan ? 'Atualizar' : 'Criar'}
        submitting={
          createMutation.isPending || updateMutation.isPending || deleteMutation.isPending
        }
        width="md"
      >
        <PlanFormFields
          form={form}
          setForm={setForm}
          onSubmit={handleSubmit}
          onDelete={canDelete ? () => deleteMutation.mutate(editingPlan.id) : undefined}
          deleting={deleteMutation.isPending}
        />
      </AdminFormSheet>
    </>
  );
}
