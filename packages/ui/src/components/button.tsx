import { Slot } from 'radix-ui';
import {
  Children,
  cloneElement,
  forwardRef,
  isValidElement,
  type ComponentProps,
  type ForwardedRef,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
  type Ref,
} from 'react';
import { composeRefs } from '../lib/compose-refs.js';

export type ButtonVariant =
  'default' | 'magenta' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link';
export type ButtonSize =
  'default' | 'xs' | 'sm' | 'lg' | 'icon' | 'icon-xs' | 'icon-sm' | 'icon-lg';
export type ButtonTreatment = 'solid' | 'brush';

export type ButtonProps = ComponentProps<'button'> & {
  asChild?: boolean;
  size?: ButtonSize;
  variant?: ButtonVariant;
  treatment?: ButtonTreatment;
};

type ButtonChildProps = Record<string, unknown> & { ref?: Ref<HTMLButtonElement> };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    asChild = false,
    className,
    children,
    disabled = false,
    onClick,
    onKeyDown,
    size = 'default',
    variant = 'default',
    treatment = 'solid',
    ...props
  },
  ref: ForwardedRef<HTMLButtonElement>
) {
  const Component = asChild ? Slot.Root : 'button';
  const classes = ['mw-ui-button', className].filter(Boolean).join(' ');

  if (asChild && disabled) {
    const child = Children.only(children);
    if (!isValidElement(child)) {
      throw new Error('Button with asChild and disabled requires one valid child element.');
    }

    const childProps = child.props as { className?: string };
    const childRef = (child as unknown as { ref?: Ref<HTMLButtonElement> }).ref;
    const cloneProps: ButtonChildProps = {
      ...props,
      ref: composeRefs(ref, childRef),
      'aria-disabled': true,
      onClick: (event: MouseEvent<HTMLElement>) => {
        event.preventDefault();
        event.stopPropagation();
      },
      onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          event.stopPropagation();
        }
      },
      className: [childProps.className, classes].filter(Boolean).join(' '),
      'data-slot': 'button',
      'data-size': size,
      'data-treatment': treatment,
      'data-variant': variant,
    };
    return cloneElement(child as ReactElement<ButtonChildProps>, cloneProps);
  }

  return (
    <Component
      ref={ref}
      data-slot="button"
      data-size={size}
      data-treatment={treatment}
      data-variant={variant}
      className={classes}
      disabled={disabled}
      onClick={onClick}
      onKeyDown={onKeyDown}
      {...props}
    >
      {children}
    </Component>
  );
});
