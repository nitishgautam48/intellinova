import { Suspense } from "react";

import { StudentAuth } from "@/components/student-auth";

export const metadata = { title: "Reset password" };

export default function Page() {
  return (
    <Suspense>
      <StudentAuth initial="forgot" />
    </Suspense>
  );
}
