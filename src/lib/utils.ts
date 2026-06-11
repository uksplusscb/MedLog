import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(date: string | Date) {
  return new Date(date).toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function normalizeMedicineName(name: string): string {
  if (!name) return '';
  const lower = name.trim().toLowerCase();
  
  if (
    lower.includes('deksametason') || 
    lower.includes('dexametason') || 
    lower.includes('dexamethasone')
  ) {
    return 'Dexametason 0,5 mg';
  }
  return name.trim();
}

