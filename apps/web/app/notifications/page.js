// Notifications route: thin wrapper around shared inbox (also embedded in profile).
import NotificationsInbox from '../../components/NotificationsInbox';

export default function NotificationsPage() {
  return (
    <div className="max-w-2xl">
      <NotificationsInbox />
    </div>
  );
}
