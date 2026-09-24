'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ShieldCheck, Smartphone } from 'lucide-react';
import { ApiError, apiFetch, apiBaseUrl } from '@/lib/api-client';
import { useAuth } from '@/providers/auth-provider';
import { Button, Card } from '@/components/ui';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { ThemeToggle } from '@/components/theme-toggle';
import { BrandLockup } from '@/components/brand';
import { LoginShowcase } from '@/components/marketing/login-showcase';
import { AndroidAppVersion } from '@/components/android-app-version';
import { leaveForApp } from '@/components/support-chat';
import { safeNextPath } from '@/lib/next-path';

/**
 * Sign in (v2.24 redesign).
 *
 * Two panels: what the product is, and the form. Below lg the showcase is not
 * rendered at all - on a phone the form is the whole job, and a marketing panel
 * above it only pushes the password field off the screen.
 */

const loginSchema = z.object({
  email: z.string().min(1, 'Email is required').email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
  mfaCode: z.string().optional(),
  remember: z.boolean(),
});
type LoginValues = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const { login, status } = useAuth();
  const [needsMfa, setNeedsMfa] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [ssoEnabled, setSsoEnabled] = useState(false);

  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '', mfaCode: '', remember: true },
  });

  // v2.88 - back to whatever was asked for, when it is a page of ours; the
  // dashboard otherwise. `safeNextPath` is what keeps this from being an open
  // redirect - see lib/next-path.
  useEffect(() => {
    if (status !== 'authenticated') return;
    // Read off the address bar rather than through useSearchParams: that hook
    // needs a Suspense boundary during prerender, and React keeps the
    // pre-suspense tree in the DOM hidden - which left a second, invisible
    // copy of this very form for a password manager to fill. This runs in an
    // effect, so the browser is always there to ask.
    const next = new URLSearchParams(window.location.search).get('next');
    leaveForApp(safeNextPath(next) ?? '/dashboard');
  }, [status]);

  // Only show the SSO button when the server reports Entra ID is configured.
  useEffect(() => {
    apiFetch<{ enabled: boolean }>('/auth/sso/available')
      .then((r) => setSsoEnabled(r.enabled))
      .catch(() => setSsoEnabled(false));
  }, []);

  // The SSO callback redirects here with ?error= when sign-in fails.
  useEffect(() => {
    const error = new URLSearchParams(window.location.search).get('error');
    if (error === 'sso' || error === 'sso_state') {
      setFormError('Single sign-on failed. Try again, or sign in with your email and password.');
    }
  }, []);

  async function onSubmit(values: LoginValues) {
    setFormError(null);
    try {
      const result = await login(
        values.email,
        values.password,
        needsMfa ? values.mfaCode : undefined,
        values.remember,
      );
      if (result === 'mfa-required') {
        setNeedsMfa(true);
        return;
      }
      leaveForApp();
    } catch (caught) {
      setFormError(
        caught instanceof ApiError
          ? (caught.problem.detail ?? caught.problem.title)
          : 'Unable to sign in. Please try again.',
      );
    }
  }

  return (
    // lg:h-dvh, not min-h: the showcase beside the form is a tall stack, and
    // letting it size the grid row made the whole PAGE 912px on every screen.
    // On a 768px laptop that pushed the Sign in button below the fold - the one
    // control the page exists for - and sliced the dashboard mockup mid-table
    // at whatever height the window happened to be. The viewport sets the
    // height now and the showcase fits itself into it.
    <div className="min-h-dvh lg:grid lg:h-dvh lg:grid-cols-[1.05fr_minmax(0,30rem)] lg:overflow-hidden xl:grid-cols-[1.15fr_minmax(0,32rem)]">
      <LoginShowcase />

      {/* Its own scroller, so a short window scrolls the form rather than the
          page - the showcase stays put instead of sliding away with it. */}
      <div className="flex min-h-dvh flex-col px-5 py-6 sm:px-8 lg:h-full lg:min-h-0 lg:overflow-y-auto">
        <div className="flex justify-end">
          <ThemeToggle labels />
        </div>

        <main className="flex flex-1 items-center justify-center py-8">
          <div className="w-full max-w-sm">
            <Card className="p-6 shadow-sm sm:p-7">
              <div className="text-center">
                {/* The wordmark is a home link everywhere else it appears; on the
                    sign-in page it was the one place it did nothing, which is
                    exactly where somebody who is not signing in wants it. */}
                <h1>
                  <Link href="/" aria-label="PioAssets home" className="inline-flex">
                    <BrandLockup height={38} />
                  </Link>
                </h1>
                <p className="mt-5 text-xl font-bold tracking-tight">
                  {needsMfa ? 'One more step' : 'Welcome back'}
                </p>
                <p className="mt-1 text-sm text-[var(--color-content-muted)]">
                  {needsMfa
                    ? 'Confirm the code from your authenticator app.'
                    : 'Sign in to your PioAssets account to continue.'}
                </p>
              </div>

              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="mt-6 grid gap-4" noValidate>
                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Work email</FormLabel>
                        <FormControl>
                          <Input
                            type="email"
                            autoComplete="username"
                            placeholder="you@company.com"
                            autoFocus
                            disabled={needsMfa}
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <div className="flex items-center justify-between gap-3">
                          <FormLabel>Password</FormLabel>
                          <Link
                            href="/forgot-password"
                            className="text-sm font-medium text-[var(--color-brand)] hover:underline"
                          >
                            Forgot password?
                          </Link>
                        </div>
                        <FormControl>
                          <PasswordInput
                            autoComplete="current-password"
                            disabled={needsMfa}
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {needsMfa ? (
                    <FormField
                      control={form.control}
                      name="mfaCode"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Authentication code</FormLabel>
                          <FormControl>
                            <Input
                              inputMode="numeric"
                              autoComplete="one-time-code"
                              maxLength={6}
                              autoFocus
                              {...field}
                              onChange={(e) => field.onChange(e.target.value.replace(/\D/g, ''))}
                            />
                          </FormControl>
                          <FormDescription>
                            Six-digit code from your authenticator app.
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  ) : (
                    <FormField
                      control={form.control}
                      name="remember"
                      render={({ field }) => (
                        <label className="flex cursor-pointer items-center gap-2.5 text-sm">
                          <input
                            type="checkbox"
                            checked={field.value}
                            onChange={(e) => field.onChange(e.target.checked)}
                            className="size-4 shrink-0 accent-[var(--color-brand)]"
                          />
                          Keep me signed in
                        </label>
                      )}
                    />
                  )}

                  {formError ? (
                    <p
                      role="alert"
                      className="rounded-[var(--radius-control)] border px-3 py-2 text-sm"
                      style={{
                        color: 'var(--tone-critical-fg)',
                        backgroundColor: 'var(--tone-critical-bg)',
                        borderColor: 'var(--tone-critical-border)',
                      }}
                    >
                      {formError}
                    </p>
                  ) : null}

                  <Button type="submit" loading={form.formState.isSubmitting}>
                    {needsMfa ? 'Verify' : 'Sign in'}
                  </Button>
                </form>
              </Form>

              {ssoEnabled && !needsMfa ? (
                <>
                  <div className="my-4 flex items-center gap-3 text-xs text-[var(--color-content-subtle)]">
                    <span className="h-px flex-1 bg-[var(--color-border)]" />
                    or
                    <span className="h-px flex-1 bg-[var(--color-border)]" />
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    className="w-full"
                    onClick={() => {
                      // Full-page navigation: the browser follows the OIDC redirect
                      // chain and returns to the app authenticated via the refresh cookie.
                      window.location.href = `${apiBaseUrl}/auth/sso/entra`;
                    }}
                  >
                    <MicrosoftLogo />
                    Continue with Microsoft
                  </Button>
                </>
              ) : null}
            </Card>

            <p className="mt-4 flex items-center justify-center gap-1.5 text-center text-xs text-[var(--color-content-subtle)]">
              <ShieldCheck aria-hidden="true" className="size-3.5 shrink-0" />
              Sessions expire automatically and every action is audited.
            </p>

            <a
              href="/downloads/techpioasset.apk"
              className="mt-3 flex items-center justify-center gap-1.5 text-xs font-medium text-[var(--color-content-muted)] transition-colors hover:text-[var(--color-content)]"
            >
              <Smartphone aria-hidden="true" className="size-3.5" />
              Download the Android app
            </a>
            {/* Which build that link serves, so an installed phone can be checked
                against it without downloading anything. */}
            <p className="mt-1 text-center text-[11px] text-[var(--color-content-subtle)]">
              <AndroidAppVersion />
            </p>
          </div>
        </main>

        {/* The inset is applied sideways, not downwards. This column is already
            as tall as the viewport, so bottom padding only turned it into a
            scroller and left the links exactly where the bubble was covering
            them; shifting them left of the bubble's 80px corner works whatever
            the height. Collapses to zero when the widget is not on the page. */}
        <footer className="flex flex-col items-center justify-between gap-2 border-t border-[var(--color-border)] pt-5 pr-[var(--support-chat-inset)] text-xs text-[var(--color-content-subtle)] sm:flex-row">
          <p>© {new Date().getFullYear()} TechPIO Services LLP</p>
          <nav aria-label="Support" className="flex items-center gap-4">
            <Link href="/guides" className="hover:text-[var(--color-content)]">
              Guides
            </Link>
            <Link href="/#security" className="hover:text-[var(--color-content)]">
              Security
            </Link>
            <Link href="/contact" className="hover:text-[var(--color-content)]">
              Support
            </Link>
          </nav>
        </footer>
      </div>
    </div>
  );
}

/** Microsoft's four squares. Their brand guidance requires the mark unaltered. */
function MicrosoftLogo() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="shrink-0">
      <rect width="7" height="7" fill="#f25022" />
      <rect x="9" width="7" height="7" fill="#7fba00" />
      <rect y="9" width="7" height="7" fill="#00a4ef" />
      <rect x="9" y="9" width="7" height="7" fill="#ffb900" />
    </svg>
  );
}
