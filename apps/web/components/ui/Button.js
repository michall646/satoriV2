// Button — accent primary / surface secondary / ghost / danger. Guard clauses, no nesting.
// Visuals live in .btn-* (app/globals.css) so hover/focus stay in CSS. docs/DESIGN_PLAN.md §1.
'use client';

const VARIANT_CLASS = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  ghost: 'btn-ghost',
  danger: 'btn-danger',
};

export default function Button({ variant = 'primary', type = 'button', disabled, className = '', ...props }) {
  const tone = VARIANT_CLASS[variant] || VARIANT_CLASS.primary;
  return <button type={type} disabled={disabled} className={`btn ${tone} focus-ring ${className}`} {...props} />;
}
