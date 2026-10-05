import { ResetPassword } from "@/components/reset-password";

export const metadata = { title: "Choose a new password" };

export default function Page() {
  return <ResetPassword portal="admin" />;
}
