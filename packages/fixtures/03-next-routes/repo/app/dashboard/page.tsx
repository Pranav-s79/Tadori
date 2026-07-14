import { UserCard } from "../../components/user-card.js";
import { getSession } from "../../lib/index.js";

export default function DashboardPage(): string {
  const session = getSession("current");
  return UserCard({ name: session.user });
}
