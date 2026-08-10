import React from 'react';
import { cn } from '../lib/utils';

const JETWORK_OUTER = '#FFC107';
const JETWORK_INNER = '#FF9800';

interface JetWorkLogoProps {
  className?: string;
  isSpinning?: boolean;
  isColorSwapping?: boolean;
  color?: string;
  innerColor?: string;
  centerColor?: string;
}

export const JetWorkLogo = ({
  className,
  isSpinning,
  isColorSwapping,
  color,
  innerColor,
  centerColor,
}: JetWorkLogoProps) => {
  const outerFill = color || JETWORK_OUTER;
  const middleFill = innerColor || 'var(--theme-surface)';
  const centerFill = centerColor || (color ? color : JETWORK_INNER);

  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="JetWork"
      className={cn('shrink-0', className, isSpinning && 'animate-spin')}
    >
      <rect width="32" height="32" rx="7" fill={outerFill} className={cn(isColorSwapping && 'animate-swap-black')} />
      <rect x="8" y="8" width="16" height="16" rx="2" fill={middleFill} className={cn(isColorSwapping && 'animate-swap-white')} />
      <rect x="12" y="12" width="8" height="8" rx="1" fill={centerFill} className={cn(isColorSwapping && 'animate-swap-black')} />
    </svg>
  );
};
