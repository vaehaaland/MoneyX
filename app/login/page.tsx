import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Logg inn" };

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-6 py-10">
      <div className="mb-8 flex size-16 items-center justify-center rounded-[20px] bg-primary text-on-primary">
        <svg viewBox="0 0 512 512" className="size-12" aria-hidden="true">
          <path d="M120 372h84v-84h84v-84h84" fill="none" stroke="currentColor" strokeWidth="44" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="386" cy="150" r="34" fill="currentColor" />
        </svg>
      </div>
      <h1 className="text-4xl font-medium tracking-tight">MoneyX</h1>
      <p className="mt-2 mb-8 text-on-surface-variant">Lånet ditt, alltid oppdatert.</p>
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
