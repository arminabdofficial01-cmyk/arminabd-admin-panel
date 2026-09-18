import { useState } from "react";
import { X } from "lucide-react";

export function TagInput({
  values,
  onChange,
  placeholder,
}: {
  values: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
}) {
  const [input, setInput] = useState("");

  function addTag(raw: string) {
    const tag = raw.trim();
    if (tag && !values.includes(tag)) onChange([...values, tag]);
    setInput("");
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag(input);
    } else if (e.key === "Backspace" && !input && values.length) {
      onChange(values.slice(0, -1));
    }
  }

  return (
    <div className="flex flex-wrap gap-1 border rounded-md px-2 py-1 min-h-9 items-center focus-within:ring-1 focus-within:ring-ring">
      {values.map((v) => (
        <span
          key={v}
          className="flex items-center gap-1 bg-secondary text-secondary-foreground text-xs px-2 py-0.5 rounded"
        >
          {v}
          <button
            type="button"
            onClick={() => onChange(values.filter((x) => x !== v))}
            className="hover:text-destructive"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <input
        className="flex-1 min-w-16 text-sm outline-none bg-transparent"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => input && addTag(input)}
        placeholder={values.length === 0 ? placeholder : ""}
      />
    </div>
  );
}

export function normalizeTagList(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }

  return result;
}
