"use client";

import { use } from "react";

import { Tutor } from "@/components/tutor";

export default function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <Tutor key={id} conversationId={id} />;
}
