import React from 'react';

interface BrandTitleProps {
  className?: string;
}

export const BrandTitle: React.FC<BrandTitleProps> = ({ className = 'text-xl' }) => {
  return (
    <span
      dir="ltr"
      className={`font-display inline-flex items-baseline font-black tracking-tight select-none ${className}`}
      aria-label="Crm"
    >
      <span className="text-[#0F4C81] dark:text-sky-400">C</span>
      <span className="text-emerald-600 dark:text-emerald-400">r</span>
      <span className="text-amber-500 dark:text-amber-400">m</span>
    </span>
  );
};
