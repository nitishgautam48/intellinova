import { Suspense } from "react";

import { AdminLogin } from "@/components/admin-auth";

export const metadata = { title: "Admin log in" };

export default function Page() {
  return (
    <Suspense>
      <AdminLogin />
    </Suspense>
  );
}
