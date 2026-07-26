/**
 * Minimal modal chooser — a titled list of buttons that resolves with the
 * chosen value (or null if cancelled via Cancel / Esc / backdrop click).
 *
 * UI-only: builds its own DOM, touches no app state. Used by the image-import
 * flow to ask game type and battlefield size, and (later) to confirm a detected
 * grid.
 */

export interface Choice<T> {
  label: string;
  value: T;
  /** Optional secondary line under the label. */
  sub?: string;
}

export function chooseModal<T>(
  title: string,
  choices: Choice<T>[],
  opts: { subtitle?: string; cancelable?: boolean } = {},
): Promise<T | null> {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    const modal = document.createElement("div");
    modal.className = "modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");

    const close = (v: T | null): void => {
      backdrop.remove();
      document.removeEventListener("keydown", onKey);
      resolve(v);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape" && opts.cancelable !== false) close(null);
    };

    const h = document.createElement("h2");
    h.textContent = title;
    modal.appendChild(h);
    if (opts.subtitle) {
      const p = document.createElement("p");
      p.textContent = opts.subtitle;
      modal.appendChild(p);
    }

    const list = document.createElement("div");
    list.className = "modal-choices";
    for (const c of choices) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "modal-choice";
      const label = document.createElement("span");
      label.textContent = c.label;
      b.appendChild(label);
      if (c.sub) {
        const s = document.createElement("span");
        s.className = "sub";
        s.textContent = c.sub;
        b.appendChild(s);
      }
      b.addEventListener("click", () => close(c.value));
      list.appendChild(b);
    }
    modal.appendChild(list);

    if (opts.cancelable !== false) {
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "modal-cancel";
      cancel.textContent = "Cancel";
      cancel.addEventListener("click", () => close(null));
      modal.appendChild(cancel);
    }

    document.addEventListener("keydown", onKey);
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop && opts.cancelable !== false) close(null);
    });
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
  });
}
