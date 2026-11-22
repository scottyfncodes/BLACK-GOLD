import { useEffect, useRef, useState } from "preact/hooks";
import { formatDate, randomSeed, type GameRuntime, type Snapshot } from "../app/runtime";
import { isSeed } from "../sim";

interface Props {
  runtime: GameRuntime;
  snap: Snapshot;
  open: boolean;
  onClose: () => void;
}

export function CampaignMenu({ runtime, snap, open, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [seedText, setSeedText] = useState("");
  const [confirmingNew, setConfirmingNew] = useState(false);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) {
      runtime.setSpeed("paused");
      d.showModal();
    }
    if (!open && d.open) d.close();
    if (!open) setConfirmingNew(false);
  }, [open, runtime]);

  const seedInput = seedText.trim().toLowerCase();
  const seedValid = seedInput === "" || isSeed(seedInput);

  const startNew = async () => {
    if (!confirmingNew) {
      setConfirmingNew(true);
      return;
    }
    await runtime.newCampaign(seedInput === "" ? randomSeed() : seedInput);
    setSeedText("");
    onClose();
  };

  const exportSave = async () => {
    const { name, blob } = await runtime.exportFile();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const importSave = async (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (file && (await runtime.importFile(file))) onClose();
  };

  return (
    <dialog ref={dialog} class="sheet" aria-labelledby="campaign-title" onClose={onClose} onClick={(e) => e.target === dialog.current && onClose()}>
      <div class="sheet-body">
        <header class="sheet-head">
          <h2 id="campaign-title">Campaign</h2>
          <button type="button" class="button button-quiet" onClick={onClose}>
            Close
          </button>
        </header>

        <section class="sheet-section" aria-labelledby="world-h">
          <h3 id="world-h">This world</h3>
          <p class="meta">
            {formatDate(snap.time, "long")}
            <br />
            World seed <code data-testid="seed">{snap.seed}</code>
          </p>
          <div class="row">
            <button type="button" class="button button-primary" disabled={snap.busy} onClick={() => void runtime.saveManual()}>
              Save now
            </button>
            <button type="button" class="button" disabled={snap.busy} onClick={() => void exportSave()}>
              Export file
            </button>
            <button type="button" class="button" disabled={snap.busy} onClick={() => fileInput.current?.click()}>
              Import file
            </button>
            <input ref={fileInput} type="file" accept=".blackgold,application/gzip" hidden onChange={importSave} />
          </div>
        </section>

        <section class="sheet-section" aria-labelledby="saves-h">
          <h3 id="saves-h">Saves</h3>
          {snap.saves.length === 0 ? (
            <p class="meta">No saves yet. The game autosaves at the start of every month.</p>
          ) : (
            <ul class="saves">
              {snap.saves.map((s) => (
                <li key={s.id} class="save">
                  <div class="save-text">
                    <span class="save-date">{formatDate(s.gameTime)}</span>
                    <span class="meta">
                      {s.kind === "auto" ? "Autosave" : "Saved"} · {new Date(s.savedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                      {s.seed !== snap.seed ? " · other world" : ""}
                    </span>
                  </div>
                  <div class="row">
                    <button
                      type="button"
                      class="button"
                      disabled={snap.busy}
                      onClick={async () => {
                        if (await runtime.loadSlot(s.id)) onClose();
                      }}
                    >
                      Load
                    </button>
                    <button type="button" class="button button-quiet" aria-label={`Delete save from ${formatDate(s.gameTime)}`} onClick={() => void runtime.deleteSlot(s.id)}>
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section class="sheet-section" aria-labelledby="new-h">
          <h3 id="new-h">New campaign</h3>
          <label class="field">
            <span>World seed (optional, 16 hex digits)</span>
            <input
              type="text"
              inputMode="text"
              autoComplete="off"
              spellcheck={false}
              placeholder="Random"
              maxLength={16}
              value={seedText}
              aria-invalid={!seedValid}
              onInput={(e) => {
                setSeedText((e.currentTarget as HTMLInputElement).value);
                setConfirmingNew(false);
              }}
            />
          </label>
          {!seedValid && <p class="error">A seed is exactly 16 characters, 0–9 and a–f.</p>}
          {confirmingNew && <p class="warning">Progress since your last save will be lost.</p>}
          <div class="row">
            <button type="button" class={`button ${confirmingNew ? "button-danger" : ""}`} disabled={!seedValid || snap.busy} onClick={() => void startNew()}>
              {confirmingNew ? "Start new campaign" : "New campaign…"}
            </button>
          </div>
        </section>
      </div>
    </dialog>
  );
}
