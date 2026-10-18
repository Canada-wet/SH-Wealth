"use client";
import {
  useEffect,
  useRef,
  useId,
  type FormEvent,
  type ReactNode,
} from "react";
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
  const titleId = useId();
  const dirty = useRef(false);
  const requestClose = () => {
    if (
      !onSubmit ||
      !dirty.current ||
      window.confirm("表单有未保存修改，确定放弃并关闭？")
    )
      onClose();
  };
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
      aria-labelledby={titleId}
      className={`dialog ${wide ? "wide" : ""}`}
      onCancel={(event) => {
        event.preventDefault();
        requestClose();
      }}
      onClick={(event) => {
        if (event.target === ref.current) requestClose();
      }}
    >
      <div className="dialog-body">
        <div className="dialog-heading">
          <h2 id={titleId}>{title}</h2>
          <button
            type="button"
            className="icon-button"
            aria-label="关闭弹窗"
            onClick={requestClose}
          >
            <X size={19} />
          </button>
        </div>
        <form
          onInput={() => {
            dirty.current = true;
          }}
          onChange={() => {
            dirty.current = true;
          }}
          onClickCapture={(event) => {
            const button = (event.target as HTMLElement).closest("button");
            if (
              onSubmit &&
              button?.type === "button" &&
              button.textContent?.trim() === "取消"
            ) {
              event.preventDefault();
              event.stopPropagation();
              requestClose();
            }
          }}
          onSubmit={onSubmit ?? ((event) => event.preventDefault())}
        >
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
