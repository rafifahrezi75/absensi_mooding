import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function sleep(ms: number = 1000) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getPageNumbers(currentPage: number, totalPages: number) {
  const maxVisiblePages = 5;
  const rangeWithDots = [];

  if (totalPages <= maxVisiblePages) {
    for (let i = 1; i <= totalPages; i++) {
      rangeWithDots.push(i);
    }
  } else {
    rangeWithDots.push(1);
    if (currentPage <= 3) {
      for (let i = 2; i <= 4; i++) {
        rangeWithDots.push(i);
      }
      rangeWithDots.push('...', totalPages);
    } else if (currentPage >= totalPages - 2) {
      rangeWithDots.push('...');
      for (let i = totalPages - 3; i <= totalPages; i++) {
        rangeWithDots.push(i);
      }
    } else {
      rangeWithDots.push('...', currentPage - 1, currentPage, currentPage + 1, '...', totalPages);
    }
  }
  return rangeWithDots;
}

export function formatLateLabel(label?: string | null): string {
  if (!label) return '-';
  return label.replace(/Terlambat\s+([0-9]+(?:\.[0-9]+)?)\s*menit/gi, (_, minStr) => {
    const minFloat = parseFloat(minStr);
    const totalSeconds = Math.round(minFloat * 60);
    if (totalSeconds <= 0) return 'Terlambat 0 detik';

    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    const parts: string[] = [];
    if (hours > 0) parts.push(`${hours} jam`);
    if (minutes > 0) parts.push(`${minutes} menit`);
    if (seconds > 0 || parts.length === 0) parts.push(`${seconds} detik`);

    return `Terlambat ${parts.join(' ')}`;
  });
}
