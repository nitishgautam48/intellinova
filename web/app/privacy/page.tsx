import Link from "next/link";

import { LegalPage } from "@/components/legal";

export const metadata = { title: "Privacy Policy" };

export default function Privacy() {
  return (
    <LegalPage title="Privacy Policy" updated="September 2026">
      <p>This page explains what IntelliNova stores about you, why, and how you can see, correct or delete it. The organisation running this IntelliNova installation (your school or institute) is responsible for your data.</p>
      <h2>What we store</h2>
      <ul>
        <li><strong>Account:</strong> your name, email or phone number and a securely hashed password.</li>
        <li><strong>Profile:</strong> class, board, subjects, language and study preferences, interests and the exams you are preparing for.</li>
        <li><strong>Learning activity:</strong> quiz answers, topic mastery estimates, revision schedules, time spent studying, saved items and ratings of resources.</li>
        <li><strong>Your material and conversations:</strong> files, links and text you add to Study AI, the notes generated from them, and your conversations with the tutor.</li>
        <li><strong>Searches:</strong> what you search for, used to find gaps in the catalog.</li>
      </ul>
      <h2>How it is used</h2>
      <p>Only to run IntelliNova for you: answering questions from your material, choosing practice questions, scheduling revision, recommending resources and showing your progress. Staff see aggregated analytics and the content they review; they do not browse your conversations.</p>
      <h2>AI processing</h2>
      <p>Answers, notes, quizzes and transcriptions are produced by open-source models running on this installation&apos;s own servers. Your material and questions are not sent to third-party AI services. When you add a YouTube link, public video details and captions are fetched from YouTube.</p>
      <h2>Your rights</h2>
      <p>From <Link href="/app/profile">Profile › Privacy and account</Link> you can download a copy of your data, ask for a correction, or delete your account. Requests are handled within 30 days. Deleting your account removes your login and all personal data listed above.</p>
      <h2>Children</h2>
      <p>If you are under 18, a parent or guardian should know you are using IntelliNova. They can make the requests above on your behalf.</p>
      <h2>Contact</h2>
      <p>Questions about your data go to the organisation that gave you access to IntelliNova.</p>
    </LegalPage>
  );
}
