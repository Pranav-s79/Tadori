import { UserCard } from "../components/user-card.js";
import { getSession } from "../lib/index.js";

export default function ProfilePage(): string {
  const session = getSession("profile");
  return UserCard({ name: session.user });
}
