import React from 'react';
import { Button } from './ui.js';

export interface PageInfo {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

interface Props {
  info: PageInfo | null;
  onPage: (page: number) => void;
}

/** Previous / Next control for server-paginated lists. */
export default function Pager({ info, onPage }: Props) {
  if (!info || info.total === 0) return null;
  const from = (info.page - 1) * info.pageSize + 1;
  const to = Math.min(info.total, info.page * info.pageSize);
  return (
    <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-t border-slate-200 text-xs text-slate-600">
      <span>
        {from}–{to} of {info.total.toLocaleString('en-IN')}
      </span>
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={info.page <= 1} onClick={() => onPage(info.page - 1)}>Previous</Button>
        <span>Page {info.page} of {info.totalPages}</span>
        <Button size="sm" disabled={info.page >= info.totalPages} onClick={() => onPage(info.page + 1)}>Next</Button>
      </div>
    </nav>
  );
}
