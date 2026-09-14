import { requireUser } from "@/lib/auth";
import PasswordForm from "./password-form";

export default async function AccountPage() {
  const user = await requireUser();
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Account</h1>
          <p>{user.name} · {user.email} · signed in as <b>{user.role}</b></p>
        </div>
      </div>
      <div style={{ maxWidth: 400 }}><PasswordForm /></div>
    </>
  );
}
