import type { ChangeEventHandler, ReactNode } from 'react';

export function FieldLabel({ children, required = false }: { children: ReactNode; required?: boolean }) {
  return (
    <span className="field-label">
      {required && <span className="required-mark" aria-hidden="true">*</span>} {children}{required ? '（必填）' : ''}
    </span>
  );
}

export function FieldError({ id, message }: { id?: string; message?: string }) {
  return message ? <p className="field-error" id={id} role="alert">{message}</p> : null;
}

interface CheckboxFieldProps {
  label: string;
  ariaLabel: string;
  checked: boolean;
  onChange: ChangeEventHandler<HTMLInputElement>;
}

export function CheckboxField({ label, ariaLabel, checked, onChange }: CheckboxFieldProps) {
  return (
    <label className="checkbox-field">
      <input aria-label={ariaLabel} type="checkbox" checked={checked} onChange={onChange} />
      {label}
    </label>
  );
}
