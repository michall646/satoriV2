// Setup checklist folded into the Manage Overview. Keep the URL working.
import { redirect } from 'next/navigation';

export default function SetupPage({ params }) {
  redirect(`/contests/${params.id}/manage`);
}
