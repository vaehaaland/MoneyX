import { Suspense } from "react";
import { Nav } from "@/components/nav";

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="min-h-dvh pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-0 md:pl-20">
      <Suspense>
        <Nav />
      </Suspense>
      <main className="mx-auto w-full max-w-3xl">{children}</main>
    </div>
  );
}
