import * as React from "react";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/**
 * DataTable — Zenin's TanStack-backed table primitive (Brand System v2).
 *
 * Wraps @tanstack/react-table with Zenin's monochrome table primitives and
 * optional TanStack Virtual integration for long lists. API is intentionally
 * close to the legacy AnalyticsModule DataTable (columns/rows/onRowClick) so
 * migration of the 54 call-sites is mechanical.
 *
 * Column shape:
 *   {
 *     key,                       // unique id
 *     header,                    // string or () => ReactNode
 *     cell?,                     // (row) => ReactNode  (overrides value)
 *     sortValue?,                // (row) => number|string for sorting
 *     align?,                    // 'left' | 'right' | 'center'
 *     sortable?,                 // default true
 *     className?,                // header + cell class
 *   }
 *
 * Props:
 *   columns, data, getRowId?, onRowClick?, virtual?, rowHeight?,
 *   pageSize?, emptyState?, className?
 */

const ALIGN_CLASS = {
  left: "text-left",
  right: "text-right",
  center: "text-center",
};

export function DataTable({
  columns,
  data = [],
  getRowId,
  onRowClick,
  getRowClassName,
  getRowTitle,
  virtual: virtualEnabled = false,
  rowHeight = 40,
  pageSize = 0, // 0 = no pagination
  emptyState,
  className,
}) {
  const [sorting, setSorting] = React.useState([]);

  // Translate Zenin column shape → TanStack column defs.
  const tableColumns = React.useMemo(
    () =>
      (columns || []).map((col) => ({
        id: col.key,
        accessorFn: col.sortValue
          ? (row) => col.sortValue(row)
          : (row) => row?.[col.key],
        header: col.header,
        cell: ({ row }) =>
          col.cell ? col.cell(row.original) : (row.original?.[col.key] ?? "—"),
        enableSorting: col.sortable !== false,
        meta: { align: col.align || "left", className: col.className },
      })),
    [columns]
  );

  const table = useReactTable({
    data,
    columns: tableColumns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    ...(pageSize > 0 ? { getPaginationRowModel: getPaginationRowModel() } : {}),
    ...(pageSize > 0 ? { initialState: { pagination: { pageSize } } } : {}),
    getRowId,
  });

  const { rows } = table.getRowModel();

  // Virtualization for long lists.
  const parentRef = React.useRef(null);
  const rowVirtualizer = useVirtualizer({
    enabled: virtualEnabled,
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: 12,
  });
  const virtualRows = virtualEnabled ? rowVirtualizer.getVirtualItems() : null;
  const totalHeight = virtualEnabled ? rowVirtualizer.getTotalSize() : 0;

  if (!data.length) {
    return (
      emptyState || (
        <div className="flex min-h-[160px] items-center justify-center rounded-[var(--radius)] border border-[var(--color-border-default)] bg-[var(--color-surface-card)] p-8 text-center text-[var(--fs-sm)] text-[color:var(--color-text-muted)]">
          No data available
        </div>
      )
    );
  }

  const renderHeader = (header) => {
    const align = header.column.columnDef.meta?.align || "left";
    const isSorted = header.column.getIsSorted();
    return (
      <TableHead
        key={header.id}
        className={cn(
          ALIGN_CLASS[align],
          header.column.columnDef.meta?.className
        )}
      >
        {header.column.getCanSort() ? (
          <button
            type="button"
            onClick={header.column.getToggleSortingHandler()}
            className="inline-flex items-center gap-1 uppercase tracking-wide transition-opacity hover:opacity-80"
          >
            {flexRender(header.column.columnDef.header, header.getContext())}
            <SortIcon dir={isSorted} />
          </button>
        ) : (
          flexRender(header.column.columnDef.header, header.getContext())
        )}
      </TableHead>
    );
  };

  const renderRow = (row, virtualStyle) => (
    <TableRow
      key={row.id}
      data-state={onRowClick ? "interactive" : undefined}
      onClick={onRowClick ? () => onRowClick(row.original) : undefined}
      title={getRowTitle ? getRowTitle(row.original) : undefined}
      style={virtualStyle}
      className={cn(
        onRowClick &&
          "cursor-pointer focus-visible:bg-[var(--color-selected)]",
        getRowClassName ? getRowClassName(row.original) : undefined
      )}
    >
      {row.getVisibleCells().map((cell) => (
        <TableCell
          key={cell.column.id}
          className={cn(
            ALIGN_CLASS[cell.column.columnDef.meta?.align || "left"],
            cell.column.columnDef.meta?.className
          )}
        >
          {flexRender(cell.column.columnDef.cell, cell.getContext())}
        </TableCell>
      ))}
    </TableRow>
  );

  return (
    <div
      ref={parentRef}
      className={cn(
        "relative w-full overflow-auto rounded-[var(--radius)] border border-[var(--color-border-default)] bg-[var(--color-surface-card)]",
        virtualEnabled && "max-h-[600px]",
        className
      )}
    >
      <Table>
        <TableHeader className="sticky top-0 z-10 bg-[var(--color-surface-card)]">
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>{hg.headers.map(renderHeader)}</tr>
          ))}
        </TableHeader>
        <TableBody>
          {virtualEnabled && virtualRows ? (
            <>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} className="p-8 text-center text-[color:var(--color-text-muted)]">
                    No rows
                  </td>
                </tr>
              ) : (
                virtualRows.map((vr) => {
                  const row = rows[vr.index];
                  return renderRow(row, {
                    height: `${vr.size}px`,
                    transform: `translateY(${vr.start}px)`,
                  });
                })
              )}
              {/* Spacer to give the virtual container its full scroll height. */}
              {totalHeight > 0 && (
                <tr style={{ height: `${totalHeight}px` }} aria-hidden />
              )}
            </>
          ) : (
            table.getRowModel().rows.map((row) => renderRow(row))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function SortIcon({ dir }) {
  if (dir === "asc") return <ChevronUp className="h-3 w-3" />;
  if (dir === "desc") return <ChevronDown className="h-3 w-3" />;
  return <ChevronsUpDown className="h-3 w-3 opacity-40" />;
}

export default DataTable;
