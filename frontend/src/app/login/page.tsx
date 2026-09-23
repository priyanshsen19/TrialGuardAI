'use client';

import { useQuery } from '@tanstack/react-query';
import { Loader2, ShieldCheck } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import * as React from 'react';
import { DemoBanner } from '@/components/shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { api, login } from '@/lib/api';

const DEMO_PASSWORD = process.env.NEXT_PUBLIC_DEMO_PASSWORD ?? '';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') || '/dashboard';
  const [email, setEmail] = React.useState('coordinator@trialguard.demo');
  const [password, setPassword] = React.useState(DEMO_PASSWORD);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const { data: accounts } = useQuery({ queryKey: ['demo-accounts'], queryFn: () => api.get<Array<{ email: string; role: string; displayName: string }>>('/auth/demo-accounts') });

  const submit = async (e?: React.FormEvent, as?: string) => {
    e?.preventDefault();
    setError(null);
    setBusy(as ?? email);
    try {
      await login(as ?? email, password);
      router.replace(next.startsWith('/') ? next : '/dashboard');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex min-h-screen flex-col">
      <DemoBanner />
      <div className="flex flex-1 items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="mb-6 flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-primary/20 ring-1 ring-primary/40">
              <ShieldCheck className="size-5 text-primary" aria-hidden />
            </div>
            <div>
              <h1 className="text-lg font-semibold">TrialGuard AI</h1>
              <p className="text-xs text-muted-foreground">Governed AI for Clinical Trial Patient Screening</p>
            </div>
          </div>
          <Card>
            <CardContent className="space-y-4">
              <form onSubmit={submit} className="space-y-3">
                <div>
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
                </div>
                <div>
                  <Label htmlFor="password">Password</Label>
                  <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
                </div>
                {error && (
                  <p role="alert" className="text-sm text-fail">
                    {error}
                  </p>
                )}
                <Button type="submit" className="w-full" disabled={!!busy}>
                  {busy === email && <Loader2 className="animate-spin" />} Sign in
                </Button>
              </form>
              {accounts && accounts.length > 0 && (
                <div className="border-t border-border pt-4">
                  <p className="mb-2 text-xs text-muted-foreground">Demo accounts (synthetic environment){!DEMO_PASSWORD && ' — password is DEMO_USER_PASSWORD from .env'}</p>
                  <div className="grid grid-cols-2 gap-2">
                    {accounts.map((a) => (
                      <Button key={a.email} variant="secondary" size="sm" disabled={!password || !!busy} onClick={() => submit(undefined, a.email)} className="justify-start">
                        {busy === a.email && <Loader2 className="animate-spin" />}
                        <span className="font-semibold">{a.role}</span>
                      </Button>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
          <p className="mt-4 text-center text-[11px] text-muted-foreground">Synthetic data only. Not clinically validated. Not FDA approved. Not for direct clinical decision-making.</p>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <React.Suspense>
      <LoginForm />
    </React.Suspense>
  );
}
