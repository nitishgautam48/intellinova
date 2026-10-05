import { Suspense } from "react";

import { AdminSignup } from "@/components/admin-auth";

export const metadata = { title: "Create admin account" };

export default function Page() {
  return (
    <Suspense>
      <AdminSignup />
    </Suspense>
  );
}
