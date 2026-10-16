import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { Button } from "./button";
import { Input } from "./input";

/** A read-only value with a copy button, e.g. a webhook URL. */
export function CopyField({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex gap-2">
      <Input value={value} readOnly className="min-w-0 font-mono text-[12.5px]" onFocus={(e) => e.currentTarget.select()} />
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-10 w-10 shrink-0"
        aria-label="Copy"
        onClick={() => {
          void navigator.clipboard?.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check /> : <Copy />}
      </Button>
    </div>
  );
}
