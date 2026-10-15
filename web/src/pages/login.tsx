import { ArrowRight, Building2, Code2, Crown, Headset, KeyRound, MessagesSquare, ShieldCheck, Waypoints } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Flourish, Logo, Wordmark } from "@/components/brand";
import { ErrorNote } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { api, type Role } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { TILE } from "@/lib/pages";
import { ROLE, type Tone } from "@/lib/palette";
import { cn } from "@/lib/utils";

const ROLES: Record<Role, { sees: string; icon: typeof Crown; tone: Tone }> = {
  lead: { sees: "Sees every client", icon: Headset, tone: "blue" },
  agent: { sees: "Sees only her two schools", icon: MessagesSquare, tone: "green" },
  developer: { sees: "Sees tickets and code", icon: Code2, tone: "violet" },
  admin: { sees: "Sees everything, incl. keys", icon: Crown, tone: "amber" },
};

/** Sign-in, with the demo accounts listed so anyone can try each role. */
export function LoginPage() {
  const { logIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [demo, setDemo] = useState<{ password: string; accounts: Array<{ name: string; email: string; role: Role }> }>();

  useEffect(() => {
    api.demoAccounts().then(setDemo, () => undefined);
  }, []);

  const submit = async (event?: FormEvent, account?: { email: string; password: string }) => {
    event?.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await logIn(account?.email ?? email, account?.password ?? password);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-full bg-paper lg:grid-cols-[1.05fr_1fr]">
      {/* A bright panel: what the desk does */}
      <section className="relative m-3 hidden overflow-hidden rounded-3xl bg-primary p-12 text-white lg:flex lg:flex-col">
        <div className="relative flex items-center gap-3">
          <Logo inverse />
          <span className="rounded-full bg-white/15 px-2.5 py-0.5 text-[12px] font-semibold">Support desk</span>
        </div>
        <div className="relative mt-auto max-w-lg">
          <h1 className="text-[50px] leading-[1.04] text-white">
            Every client conversation, remembered.
          </h1>
          <Flourish className="mt-3 w-60 text-[#ffb4a8]" />
          <p className="mt-6 max-w-[46ch] text-[16.5px] text-white/80">
            Every school's WhatsApp group, turned into tickets. Each client's data stays private.
          </p>
          <div className="mt-10 grid grid-cols-3 gap-3">
            {[
              { icon: Building2, value: "4", label: "Clients" },
              { icon: Waypoints, value: "1", label: "Shared problem" },
              { icon: ShieldCheck, value: "0", label: "Data leaks" },
            ].map((stat) => (
              <div key={stat.label} className="rounded-2xl bg-white/12 p-4 backdrop-blur-sm">
                <stat.icon className="size-5 text-white/80" />
                <div className="mt-3 font-display text-[30px] leading-none font-semibold">{stat.value}</div>
                <div className="mt-1.5 text-[12.5px] text-white/75">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="flex flex-col justify-center px-6 py-12 sm:px-12 lg:px-16">
        <div className="mx-auto w-full max-w-md">
          <Wordmark className="mb-12 lg:hidden" />
          <h2 className="text-[32px]">Welcome back</h2>
          <p className="mt-2 text-muted">Sign in with your staff account.</p>

          <form onSubmit={submit} className="card mt-8 flex flex-col gap-5 p-6">
            <Field label="Email">
              <Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@ednovax.demo" required />
            </Field>
            <Field label="Password">
              <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </Field>
            {error && <ErrorNote message={error} />}
            <Button type="submit" size="lg" disabled={busy}>
              Sign in <ArrowRight />
            </Button>
          </form>

          {demo && (
            <div className="mt-10">
              <div className="flex items-center justify-between pb-3">
                <span className="text-[14px] font-semibold">Try a demo account</span>
                <span className="flex items-center gap-1.5 text-[12.5px] text-muted">
                  <KeyRound className="size-3.5" />
                  <code className="rounded-md bg-card px-1.5 py-0.5 font-mono text-ink">{demo.password}</code>
                </span>
              </div>
              <ul className="flex flex-col gap-2">
                {demo.accounts.map((account) => {
                  const role = ROLES[account.role];
                  return (
                    <li key={account.email}>
                      <button
                        onClick={() => submit(undefined, { email: account.email, password: demo.password })}
                        disabled={busy}
                        className="group flex w-full items-center gap-4 rounded-2xl border border-line-soft bg-card px-4 py-3.5 text-left shadow-card transition-[transform,border-color] hover:-translate-y-0.5 hover:border-primary/40"
                      >
                        <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl", TILE[role.tone])}>
                          <role.icon className="size-5" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline gap-2">
                            <span className="font-semibold">{account.name}</span>
                            <span className="text-[12.5px] text-muted">{ROLE[account.role]}</span>
                          </div>
                          <div className="truncate text-[13px] text-muted">{role.sees}</div>
                        </div>
                        <ArrowRight className="size-4 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
