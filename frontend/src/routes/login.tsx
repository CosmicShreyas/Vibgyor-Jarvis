import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { ArrowRight, Eye, EyeOff, Loader2, Lock, Mail, ShieldCheck, Sparkles } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { JarvisLogo } from "@/components/JarvisLogo";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/login")({
  component: LoginPage,
  head: () => ({
    meta: [
      { title: "Sign in - Jarvis" },
      {
        name: "description",
        content: "Sign in to Jarvis, your beautifully crafted AI workspace.",
      },
    ],
  }),
});

type Mode = "signin" | "signup";

function LoginPage() {
  const navigate = useNavigate();
  const { token, signIn, requestSignUpCode, verifySignUpCode, startGoogleSignIn, consumeToken } = useAuth();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [awaitingCode, setAwaitingCode] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  useEffect(() => {
    if (token) {
      void navigate({ to: "/" });
    }
  }, [navigate, token]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oauthToken = params.get("token");
    if (!oauthToken) return;

    setGoogleLoading(true);
    void consumeToken(oauthToken)
      .then(() => {
        params.delete("token");
        const nextUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ""}`;
        window.history.replaceState({}, "", nextUrl);
        return navigate({ to: "/" });
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Google sign-in failed");
      })
      .finally(() => setGoogleLoading(false));
  }, [consumeToken, navigate]);

  if (token) {
    return null;
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setInfo("");
    try {
      if (mode === "signin") {
        await signIn(email, password);
        void navigate({ to: "/" });
      } else if (!awaitingCode) {
        const response = await requestSignUpCode(email, password);
        setAwaitingCode(true);
        setInfo(`Verification code sent. It expires in ${Math.round(response.expiresInSeconds / 60)} minutes.`);
      } else {
        await verifySignUpCode(email, verificationCode);
        void navigate({ to: "/" });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setLoading(false);
    }
  };

  const onGoogle = () => {
    setGoogleLoading(true);
    setError("");
    startGoogleSignIn();
  };

  const switchMode = (nextMode: Mode) => {
    setMode(nextMode);
    setAwaitingCode(false);
    setVerificationCode("");
    setError("");
    setInfo("");
  };

  return (
    <div className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-background px-4 py-10 text-foreground">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-32 left-1/2 h-[42rem] w-[42rem] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,oklch(from_var(--foreground)_l_c_h/0.08),transparent_70%)] blur-2xl" />
        <div className="absolute bottom-0 right-0 h-[28rem] w-[28rem] translate-x-1/3 translate-y-1/3 rounded-full bg-[radial-gradient(closest-side,oklch(0.7_0.12_60/0.18),transparent_70%)] blur-3xl" />
        <div className="absolute inset-0 opacity-[0.035] [background-image:linear-gradient(to_right,currentColor_1px,transparent_1px),linear-gradient(to_bottom,currentColor_1px,transparent_1px)] [background-size:48px_48px]" />
      </div>

      <div className="relative w-full max-w-[420px]">
        <div className="mb-8 flex flex-col items-center text-center">
          <Link
            to="/"
            className="group mb-5 block transition hover:scale-[1.03]"
            aria-label="Jarvis home"
          >
            <JarvisLogo
              alt="Jarvis"
              className="h-12 w-12 shadow-elevated"
              roundedClassName="rounded-2xl"
            />
          </Link>
          <h1 className="font-serif text-4xl tracking-tight text-foreground">
            {mode === "signin" ? "Welcome back" : "Create your account"}
          </h1>
          <p className="mt-2 max-w-sm text-sm text-muted-foreground">
            {mode === "signin"
              ? "Sign in to continue to your Jarvis workspace."
              : awaitingCode
                ? "Enter the verification code sent to your email."
                : "Join Jarvis - a calm, beautiful AI workspace."}
          </p>
        </div>

        <div className="relative rounded-2xl border border-border bg-surface-elevated p-6 shadow-elevated sm:p-7">
          <button
            type="button"
            onClick={onGoogle}
            disabled={googleLoading || loading}
            className="group relative flex w-full items-center justify-center gap-2.5 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-medium text-foreground shadow-soft transition hover:border-border-strong hover:shadow-elevated disabled:cursor-not-allowed disabled:opacity-60"
          >
            {googleLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <GoogleIcon className="h-4 w-4" />
            )}
            <span>{mode === "signin" ? "Continue with Google" : "Sign up with Google"}</span>
          </button>

          <div className="my-5 flex items-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
              or with email
            </span>
            <div className="h-px flex-1 bg-border" />
          </div>

          <form onSubmit={onSubmit} className="space-y-3.5">
            <Field
              id="email"
              label="Email"
              icon={<Mail className="h-4 w-4" />}
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              disabled={awaitingCode}
            />

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label htmlFor="password" className="text-xs font-medium text-foreground">
                  Password
                </label>
                {mode === "signin" && (
                  <button
                    type="button"
                    className="text-[11px] text-muted-foreground underline-offset-4 transition hover:text-foreground hover:underline"
                  >
                    Forgot password?
                  </button>
                )}
              </div>
              <div className="group relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground transition group-focus-within:text-foreground">
                  <Lock className="h-4 w-4" />
                </span>
                <input
                  id="password"
                  type={showPw ? "text" : "password"}
                  autoComplete={mode === "signin" ? "current-password" : "new-password"}
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={mode === "signin" ? "Your password" : "At least 6 characters"}
                  disabled={awaitingCode}
                  className="w-full rounded-lg border border-border bg-background py-2.5 pl-10 pr-10 text-sm text-foreground placeholder:text-muted-foreground/60 outline-none transition focus:border-border-strong focus:ring-2 focus:ring-foreground/10"
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  className="absolute right-2.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
                  aria-label={showPw ? "Hide password" : "Show password"}
                >
                  {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {mode === "signup" && awaitingCode && (
              <Field
                id="verification-code"
                label="Verification code"
                icon={<ShieldCheck className="h-4 w-4" />}
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                minLength={6}
                maxLength={6}
                value={verificationCode}
                onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="6-digit code"
              />
            )}

            <button
              type="submit"
              disabled={loading || googleLoading}
              className={cn(
                "group mt-1 flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-elevated transition",
                "hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60",
              )}
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  {mode === "signin"
                    ? "Sign in"
                    : awaitingCode
                      ? "Verify and create account"
                      : "Send verification code"}
                  <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
                </>
              )}
            </button>
          </form>

          {info && (
            <div className="mt-3 rounded-lg border border-border bg-card px-3 py-2 text-xs text-foreground">
              {info}
            </div>
          )}

          {error && (
            <div className="mt-3 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}

          <p className="mt-5 text-center text-xs text-muted-foreground">
            {mode === "signin" ? (
              <>
                New to Jarvis?{" "}
                <button
                  type="button"
                  onClick={() => switchMode("signup")}
                  className="font-medium text-foreground underline-offset-4 hover:underline"
                >
                  Create an account
                </button>
              </>
            ) : (
              <>
                Already have an account?{" "}
                <button
                  type="button"
                  onClick={() => switchMode("signin")}
                  className="font-medium text-foreground underline-offset-4 hover:underline"
                >
                  Sign in
                </button>
              </>
            )}
          </p>
        </div>

        <div className="mt-6 flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
          <Sparkles className="h-3 w-3" />
          <span>
            By continuing you agree to our{" "}
            <a className="underline-offset-4 hover:underline" href="#">
              Terms
            </a>{" "}
            &{" "}
            <a className="underline-offset-4 hover:underline" href="#">
              Privacy
            </a>
            .
          </span>
        </div>
      </div>
    </div>
  );
}

function Field({
  id,
  label,
  icon,
  ...props
}: {
  id: string;
  label: string;
  icon: React.ReactNode;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-xs font-medium text-foreground">
        {label}
      </label>
      <div className="group relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground transition group-focus-within:text-foreground">
          {icon}
        </span>
        <input
          id={id}
          {...props}
          className="w-full rounded-lg border border-border bg-background py-2.5 pl-10 pr-3 text-sm text-foreground placeholder:text-muted-foreground/60 outline-none transition focus:border-border-strong focus:ring-2 focus:ring-foreground/10"
        />
      </div>
    </div>
  );
}

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" aria-hidden>
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="M6.3 14.7l6.6 4.8C14.6 16.1 19 13 24 13c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.6 8.3 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2c-2 1.5-4.5 2.4-7.2 2.4-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.1 5.6l6.2 5.2C41.8 35.1 44 30 44 24c0-1.3-.1-2.4-.4-3.5z"
      />
    </svg>
  );
}
