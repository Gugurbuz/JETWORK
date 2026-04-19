import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function stringToColor(str: string) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  
  // A palette of colors that look good with white text
  const colors = [
    '#2563eb', // blue-600
    '#dc2626', // red-600
    '#16a34a', // green-600
    '#d97706', // amber-600
    '#9333ea', // purple-600
    '#4f46e5', // indigo-600
    '#0891b2', // cyan-600
    '#0d9488', // teal-600
    '#be123c', // rose-600
    '#c026d3', // fuchsia-600
  ];
  
  return colors[Math.abs(hash) % colors.length];
}
