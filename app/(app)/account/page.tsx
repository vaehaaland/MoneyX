import type { Metadata } from "next";
import { signOut } from "@/app/(app)/actions";
import { Icon } from "@/components/icon";
import { buttonClass, Card, TopBar } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Konto" };

export default async function AccountPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const email = typeof data?.claims?.email === "string" ? data.claims.email : null;

  return (
    <>
      <TopBar title="Konto" />
      <div className="animate-enter space-y-4 px-4 pb-10">
        <Card>
          <p className="text-sm text-on-surface-variant">Logga inn som</p>
          <p className="mt-1 text-lg break-all">{email ?? "Ukjend"}</p>
          <form action={signOut} className="mt-5">
            <button type="submit" className={buttonClass("outlined")}>
              <Icon name="logout" className="size-5 -ml-1" />
              Logg ut
            </button>
          </form>
        </Card>
      </div>
    </>
  );
}
