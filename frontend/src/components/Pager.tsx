import React from 'react';

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

/** Small Prev / Next control for server-paginated lists. */
export default function Pager({ info, onPage }: Props) {
  if (!info || info.total === 0) return null;
  const from = (info.page - 1) * info.pageSize + 1;
  const to = Math.min(info.total, info.page * info.pageSize);
  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200 text-xs text-slate-600">
      <span>
        Showing {from}–{to} of {info.total}
      </span>
      <div className="flex gap-2">
        <button
          disabled={info.page <= 1}
          onClick={() => onPage(info.page - 1)}
          className="px-3 py-1 rounded border border-slate-300 disabled:opacity-40 hover:bg-slate-50"
        >
          Previous
        </button>
        <span className="px-1 py-1">
          Page {info.page} / {info.totalPages}
        </span>
        <button
          disabled={info.page >= info.totalPages}
          onClick={() => onPage(info.page + 1)}
          className="px-3 py-1 rounded border border-slate-300 disabled:opacity-40 hover:bg-slate-50"
        >
          Next
        </button>
      </div>
    </div>
  );
}
