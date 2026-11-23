import { ComposeView } from "./ComposeView";

export default async function ComposePage({ searchParams }: { searchParams: Promise<{ id?: string; slot?: string }> }) {
  const sp = await searchParams;
  return <ComposeView id={sp.id} slot={sp.slot} />;
}
