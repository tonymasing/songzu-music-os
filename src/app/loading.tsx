import { LoaderCircle } from "lucide-react";

export default function Loading() {
  return (
    <section className="workspace-loading" aria-live="polite" aria-busy="true">
      <div className="workspace-loading-heading">
        <LoaderCircle size={20} aria-hidden="true" />
        <span>
          <strong>正在整理工作台</strong>
          <small>讀取本機資料與檔案狀態</small>
        </span>
      </div>
      <div className="workspace-loading-grid" aria-hidden="true">
        <span className="skeleton-block wide" />
        <span className="skeleton-block" />
        <span className="skeleton-block" />
        <span className="skeleton-block tall" />
        <span className="skeleton-block tall" />
      </div>
    </section>
  );
}
