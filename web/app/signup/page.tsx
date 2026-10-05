import { Suspense } from "react";

import { StudentAuth } from "@/components/student-auth";

export const metadata = { title: "Sign up" };

export default function Page() {
  return (
    <Suspense>
      <StudentAuth initial="signup" />
    </Suspense>
  );
}
