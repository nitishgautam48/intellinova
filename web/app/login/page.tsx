import { Suspense } from "react";

import { StudentAuth } from "@/components/student-auth";

export const metadata = { title: "Log in" };

export default function Page() {
  return (
    <Suspense>
      <StudentAuth initial="login" />
    </Suspense>
  );
}
