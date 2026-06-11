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
  const trimmed = name.trim();
  const lower = trimmed.toLowerCase();
  
  // 1. If it's literally equal to any invalid placeholder/typo, reject it (return empty string)
  if (
    lower === '5 mg' || 
    lower === '5mg' || 
    lower === '5' || 
    lower === 'mg' ||
    lower.includes('deksametason 5') ||
    lower.includes('dexametason 5') ||
    lower.includes('dexamethasone 5') ||
    lower === 'deksametason' ||
    lower === 'dexametason' ||
    lower === 'dexamethasone'
  ) {
    return '';
  }
  
  // 2. Normalize any deksametason/dexametason/dexamethasone variations to the only correct one: "Dexametason 0,5 mg"
  if (
    lower.includes('deksametason') || 
    lower.includes('dexametason') || 
    lower.includes('dexamethasone')
  ) {
    return 'Dexametason 0,5 mg';
  }
  
  return trimmed;
}

export function sanitizeMedicines<T extends { name?: string; obat?: string; stock?: number }>(list: T[]): T[] {
  if (!list || !Array.isArray(list)) return [];
  const seen = new Set<string>();
  const sanitized: T[] = [];
  
  list.forEach(item => {
    if (!item) return;
    const originalName = item.name || item.obat || '';
    const normName = normalizeMedicineName(originalName);
    if (normName) {
      const key = normName.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        sanitized.push({
          ...item,
          name: normName,
          ...(item.obat !== undefined ? { obat: normName } : {})
        });
      }
    }
  });
  
  return sanitized;
}


