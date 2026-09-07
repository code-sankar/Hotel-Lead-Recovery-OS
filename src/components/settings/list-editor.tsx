'use client';

import { useState, useTransition, type ReactNode } from 'react';
import { Pencil, Plus, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Shared shell for the room / policy / FAQ editors: a list of saved records
 * with inline edit, plus one "add new" form.
 */
export function ListEditor<T extends { id: string }>({
  items,
  renderSummary,
  renderForm,
  onDelete,
  addLabel,
  emptyLabel,
}: {
  items: T[];
  renderSummary: (item: T) => ReactNode;
  renderForm: (item: T | null, onDone: () => void) => ReactNode;
  onDelete: (id: string) => Promise<void>;
  addLabel: string;
  emptyLabel: string;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [pendingDelete, startDelete] = useTransition();

  return (
    <div className="flex flex-col gap-3">
      {items.length === 0 && !adding ? (
        <p className="rounded-md border border-dashed border-ink-300 px-4 py-6 text-center text-[13px] text-ink-500">
          {emptyLabel}
        </p>
      ) : null}

      {items.map((item) => (
        <div key={item.id} className="rounded-md border border-ink-200">
          {editingId === item.id ? (
            <div className="px-4 py-4">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-[13px] font-medium text-ink-700">Editing</p>
                <Button variant="ghost" size="sm" onClick={() => setEditingId(null)} type="button">
                  <X className="size-4" />
                  Cancel
                </Button>
              </div>
              {renderForm(item, () => setEditingId(null))}
            </div>
          ) : (
            <div className="flex items-start justify-between gap-4 px-4 py-3">
              <div className="min-w-0 flex-1">{renderSummary(item)}</div>
              <div className="flex shrink-0 items-center gap-1">
                <Button variant="ghost" size="sm" type="button" onClick={() => setEditingId(item.id)}>
                  <Pencil className="size-3.5" />
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  disabled={pendingDelete}
                  onClick={() => startDelete(async () => onDelete(item.id))}
                  className="text-hot-600 hover:bg-hot-50 hover:text-hot-700"
                >
                  <Trash2 className="size-3.5" />
                  <span className="sr-only">Delete</span>
                </Button>
              </div>
            </div>
          )}
        </div>
      ))}

      {adding ? (
        <div className="rounded-md border border-accent-200 bg-accent-50/40 px-4 py-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-[13px] font-medium text-ink-700">{addLabel}</p>
            <Button variant="ghost" size="sm" type="button" onClick={() => setAdding(false)}>
              <X className="size-4" />
              Cancel
            </Button>
          </div>
          {renderForm(null, () => setAdding(false))}
        </div>
      ) : (
        <Button variant="secondary" size="sm" type="button" onClick={() => setAdding(true)} className="self-start">
          <Plus className="size-4" />
          {addLabel}
        </Button>
      )}
    </div>
  );
}
