import { forwardRef, type ComponentProps } from 'react';

export type InputProps = ComponentProps<'input'>;

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, ...props },
  ref
) {
  const classes = ['mw-ui-input', className].filter(Boolean).join(' ');
  return <input ref={ref} data-slot="input" className={classes} {...props} />;
});
