"use client";
import { useEffect, useRef, type FormEvent, type ReactNode } from "react";
import { X } from "lucide-react";
export default function Dialog({
  title,
  children,
  onClose,
  onSubmit,
  error,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  onSubmit?: (event: FormEvent) => void;
  error?: string;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    const previous = document.activeElement as HTMLElement;
    dialog.showModal();
    return () => {
      dialog.close();
      previous?.focus?.();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`dialog ${wide ? "wide" : ""}`}
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
    >
      <div className="dialog-body">
        <div className="dialog-heading">
          <h2>{title}</h2>
          <button
            type="button"
            className="icon-button"
            aria-label="关闭弹窗"
            onClick={onClose}
          >
            <X size={19} />
          </button>
        </div>
        <form onSubmit={onSubmit ?? ((event) => event.preventDefault())}>
          {children}
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
        </form>
      </div>
    </dialog>
  );
}
