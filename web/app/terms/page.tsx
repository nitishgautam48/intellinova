import Link from "next/link";

import { LegalPage } from "@/components/legal";

export const metadata = { title: "Terms of Use" };

export default function Terms() {
  return (
    <LegalPage title="Terms of Use" updated="September 2026">
      <p>By creating an account you agree to these terms. They are between you and the organisation running this IntelliNova installation.</p>
      <h2>Using IntelliNova</h2>
      <ul>
        <li>Keep your login to yourself and tell your school if you think someone else has used it.</li>
        <li>Only upload material you are allowed to use for your own study, such as class notes, your textbook or your teacher&apos;s slides.</li>
        <li>Don&apos;t use IntelliNova to cheat in graded assessments, harass others or upload harmful content.</li>
      </ul>
      <h2>About AI answers</h2>
      <p>IntelliNova links its answers to the material they came from, labels anything that isn&apos;t from your material, and tells you when your material doesn&apos;t cover a question. It can still make mistakes. Check important facts against your textbook, and use the flag button to report anything wrong so the content team can fix it.</p>
      <h2>Exam and career information</h2>
      <p>Exam patterns, dates and eligibility rules are shown with their official source and the date they were last verified. Always confirm on the official website before applying.</p>
      <h2>Your content</h2>
      <p>You keep the rights to what you upload. You allow IntelliNova to process it to provide the service to you. See the <Link href="/privacy">Privacy Policy</Link> for how data is handled and deleted.</p>
      <h2>Accounts</h2>
      <p>You can delete your account at any time from your profile. The organisation may suspend accounts that break these terms.</p>
    </LegalPage>
  );
}
