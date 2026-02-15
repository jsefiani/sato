import type { ComponentPropsWithoutRef, ElementType, ReactNode } from 'react'

type StarBorderProps<T extends ElementType = 'div'> = {
  as?: T
  color?: string
  speed?: string
  thickness?: number
  children?: ReactNode
} & ComponentPropsWithoutRef<T>

export default function StarBorder<T extends ElementType = 'div'>({
  as,
  className = '',
  color = 'hsl(220 70% 45%)',
  speed = '6s',
  thickness = 1,
  children,
  style,
  ...rest
}: StarBorderProps<T>) {
  const Component = as || 'div'

  return (
    <Component
      className={`star-border-container ${className}`}
      style={{ padding: `${thickness}px 0`, ...style }}
      {...rest}
    >
      <div
        className="border-gradient-bottom"
        style={{
          background: `radial-gradient(circle, ${color}, transparent 4%)`,
          animationDuration: speed,
        }}
      />
      <div
        className="border-gradient-top"
        style={{
          background: `radial-gradient(circle, ${color}, transparent 4%)`,
          animationDuration: speed,
        }}
      />
      <div className="inner-content">{children}</div>
    </Component>
  )
}
