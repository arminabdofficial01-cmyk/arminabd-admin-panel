import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

export interface Column<T> {
  key: string;
  label: string;
  render?: (row: T) => React.ReactNode;
  hideOnMobile?: boolean;
  className?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  page?: number;
  pageSize?: number;
  total?: number;
  onPageChange?: (page: number) => void;
  emptyMessage?: string;
  loading?: boolean;
}

function isActionColumn<T>(col: Column<T>) {
  return col.key === "actions" || col.key === "action";
}

function Pagination({
  page,
  totalPages,
  total,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-muted-foreground text-center sm:text-left">
        Page {page} of {totalPages} ({total} total)
      </p>
      <div className="flex justify-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function MobileDataCard<T extends { id?: string | number }>({
  row,
  columns,
}: {
  row: T;
  columns: Column<T>[];
}) {
  const actionColumns = columns.filter(isActionColumn);
  const fieldColumns = columns.filter(
    (col) => !isActionColumn(col) && !col.hideOnMobile
  );

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      {fieldColumns.map((col) => (
        <div key={col.key} className="flex items-start justify-between gap-3 text-sm">
          <span className="text-muted-foreground shrink-0">{col.label}</span>
          <div className="text-right min-w-0 break-words">
            {col.render ? col.render(row) : String(row[col.key as keyof T] ?? "")}
          </div>
        </div>
      ))}
      {actionColumns.length > 0 && (
        <div className="flex flex-wrap justify-end gap-1 pt-2 border-t">
          {actionColumns.map((col) => (
            <div key={col.key}>
              {col.render ? col.render(row) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function DataTable<T extends { id?: string | number }>({
  columns,
  data,
  page = 1,
  pageSize = 10,
  total = 0,
  onPageChange,
  emptyMessage = "No data found.",
  loading = false,
}: DataTableProps<T>) {
  const isMobile = useIsMobile();
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const showPagination = Boolean(onPageChange && total > pageSize);

  if (isMobile) {
    return (
      <div className="space-y-4">
        {loading ? (
          <div className="rounded-lg border p-8 text-center text-muted-foreground">
            Loading...
          </div>
        ) : data.length === 0 ? (
          <div className="rounded-lg border p-8 text-center text-muted-foreground">
            {emptyMessage}
          </div>
        ) : (
          <div className="space-y-3">
            {data.map((row, i) => (
              <MobileDataCard key={row.id ?? i} row={row} columns={columns} />
            ))}
          </div>
        )}
        {showPagination && onPageChange && (
          <Pagination
            page={page}
            totalPages={totalPages}
            total={total}
            onPageChange={onPageChange}
          />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md border overflow-x-auto">
        <Table className="min-w-[720px]">
          <TableHeader>
            <TableRow>
              {columns.map((col) => (
                <TableHead
                  key={col.key}
                  className={cn(col.hideOnMobile && "hidden lg:table-cell", col.className)}
                >
                  {col.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center text-muted-foreground">
                  Loading...
                </TableCell>
              </TableRow>
            ) : data.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center text-muted-foreground">
                  {emptyMessage}
                </TableCell>
              </TableRow>
            ) : (
              data.map((row, i) => (
                <TableRow key={row.id ?? i}>
                  {columns.map((col) => (
                    <TableCell
                      key={col.key}
                      className={cn(col.hideOnMobile && "hidden lg:table-cell", col.className)}
                    >
                      {col.render ? col.render(row) : String(row[col.key as keyof T] ?? "")}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      {showPagination && onPageChange && (
        <Pagination
          page={page}
          totalPages={totalPages}
          total={total}
          onPageChange={onPageChange}
        />
      )}
    </div>
  );
}
