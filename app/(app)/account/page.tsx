import type { Metadata } from "next";
import { signOut } from "@/app/(app)/actions";
import { Icon } from "@/components/icon";
import { NameForm } from "@/components/name-form";
import { buttonClass, Card, TopBar } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";

export const instant = false;

export const metadata: Metadata = { title: "Konto" };

export default async function AccountPage() {
  const supabase = await createClient();
  // Asks the auth server rather than the session token, so a name saved a moment ago shows up.
  const { data } = await supabase.auth.getUser();
  const email = data.user?.email ?? null;
  const name = typeof data.user?.user_metadata?.name === "string" ? data.user.user_metadata.name : "";

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
        <Card>
          <NameForm initialName={name} />
        </Card>
      </div>
    </>
  );
}
