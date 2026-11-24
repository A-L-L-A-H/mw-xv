import {
  cloneElement,
  forwardRef,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
} from 'react';

type DescribedControlProps = {
  id?: string;
  required?: boolean;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean | 'true' | 'false';
  'aria-required'?: boolean | 'true' | 'false';
};

export type FieldProps = Omit<ComponentProps<'div'>, 'children'> & {
  label: ReactNode;
  htmlFor: string;
  description?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  children: ReactElement<DescribedControlProps>;
};

export const Field = forwardRef<HTMLDivElement, FieldProps>(function Field(
  { label, htmlFor, description, error, required = false, children, className, ...props },
  ref
) {
  const descriptionId = description ? `${htmlFor}-description` : undefined;
  const errorId = error ? `${htmlFor}-error` : undefined;
  const describedBy = [descriptionId, errorId].filter(Boolean).join(' ') || undefined;
  const childProps = children.props as DescribedControlProps;
  const control = cloneElement(children, {
    id: htmlFor,
    required: required || childProps.required,
    'aria-describedby':
      [childProps['aria-describedby'], describedBy].filter(Boolean).join(' ') || undefined,
    'aria-invalid': error ? true : childProps['aria-invalid'],
    'aria-required': required ? true : childProps['aria-required'],
  });

  return (
    <div ref={ref} className={['mw-ui-field', className].filter(Boolean).join(' ')} {...props}>
      <label className="mw-ui-field-label" htmlFor={htmlFor}>
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </label>
      {control}
      {description ? (
        <div className="mw-ui-field-description" id={descriptionId}>
          {description}
        </div>
      ) : null}
      {error ? (
        <div className="mw-ui-field-error" id={errorId} role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
});
